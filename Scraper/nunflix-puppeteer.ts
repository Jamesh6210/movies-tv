import puppeteer, { Browser, HTTPRequest, Page } from 'puppeteer';

const BASE_URL = 'https://nunflix.org';

// Configuration constants
const SCRAPER_CONFIG = {
  TIMEOUTS: {
    DEFAULT: 45000,
    NAVIGATION: 45000,
    SELECTOR_WAIT: 10000,
    CARD_PROCESSING: 5000,
    EMBED_LOADING: 10000,
  },
  DELAYS: {
    AFTER_CLICK: 2500,
    SCROLL_INTERVAL: 1500,
    INTERACTION_WAIT: 3000,
    CONTENT_STABILIZATION: 2000,
  },
  SCROLL_ATTEMPTS: 8,
} as const;

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

/**
 * Returns available movie genres
 */
export async function getAvailableGenres(): Promise<GenreInfo[]> {
  const genres: GenreInfo[] = [
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

  console.log(`Using ${genres.length} predefined genres`);
  return genres;
}

/**
 * Gets trending movies or movies from a specific genre
 */
export async function getTrendingMoviesPuppeteer(
  browser: Browser, 
  genre?: GenreInfo,
  limit: number = 25
): Promise<NunflixMovie[]> {
  const page = await browser.newPage();
  
  try {
    await setupPage(page);
    
    const targetUrl = `${BASE_URL}/explore/movie?sort=popularity.desc`;
    const pageType = genre ? `${genre.name} movies` : 'trending movies';
    
    console.log(`Navigating to explore page for: ${pageType}`);
    console.log(`URL: ${targetUrl}`);
    
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: SCRAPER_CONFIG.TIMEOUTS.NAVIGATION,
    });

    if (genre) {
      await selectGenre(page, genre);
    }

    await stabilizeContent(page);
    const movies = await extractMovies(page, limit, pageType);
    
    console.log(`Successfully extracted ${movies.length} movies for ${pageType}`);
    return movies;

  } catch (error) {
    console.error(`Error getting ${genre ? genre.name : 'trending'} movies:`, error);
    return [];
  } finally {
    await closePage(page);
  }
}

/**
 * Sets up page with optimized settings
 */
async function setupPage(page: Page): Promise<void> {
  page.setDefaultTimeout(SCRAPER_CONFIG.TIMEOUTS.DEFAULT);
  page.setDefaultNavigationTimeout(SCRAPER_CONFIG.TIMEOUTS.NAVIGATION);
  
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
      request.abort();
    } else {
      request.continue();
    }
  });
}

/**
 * Selects a specific genre on the page
 */
async function selectGenre(page: Page, genre: GenreInfo): Promise<void> {
  console.log(`Selecting genre: ${genre.name}`);
  
  try {
    // Deselect previously selected genres
    await page.evaluate(() => {
      const activeButtons = document.querySelectorAll('button[class*="active"], button.selected');
      activeButtons.forEach(btn => (btn as HTMLElement).click());
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Click the desired genre button
    const genreClicked = await page.evaluate((genreName) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        const classList = Array.from(btn.classList).join(' ').toLowerCase();
        
        if (text === genreName.toLowerCase() || 
            text.includes(genreName.toLowerCase()) ||
            classList.includes(genreName.toLowerCase().replace(' ', ''))) {
          console.log(`Clicking genre button: "${btn.textContent}"`);
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, genre.buttonText);

    if (genreClicked) {
      console.log(`Successfully selected ${genre.name} genre`);
      await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.DELAYS.INTERACTION_WAIT));
    } else {
      console.warn(`Could not find genre button for: ${genre.name}`);
      await tryAlternativeGenreSelection(page, genre);
    }
  } catch (error) {
    console.warn(`Error selecting genre ${genre.name}:`, error);
  }
}

/**
 * Tries alternative methods to select genre
 */
async function tryAlternativeGenreSelection(page: Page, genre: GenreInfo): Promise<void> {
  const alternativeClicked = await page.evaluate((genreName) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const words = genreName.toLowerCase().split(' ');
    
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (words.some(word => text.includes(word))) {
        console.log(`Clicking alternative genre button: "${btn.textContent}"`);
        (btn as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, genre.buttonText);
  
  if (alternativeClicked) {
    console.log(`Successfully clicked alternative button for ${genre.name}`);
    await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.DELAYS.INTERACTION_WAIT));
  } else {
    console.warn(`No matching button found for genre: ${genre.name}`);
  }
}

/**
 * Waits for content to stabilize after navigation/filtering
 */
async function stabilizeContent(page: Page): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.DELAYS.CONTENT_STABILIZATION));
}

/**
 * Extracts movies from the current page
 */
