import puppeteer, { Browser, Page } from 'puppeteer';

export async function getM3U8FromVidFast(browser: Browser, tmdbId: number): Promise<string | null> {
  const page = await browser.newPage();
  let m3u8Url: string | null = null;

  // Set up request interception to capture .m3u8 URLs
  await page.setRequestInterception(true);
  
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('.m3u8')) {
      m3u8Url = url;
      console.log(`Found m3u8: ${url}`);
    }
    req.continue();
  });

  try {
    const vidFastUrl = `https://vidfast.pro/movie/${tmdbId}`;
    console.log(`Checking VidFast URL: ${vidFastUrl}`);
    
    await page.goto(vidFastUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 15000 
    });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try to click play button or trigger video loading
    try {
      // Look for common play button selectors
      const playSelectors = [
        'button[class*="play"]',
        '.play-button',
        '.video-play-button',
        'button[aria-label*="play"]',
        '[data-testid*="play"]',
        '.vjs-big-play-button',
        '.plyr__control--overlaid'
      ];
      
      for (const selector of playSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 2000 });
          await page.click(selector);
          console.log(`Clicked play button: ${selector}`);
          break;
        } catch (e) {
          continue;
        }
      }
    } catch (e) {
      // If no play button found, try clicking in the center of the page
      await page.mouse.click(400, 300);
    }
    
    // Wait for m3u8 request to be intercepted
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // If no m3u8 found yet, try scrolling and clicking around
    if (!m3u8Url) {
      await page.evaluate(() => {
        window.scrollTo(0, window.innerHeight / 2);
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try clicking video element directly
      try {
        await page.click('video');
      } catch (e) {}
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
  } catch (err) {
    console.warn(`Failed to load VidFast page for movie ${tmdbId}:`, err);
  } finally {
    await page.close();
  }

  return m3u8Url;
}

export async function createBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images',
      '--disable-javascript-harmony-shipping',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    protocolTimeout: 60000,
  });
}