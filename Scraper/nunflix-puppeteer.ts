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
  await page.goto(watchUrl, { waitUntil: 'networkidle2' });

  try {
    // Wait for server list to be loaded
    await page.waitForSelector('button');

    // Click the "VidFast" server button
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.evaluate(el => el.textContent?.trim() || '');
      if (text.includes('VidFast')) {
        await btn.click();
        console.log('🖱️ Clicked VidFast server button');
        break;
      }
    }

    // Wait for iframe to load after switching server
    await new Promise(resolve => setTimeout(resolve, 3000)); // wait for iframe to update
    await page.waitForSelector('iframe', { timeout: 5000 });

    // Extract the current iframe's src
    const iframeLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe')).map((f) => f.src).filter(Boolean);
    });

    return iframeLinks;
  } catch (err) {
    console.warn(`⚠️ Error getting stream links from ${watchUrl}:`, err);
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