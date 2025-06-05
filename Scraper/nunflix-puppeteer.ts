import puppeteer, { Browser, HTTPRequest, Page } from 'puppeteer';

const BASE_URL = 'https://nunflix.org';

export interface NunflixMovie {
  id: string;
  title: string;
  poster: string;
  detailPage: string;
  watchPage: string;
  quality?: string;
}

export interface GenreInfo {
  name: string;
  buttonText: string;
}

export async function getAvailableGenres(): Promise<GenreInfo[]> {
  const knownGenres: GenreInfo[] = [
    { name: 'Action', buttonText: 'Action' },
    { name: 'Adventure', buttonText: 'Adventure' },
    { name: 'Animation', buttonText: 'Animation' },
    { name: 'Comedy', buttonText: 'Comedy' },
    { name: 'Crime', buttonText: 'Crime' },
    { name: 'Drama', buttonText: 'Drama' },
    { name: 'Family', buttonText: 'Family' },
    { name: 'Fantasy', buttonText: 'Fantasy' },
    { name: 'History', buttonText: 'History' },
    { name: 'Horror', buttonText: 'Horror' },
    { name: 'Music', buttonText: 'Music' },
    { name: 'Mystery', buttonText: 'Mystery' },
    { name: 'Romance', buttonText: 'Romance' },
    { name: 'Science Fiction', buttonText: 'Science Fiction' },
    { name: 'Thriller', buttonText: 'Thriller' },
    { name: 'War', buttonText: 'War' },
    { name: 'Western', buttonText: 'Western' }
  ];

  console.log(`Using ${knownGenres.length} predefined genres`);
  return knownGenres;
}

export async function getTrendingMoviesPuppeteer(
  browser: Browser, 
  genre?: GenreInfo,
  limit: number = 25
): Promise<NunflixMovie[]> {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);
  
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (['image', 'font', 'media'].includes(resourceType)) {
      request.abort();
    } else {
      request.continue();
    }
  });
  
  try {
    const targetUrl = `${BASE_URL}/explore/movie?sort=popularity.desc`;
    const pageTitle = genre ? `${genre.name} movies` : 'trending movies';
    
    console.log(`Navigating to: ${pageTitle} (${targetUrl})`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    if (genre) {
      console.log(`Selecting genre: ${genre.name}`);
      
      try {
        await page.evaluate(() => {
          document.querySelectorAll('button[class*="active"], button.selected')
            .forEach(btn => (btn as HTMLElement).click());
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const genreClicked = await page.evaluate((genreName) => {
          const buttons = Array.from(document.querySelectorAll('button'));
          
          for (const btn of buttons) {
            const text = btn.textContent?.trim().toLowerCase() || '';
            const classList = Array.from(btn.classList).join(' ').toLowerCase();
            
            if (text === genreName.toLowerCase() || 
                text.includes(genreName.toLowerCase()) ||
                classList.includes(genreName.toLowerCase().replace(' ', ''))) {
              (btn as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, genre.buttonText);

        if (genreClicked) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          console.warn(`Could not find genre button for: ${genre.name}`);
        }
      } catch (err) {
        console.warn(`Error selecting genre ${genre.name}:`, err);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    const cardSelectors = ['a.movieCard', '.movie-card', '[href*="/movie/"]', '.card'];
    let cards: any[] = [];
    
    for (const selector of cardSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        cards = await page.$$(selector);
        if (cards.length > 0) break;
      } catch (e) {
        continue;
      }
    }

    if (cards.length === 0) {
      console.log('No movie cards found');
      return [];
    }
    
    for (let i = 0; i < 8; i++) {
      try {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (e) {
        break;
      }
    }

    cards = await page.$$('a.movieCard');
    const movies: NunflixMovie[] = [];

    console.log(`Processing ${Math.min(cards.length, limit)} movie cards`);
    
    for (let i = 0; i < Math.min(cards.length, limit + 10); i++) {
      const card = cards[i];
      
      try {
        const cardData = await Promise.race([
          extractCardData(card, page),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]) as any;

        if (cardData?.id) {
          movies.push(cardData);
          if (movies.length >= limit) break;
        }
      } catch (err) {
        continue;
      }
    }

    console.log(`Extracted ${movies.length} movies`);
    return movies;

  } catch (err) {
    console.error(`Error getting ${genre ? genre.name : 'trending'} movies:`, err);
    return [];
  } finally {
    try {
      await page.close();
    } catch (e) {
      console.warn('Error closing page:', e);
    }
  }
}

async function extractCardData(card: any, page: Page): Promise<NunflixMovie | null> {
  try {
    const href = await card.evaluate((el: Element) => el.getAttribute('href'));
    const idMatch = href?.match(/\/movie\/(\d+)/);
    if (!idMatch) return null;

    const id = idMatch[1];
    const detailPage = `${BASE_URL}${href}`;
    const watchPage = `${BASE_URL}/watch/movie/${id}`;

    const rawTitle = await card.$eval('.textBlock', (el: Element) => el.textContent?.trim() || '').catch(() => '');
    const title = rawTitle.replace(/\s*\d{4}.*$/, '').trim();

    let poster = '';
    try {
      const lazyEl = await card.$('.posterBlock span.lazy-load-image-background');
      if (lazyEl) {
        const bgString = await page.evaluate(el => window.getComputedStyle(el).backgroundImage, lazyEl);
        const match = bgString.match(/url\(["']?(.*?)["']?\)/);
        if (match?.[1]) poster = match[1];
      }
    } catch (e) {}

    let quality: string | undefined;
    try {
      quality = await card.$eval('.qualityTag', (el: Element) => el.textContent?.trim() || '');
    } catch (e) {}

    return { id, title, poster, detailPage, watchPage, quality };
  } catch (err) {
    return null;
  }
}

export async function getStreamLinksFromWatchPage(browser: Browser, watchUrl: string): Promise<string[]> {
  const page = await browser.newPage();
  
  try {
    console.log(`Loading watch page: ${watchUrl}`);
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

    await page.waitForSelector('button', { timeout: 8000 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    const existingVidFastIframes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src)
        .filter(src => src?.includes('vidfast'));
    });

    if (existingVidFastIframes.length > 0) {
      return existingVidFastIframes;
    }

    const vidFastClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        if (text.includes('vidfast') || text.includes('vid fast') || text.includes('vf')) {
          btn.click();
          return true;
        }
      }
      
      for (const btn of buttons) {
        const classList = Array.from(btn.classList).join(' ').toLowerCase();
        const id = (btn.id || '').toLowerCase();
        if (classList.includes('server') || id.includes('server')) {
          btn.click();
          return true;
        }
      }
      
      return false;
    });

    if (vidFastClicked) {
      await new Promise(resolve => setTimeout(resolve, 2500));
    }

    return await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src)
        .filter(src => src?.includes('vidfast') || src?.includes('movie') || src?.includes('embed'));
    });

  } catch (err) {
    console.error(`Error getting stream links:`, err);
    return [];
  } finally {
    await page.close();
  }
}

export async function resolveM3U8FromEmbed(browser: Browser, embedUrl: string): Promise<string | null> {
  const page = await browser.newPage();
  let m3u8Url: string | null = null;

  await page.setRequestInterception(true);
  
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('.m3u8')) {
      m3u8Url = url;
    }
    req.continue();
  });

  try {
    console.log(`Checking embed URL: ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      await page.mouse.click(400, 300);
    } catch (clickErr) {}
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  } catch (err) {
    console.warn(`Failed to load embed: ${embedUrl}`);
  } finally {
    await page.close();
  }

  return m3u8Url;
}