async function extractMovies(page: Page, limit: number, pageType: string): Promise<NunflixMovie[]> {
  const cardSelectors = ['a.movieCard', '.movie-card', '[href*="/movie/"]', '.card'];
  let cards: any[] = [];
  
  // Find movie cards using multiple selectors
  for (const selector of cardSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: SCRAPER_CONFIG.TIMEOUTS.SELECTOR_WAIT });
      cards = await page.$$(selector);
      if (cards.length > 0) {
        console.log(`Found ${cards.length} cards using selector: ${selector}`);
        break;
      }
    } catch (error) {
      console.log(`Selector ${selector} not found, trying next...`);
    }
  }

  if (cards.length === 0) {
    console.log('No movie cards found with any selector');
    return [];
  }
  
  // Scroll to load more content
  await scrollToLoadMore(page, pageType);
  
  // Re-get cards after scrolling
  cards = await page.$$('a.movieCard');
  const movies: NunflixMovie[] = [];

  console.log(`Processing ${Math.min(cards.length, limit)} movie cards for ${pageType}`);
  
  // Extract movie data from cards
  for (let i = 0; i < Math.min(cards.length, limit + 10); i++) {
    const card = cards[i];
    
    try {
      const cardData = await Promise.race([
        extractCardData(card, page),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Card timeout')), SCRAPER_CONFIG.TIMEOUTS.CARD_PROCESSING)
        )
      ]) as NunflixMovie | null;

      if (cardData && cardData.id) {
        movies.push(cardData);
        if (movies.length >= limit) break;
      }
    } catch (error) {
      console.warn(`Skipped card ${i}: ${error}`);
      continue;
    }
  }

  return movies;
}

/**
 * Scrolls the page to load more content
 */
async function scrollToLoadMore(page: Page, pageType: string): Promise<void> {
  console.log(`Scrolling to load more ${pageType}...`);
  
  for (let i = 0; i < SCRAPER_CONFIG.SCROLL_ATTEMPTS; i++) {
    try {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.DELAYS.SCROLL_INTERVAL));
    } catch (error) {
      console.log(`Scroll attempt ${i} failed, continuing...`);
      break;
    }
  }
}

/**
 * Extracts data from a single movie card
 */
async function extractCardData(card: any, page: Page): Promise<NunflixMovie | null> {
  try {
    const href = await card.evaluate((el: Element) => el.getAttribute('href'));
    const idMatch = href?.match(/\/movie\/(\d+)/);
    if (!idMatch) return null;

    const id = idMatch[1];
    const detailPage = `${BASE_URL}${href}`;
    const watchPage = `${BASE_URL}/watch/movie/${id}`;

    const rawTitle = await card.$eval('.textBlock', (el: Element) => 
      el.textContent?.trim() || ''
    ).catch(() => '');
    
    const title = rawTitle.replace(/\s*\d{4}.*$/, '').trim();

    let poster = '';
    try {
      const lazyEl = await card.$('.posterBlock span.lazy-load-image-background');
      if (lazyEl) {
        const bgString = await page.evaluate(el => 
          window.getComputedStyle(el).backgroundImage, lazyEl
        );
        const match = bgString.match(/url\(["']?(.*?)["']?\)/);
        if (match && match[1]) poster = match[1];
      }
    } catch (error) {
      // Poster extraction failed, continue without it
    }

    let quality: string | undefined = undefined;
    try {
      quality = await card.$eval('.qualityTag', (el: Element) => 
        el.textContent?.trim() || ''
      );
    } catch (error) {
      // No quality tag found
    }

    return { id, title, poster, detailPage, watchPage, quality };
  } catch (error) {
    return null;
  }
}

/**
 * Gets stream links from a movie's watch page
 */
export async function getStreamLinksFromWatchPage(browser: Browser, watchUrl: string): Promise<string[]> {
  const page = await browser.newPage();
  
  try {
    console.log(`Loading watch page: ${watchUrl}`);
    
    await page.goto(watchUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: SCRAPER_CONFIG.TIMEOUTS.EMBED_LOADING 
    });

    console.log('Waiting for server buttons...');
    await page.waitForSelector('button', { timeout: 8000 });
    
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check for existing VidFast iframes
    const existingVidFastIframes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src)
        .filter(src => src && src.includes('vidfast'));
    });

    if (existingVidFastIframes.length > 0) {
      console.log('Found existing VidFast iframe(s):', existingVidFastIframes);
      return existingVidFastIframes;
    }

    console.log('No existing VidFast iframes, looking for VidFast button...');
    
    // Try to click VidFast button
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
      
      // Fallback: click any server button
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
      console.log('Button clicked, waiting for iframe...');
      await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.DELAYS.AFTER_CLICK));
    } else {
      console.warn('No clickable button found');
    }

    // Extract iframe links
    const iframeLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src)
        .filter(src => src && (
          src.includes('vidfast') || 
          src.includes('movie') ||
          src.includes('embed')
        ));
    });

    console.log(`Extracted ${iframeLinks.length} iframe link(s):`, iframeLinks);
    return iframeLinks;

  } catch (error) {
    console.error(`Error getting stream links from ${watchUrl}:`, error);
    return [];
  } finally {
    await page.close();
  }
}

/**
 * Resolves M3U8 stream URL from embed page
 */
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
    console.log(`Checking embed URL: ${embedUrl}`);
    await page.goto(embedUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: SCRAPER_CONFIG.TIMEOUTS.EMBED_LOADING 
    });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try to interact with the video player
    try {
      await page.mouse.click(400, 300);
    } catch (clickError) {
      console.warn('Click interaction failed, continuing anyway');
    }
    
    // Wait for potential M3U8 requests
    await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.DELAYS.INTERACTION_WAIT));
    
  } catch (error) {
    console.warn(`Failed to load or interact with ${embedUrl}`);
  } finally {
    page.off('request', handleRequest);
    await page.removeAllListeners();
    await page.close();
  }

  return m3u8Url;
}

/**
 * Safely closes a page with error handling
 */
async function closePage(page: Page): Promise<void> {
  try {
    await page.removeAllListeners();
    if (!page.isClosed()) {
      await page.close();
    }
  } catch (error) {
    console.warn('Error closing page:', error);
  }
}