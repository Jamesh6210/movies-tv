import puppeteer, { Browser, HTTPRequest, Page } from 'puppeteer';

const BASE_URL = 'https://nunflix.org';

export interface NunflixMovie {
  id: string;
  title: string;
  poster: string;
  detailPage: string;
  watchPage: string;
}

export interface GenreInfo {
  name: string;
  url: string; // Direct URL instead of selector-based approach
}

// Simplified approach: Use direct URLs for genres
export async function getAvailableGenres(): Promise<GenreInfo[]> {
  // Using predefined genre URLs that work with the site structure
  const knownGenres: GenreInfo[] = [
    { name: 'Action', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=28` },
    { name: 'Adventure', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=12` },
    { name: 'Animation', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=16` },
    { name: 'Comedy', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=35` },
    { name: 'Crime', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=80` },
    { name: 'Documentary', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=99` },
    { name: 'Drama', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=18` },
    { name: 'Family', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=10751` },
    { name: 'Fantasy', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=14` },
    { name: 'History', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=36` },
    { name: 'Horror', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=27` },
    { name: 'Music', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=10402` },
    { name: 'Mystery', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=9648` },
    { name: 'Romance', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=10749` },
    { name: 'Science Fiction', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=878` },
    { name: 'Thriller', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=53` },
    { name: 'War', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=10752` },
    { name: 'Western', url: `${BASE_URL}/explore/movie?sort=popularity.desc&with_genres=37` }
  ];

  console.log(`📂 Using ${knownGenres.length} predefined genres`);
  return knownGenres;
}

// Simplified function to get movies - direct URL navigation instead of clicking
export async function getTrendingMoviesPuppeteer(
  browser: Browser, 
  genre?: GenreInfo,
  limit: number = 25
): Promise<NunflixMovie[]> {
  const page = await browser.newPage();
  
  // Set longer timeout for protocol operations
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);
  
  // Optimize page for minimal resource usage
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
      request.abort();
    } else {
      request.continue();
    }
  });
  
  try {
    const targetUrl = genre ? genre.url : `${BASE_URL}/explore/movie?sort=popularity.desc`;
    const pageTitle = genre ? `${genre.name} movies` : 'trending movies';
    
    console.log(`🔍 Navigating directly to: ${pageTitle}`);
    console.log(`📍 URL: ${targetUrl}`);
    
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if we can find movie cards, with fallback selectors
    const cardSelectors = ['a.movieCard', '.movie-card', '[href*="/movie/"]', '.card'];
    let cards: any[] = [];
    
    for (const selector of cardSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        cards = await page.$$(selector);
        if (cards.length > 0) {
          console.log(`✅ Found ${cards.length} cards using selector: ${selector}`);
          break;
        }
      } catch (e) {
        console.log(`⚠️ Selector ${selector} not found, trying next...`);
      }
    }

    if (cards.length === 0) {
      console.log('❌ No movie cards found with any selector');
      return [];
    }
    
    console.log(`📜 Scrolling to load more ${pageTitle}...`);
    // Scroll to load more movies with timeout protection
    for (let i = 0; i < 8; i++) {
      try {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (e) {
        console.log(`⚠️ Scroll attempt ${i} failed, continuing...`);
        break;
      }
    }

    // Re-get cards after scrolling
    cards = await page.$$('a.movieCard');
    const movies: NunflixMovie[] = [];

    console.log(`🔢 Processing ${Math.min(cards.length, limit)} movie cards for ${pageTitle}`);
    
    // Process movies up to the limit with timeout protection
    for (let i = 0; i < Math.min(cards.length, limit + 10); i++) {
      const card = cards[i];
      
      try {
        // Use shorter timeout for individual card processing
        const cardData = await Promise.race([
          extractCardData(card, page),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Card timeout')), 5000))
        ]) as any;

        if (cardData && cardData.id) {
          movies.push(cardData);
          if (movies.length >= limit) break;
        }
      } catch (err) {
        console.warn(`⚠️ Skipped card ${i}: ${err}`);
        continue;
      }
    }

    console.log(`✅ Successfully extracted ${movies.length} movies for ${pageTitle}`);
    return movies;

  } catch (err) {
    console.error(`❌ Error getting ${genre ? genre.name : 'trending'} movies:`, err);
    return [];
  } finally {
    try {
      await page.removeAllListeners();
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (e) {
      console.warn('⚠️ Error closing page:', e);
    }
  }
}

// Helper function to extract data from a single card
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
        if (match && match[1]) poster = match[1];
      }
    } catch (e) {
      // Poster extraction failed, continue without it
    }

    return { id, title, poster, detailPage, watchPage };
  } catch (err) {
    return null;
  }
}

// Keep your existing functions unchanged
export async function getStreamLinksFromWatchPage(browser: Browser, watchUrl: string): Promise<string[]> {
  const page = await browser.newPage();
  
  try {
    console.log(`🔗 Loading watch page: ${watchUrl}`);
    
    await page.goto(watchUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 10000 
    });

    console.log('⏳ Waiting for server buttons...');
    await page.waitForSelector('button', { timeout: 8000 });
    
    await new Promise(resolve => setTimeout(resolve, 1000));

    const existingVidFastIframes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src)
        .filter(src => src && src.includes('vidfast'));
    });

    if (existingVidFastIframes.length > 0) {
      console.log('✅ Found existing VidFast iframe(s), no click needed:', existingVidFastIframes);
      return existingVidFastIframes;
    }

    console.log('🔍 No existing VidFast iframes, looking for VidFast button...');
    
    const vidFastClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        
        if (text.includes('vidfast') || text.includes('vid fast') || text.includes('vf')) {
          console.log(`Clicking VidFast button: "${btn.textContent}"`);
          btn.click();
          return true;
        }
      }
      
      for (const btn of buttons) {
        const classList = Array.from(btn.classList).join(' ').toLowerCase();
        const id = (btn.id || '').toLowerCase();
        
        if (classList.includes('server') || id.includes('server')) {
          console.log(`Clicking server button: ${classList} ${id}`);
          btn.click();
          return true;
        }
      }
      
      return false;
    });

    if (vidFastClicked) {
      console.log('🖱️ Button clicked, waiting for iframe...');
      await new Promise(resolve => setTimeout(resolve, 2500));
    } else {
      console.warn('⚠️ No clickable button found');
    }

    const iframeLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src)
        .filter(src => src && (
          src.includes('vidfast') || 
          src.includes('movie') ||
          src.includes('embed')
        ));
    });

    console.log(`🎬 Extracted ${iframeLinks.length} iframe link(s):`, iframeLinks);
    return iframeLinks;

  } catch (err) {
    console.error(`❌ Error getting stream links from ${watchUrl}:`, err);
    return [];
  } finally {
    await page.close();
  }
}

export async function resolveM3U8FromEmbed(browser: Browser, embedUrl: string): Promise<string | null> {
  const page = await browser.newPage();
  let m3u8Url: string | null = null;

  await page.setRequestInterception(true);
  
  const handleRequest = (req: HTTPRequest) => {
    const url = req.url();
    if (url.includes('.m3u8')) {
      m3u8Url = url;
    }
    req.continue();
  };

  page.on('request', handleRequest);

  try {
    console.log(`🔗 Checking embed URL: ${embedUrl}`);
    await page.goto(embedUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 10000 
    });
    
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    try {
      await page.mouse.click(400, 300);
    } catch (clickErr) {
      console.warn('⚠️ Click failed, continuing anyway');
    }
    
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (err) {
    console.warn(`⚠️ Failed to load or interact with ${embedUrl}`);
  } finally {
    page.off('request', handleRequest);
    await page.removeAllListeners();
    await page.close();
  }

  return m3u8Url;
}