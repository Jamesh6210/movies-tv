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
  selector: string; // The selector to click for this genre
}

// Function to get available genres from the page
export async function getAvailableGenres(browser: Browser): Promise<GenreInfo[]> {
  const page = await browser.newPage();
  
  try {
    console.log('🔍 Getting available genres...');
    await page.goto(`${BASE_URL}/explore/movie?sort=popularity.desc`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for genre buttons to load
    await page.waitForSelector('button', { timeout: 10000 });

    const genres = await page.evaluate(() => {
      const genreButtons = Array.from(document.querySelectorAll('button'));
      const genres: { name: string; selector: string }[] = [];
      
      genreButtons.forEach((button, index) => {
        const text = button.textContent?.trim();
        if (text && text !== 'All' && text !== 'Clear' && !text.includes('Sort')) {
          // Create a unique selector for this button
          const selector = `button:nth-of-type(${index + 1})`;
          genres.push({
            name: text,
            selector: selector
          });
        }
      });
      
      return genres;
    });

    console.log(`📂 Found ${genres.length} genres:`, genres.map(g => g.name));
    return genres;
    
  } catch (err) {
    console.error('❌ Error getting genres:', err);
    return [];
  } finally {
    await page.close();
  }
}

// Modified function to get movies with optional genre filtering
export async function getTrendingMoviesPuppeteer(
  browser: Browser, 
  genre?: GenreInfo,
  limit: number = 25
): Promise<NunflixMovie[]> {
  const page = await browser.newPage();
  
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
    const pageTitle = genre ? `${genre.name} movies` : 'trending movies';
    console.log(`🔍 Navigating to ${pageTitle} page...`);
    
    await page.goto(`${BASE_URL}/explore/movie?sort=popularity.desc`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // If genre is specified, click the genre button
    if (genre) {
      console.log(`🎭 Filtering by genre: ${genre.name}`);
      
      // Wait for buttons to be available
      await page.waitForSelector('button', { timeout: 10000 });
      
      // Clear any existing selections first
      await page.evaluate(() => {
        const clearButton = Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent?.trim().toLowerCase().includes('clear'));
        if (clearButton) {
          (clearButton as HTMLButtonElement).click();
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Click the specific genre button
      const genreClicked = await page.evaluate((selector) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (let i = 0; i < buttons.length; i++) {
          const button = buttons[i];
          const text = button.textContent?.trim();
          if (text === selector) {
            (button as HTMLButtonElement).click();
            return true;
          }
        }
        return false;
      }, genre.name);
      
      if (!genreClicked) {
        console.warn(`⚠️ Could not click genre button for: ${genre.name}`);
      }
      
      // Wait for page to update with filtered results
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    await page.waitForSelector('a.movieCard', { timeout: 10000 });
    
    console.log(`📜 Scrolling to load more ${pageTitle}...`);
    // Scroll to load more movies
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const cards = await page.$$('a.movieCard');
    const movies: NunflixMovie[] = [];

    console.log(`🔢 Found ${cards.length} movie cards for ${pageTitle}`);
    
    // Process movies up to the limit
    for (let i = 0; i < Math.min(cards.length, limit + 5); i++) { // +5 buffer for invalid entries
      const card = cards[i];
      
      try {
        const href = await card.evaluate(el => el.getAttribute('href'));
        const idMatch = href?.match(/\/movie\/(\d+)/);
        if (!idMatch) continue;

        const id = idMatch[1];
        const detailPage = `${BASE_URL}${href}`;
        const watchPage = `${BASE_URL}/watch/movie/${id}`;
        const rawTitle = await card.$eval('.textBlock', el => el.textContent?.trim() || '');
        const title = rawTitle.replace(/\s*\d{4}.*$/, '').trim();

        let poster = '';
        const lazyEl = await card.$('.posterBlock span.lazy-load-image-background');
        if (lazyEl) {
          const bgString = await page.evaluate(el => window.getComputedStyle(el).backgroundImage, lazyEl);
          const match = bgString.match(/url\(["']?(.*?)["']?\)/);
          if (match && match[1]) poster = match[1];
        }

        movies.push({ id, title, poster, detailPage, watchPage });
        
        if (movies.length >= limit) break;
      } catch (err) {
        console.warn(`⚠️ Error extracting movie info from card ${i}:`, err);
      }
    }

    return movies;
  } catch (err) {
    console.error(`❌ Error getting ${genre ? genre.name : 'trending'} movies:`, err);
    return [];
  } finally {
    await page.removeAllListeners();
    await page.close();
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