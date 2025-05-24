import puppeteer, { Browser, HTTPRequest } from 'puppeteer';

const BASE_URL = 'https://nunflix.org';

export interface NunflixMovie {
  id: string;
  title: string;
  poster: string;
  detailPage: string;
  watchPage: string;
}

export async function getTrendingMoviesPuppeteer(browser: Browser): Promise<NunflixMovie[]> {
  const page = await browser.newPage();
  
  // Optimize page for minimal resource usage
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    // Block unnecessary resources
    if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
      request.abort();
    } else {
      request.continue();
    }
  });
  
  try {
    console.log('🔍 Navigating to movies page...');
    await page.goto(`${BASE_URL}/explore/movie?sort=popularity.desc`, {
      waitUntil: 'domcontentloaded', // Less resource-heavy than networkidle2
      timeout: 30000,
    });

    await page.waitForSelector('a.movieCard', { timeout: 10000 });
    
    // Scroll fewer times to reduce memory usage
    console.log('📜 Scrolling to load more movies...');
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const cards = await page.$$('a.movieCard');
    const movies: NunflixMovie[] = [];

    console.log(`🔢 Found ${cards.length} movie cards`);
    
    // Process only what we need (up to 25 to ensure we get 20 valid)
    for (let i = 0; i < Math.min(cards.length, 25); i++) {
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
      } catch (err) {
        console.warn(`⚠️ Error extracting movie info from card ${i}:`, err);
      }
    }

    return movies;
  } catch (err) {
    console.error('❌ Error getting trending movies:', err);
    return [];
  } finally {
    // Make sure we clean up
    await page.removeAllListeners();
    await page.close();
  }
}

export async function getStreamLinksFromWatchPage(browser: Browser, watchUrl: string): Promise<string[]> {
  const page = await browser.newPage();
  
  try {
    console.log(`🔗 Loading watch page: ${watchUrl}`);
    
    // Use domcontentloaded for faster initial load, but with shorter timeout
    await page.goto(watchUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 10000 
    });

    // Wait for buttons with shorter timeout
    console.log('⏳ Waiting for server buttons...');
    await page.waitForSelector('button', { timeout: 8000 });
    
    // Shorter wait for buttons to render
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check for existing iframes first (handles first 2 movies case)
    const existingIframes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src)
        .filter(src => src && (src.includes('vidfast') || src.includes('movie') || src.includes('embed')));
    });

    if (existingIframes.length > 0) {
      console.log('✅ Found existing iframe(s), no click needed:', existingIframes);
      return existingIframes;
    }

    // No existing iframes, try to click VidFast button
    console.log('🔍 No existing iframes, looking for VidFast button...');
    
    const vidFastClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        
        // Flexible matching for VidFast
        if (text.includes('vidfast') || text.includes('vid fast') || text.includes('vf')) {
          console.log(`Clicking VidFast button: "${btn.textContent}"`);
          btn.click();
          return true;
        }
      }
      
      // Fallback: look for first server button
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
      // Shorter wait time - just enough for iframe to load
      await new Promise(resolve => setTimeout(resolve, 2500));
    } else {
      console.warn('⚠️ No clickable button found');
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

  // Only capture M3U8 requests
  await page.setRequestInterception(true);
  
  const handleRequest = (req: HTTPRequest) => {
    const url = req.url();
    if (url.includes('.m3u8')) {
      m3u8Url = url;
    }
    
    // Continue all requests to ensure page works
    req.continue();
  };

  page.on('request', handleRequest);

  try {
    console.log(`🔗 Checking embed URL: ${embedUrl}`);
    await page.goto(embedUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 10000 
    });
    
    // Wait shorter time to avoid hangs
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // Attempt to click the play button
    try {
      await page.mouse.click(400, 300);
    } catch (clickErr) {
      console.warn('⚠️ Click failed, continuing anyway');
    }
    
    // Wait for potential m3u8 request to be captured
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