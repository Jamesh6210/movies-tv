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

    // Wait for page to load and try multiple selectors for genre elements
    await new Promise(resolve => setTimeout(resolve, 3000));

    const genres = await page.evaluate(() => {
      const genres: { name: string; selector: string }[] = [];
      
      // Try multiple possible selectors for genre buttons/elements
      const possibleSelectors = [
        'button', // regular buttons
        '[role="button"]', // elements with button role
        '.genre-button', // genre-specific class
        '.filter-button', // filter button class
        'div[onclick]', // clickable divs
        'span[onclick]', // clickable spans
        '*[data-genre]', // elements with genre data attribute
        '.btn', // bootstrap-style buttons
      ];
      
      for (const selector of possibleSelectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        
        elements.forEach((element, index) => {
          const text = element.textContent?.trim();
            if (text && 
                text !== 'All' && 
                text !== 'Clear' && 
                !text.includes('Sort') && 
                !text.includes('Filter') &&
                text.length < 20 && // Genre names should be short
                text.length > 2) { // But not too short
              
              // Check if it looks like a genre name
              const genreKeywords = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 
                                   'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 
                                   'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 
                                   'TV Movie', 'Thriller', 'War', 'Western'];
              
              if (genreKeywords.some(keyword => text.includes(keyword)) || 
                  text.match(/^[A-Z][a-z\s]+$/)) { // Starts with capital, contains letters/spaces
                
                // Avoid duplicates
                if (!genres.some(g => g.name === text)) {
                  genres.push({
                    name: text,
                    selector: `${selector}:nth-of-type(${index + 1})`
                  });
                }
              }
            }
        });
        
        if (genres.length > 0) break; // Stop if we found genres
      }
      
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
      
      // Wait for page elements to be available
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Clear any existing selections first
      await page.evaluate(() => {
        // Try to find and click clear/reset button
        const possibleClearSelectors = [
          'button:contains("Clear")',
          'button:contains("Reset")',
          'button:contains("All")',
          '[data-clear]',
          '.clear-button'
        ];
        
        for (const selector of possibleClearSelectors) {
          const clearButton = Array.from(document.querySelectorAll('button'))
            .find(btn => btn.textContent?.trim().toLowerCase().includes('clear') ||
                        btn.textContent?.trim().toLowerCase().includes('all') ||
                        btn.textContent?.trim().toLowerCase().includes('reset'));
          if (clearButton) {
            (clearButton as HTMLButtonElement).click();
            return true;
          }
        }
        return false;
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Click the specific genre element
      const genreClicked = await page.evaluate((genreName) => {
        // Try multiple strategies to find and click the genre
        const strategies = [
          // Strategy 1: Find by exact text match
          () => {
            const allElements = Array.from(document.querySelectorAll('*'));
            for (const element of allElements) {
              if (element.textContent?.trim() === genreName && 
                  (element.tagName === 'BUTTON' || 
                   element.getAttribute('role') === 'button' ||
                   element.hasAttribute('onclick') ||
                   element.classList.contains('clickable') ||
                   window.getComputedStyle(element).cursor === 'pointer')) {
                (element as HTMLElement).click();
                return true;
              }
            }
            return false;
          },
          
          // Strategy 2: Find by partial text match in clickable elements
          () => {
            const clickableElements = Array.from(document.querySelectorAll('[onclick], [role="button"], button, .btn'));
            for (const element of clickableElements) {
              if (element.textContent?.trim().includes(genreName)) {
                (element as HTMLElement).click();
                return true;
              }
            }
            return false;
          },
          
          // Strategy 3: Look for genre-specific attributes or classes
          () => {
            const genreElements = Array.from(document.querySelectorAll('[data-genre], .genre, .filter-tag'));
            for (const element of genreElements) {
              if (element.textContent?.trim() === genreName) {
                (element as HTMLElement).click();
                return true;
              }
            }
            return false;
          }
        ];
        
        for (const strategy of strategies) {
          if (strategy()) return true;
        }
        
        return false;
      }, genre.name);
      
      if (!genreClicked) {
        console.warn(`⚠️ Could not click genre element for: ${genre.name}`);
        console.log('🔍 Attempting to inspect page structure...');
        
        // Debug: log page structure
        await page.evaluate(() => {
          console.log('Available clickable elements:');
          const clickables = Array.from(document.querySelectorAll('button, [role="button"], [onclick], .btn'));
          clickables.forEach((el, i) => {
            console.log(`${i}: ${el.tagName} - "${el.textContent?.trim()}" - classes: ${el.className}`);
          });
        });
      }
      
      // Wait for page to update with filtered results
      await new Promise(resolve => setTimeout(resolve, 4000));
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