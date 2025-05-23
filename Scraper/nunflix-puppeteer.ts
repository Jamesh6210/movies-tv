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
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForSelector('a.movieCard', { timeout: 10000 });
    
    console.log('📜 Scrolling to load more movies...');
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const cards = await page.$$('a.movieCard');
    const movies: NunflixMovie[] = [];

    console.log(`🔢 Found ${cards.length} movie cards`);
    
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
    await page.removeAllListeners();
    await page.close();
  }
}

export async function getStreamLinksFromWatchPage(browser: Browser, watchUrl: string): Promise<string[]> {
  const page = await browser.newPage();
  
  try {
    console.log(`🔗 Loading watch page: ${watchUrl}`);
    await page.goto(watchUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 20000 
    });

    // Wait for the page to fully load and buttons to appear
    console.log('⏳ Waiting for server buttons to load...');
    await page.waitForSelector('button', { timeout: 15000 });
    
    // Give additional time for all buttons to render
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the current iframe src before clicking (if any exists)
    const oldIframeSrc = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      return iframe ? iframe.src : '';
    });

    console.log(`📺 Current iframe src: ${oldIframeSrc}`);

    // Find and click VidFast button with more robust detection
    const vidFastClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      console.log(`Found ${buttons.length} buttons on page`);
      
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        console.log(`Button text: "${text}"`);
        
        // More flexible matching for VidFast
        if (text.includes('vidfast') || text.includes('vid fast') || text.includes('vf')) {
          console.log(`Clicking VidFast button with text: "${btn.textContent}"`);
          btn.click();
          return true;
        }
      }
      
      // Fallback: look for buttons with server-like attributes or classes
      for (const btn of buttons) {
        const classList = Array.from(btn.classList).join(' ').toLowerCase();
        const id = (btn.id || '').toLowerCase();
        
        if (classList.includes('server') || classList.includes('vidfast') || 
            id.includes('server') || id.includes('vidfast')) {
          console.log(`Clicking server button with class/id: ${classList} ${id}`);
          btn.click();
          return true;
        }
      }
      
      return false;
    });

    if (!vidFastClicked) {
      console.warn('⚠️ No VidFast button found, checking existing iframes...');
      
      // If no button was found, check for existing iframes
      const existingIframes = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('iframe'))
          .map(f => f.src)
          .filter(src => src && (src.includes('vidfast') || src.includes('embed')));
      });
      
      if (existingIframes.length > 0) {
        console.log('✅ Found existing iframe(s):', existingIframes);
        return existingIframes;
      }
      
      return [];
    }

    console.log('🖱️ VidFast button clicked, waiting for iframe to update...');

    // Wait for iframe to change and contain vidfast
    try {
      await page.waitForFunction(
        (prevSrc) => {
          const iframe = document.querySelector('iframe');
          if (!iframe) return false;
          
          const currentSrc = iframe.src;
          const hasChanged = currentSrc !== prevSrc;
          const isVidFast = currentSrc.toLowerCase().includes('vidfast');
          
          console.log(`Iframe check - Changed: ${hasChanged}, IsVidFast: ${isVidFast}, Current: ${currentSrc}`);
          
          return hasChanged && (isVidFast || currentSrc.includes('embed'));
        },
        { timeout: 15000, polling: 500 },
        oldIframeSrc
      );
      
      console.log('✅ Iframe updated successfully');
    } catch (timeoutErr) {
      console.warn('⚠️ Timeout waiting for iframe to update, checking current state...');
    }

    // Give iframe a moment to fully load
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract all relevant iframe links
    const iframeLinks = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      console.log(`Found ${iframes.length} iframes total`);
      
      return iframes
        .map(f => {
          console.log(`Iframe src: ${f.src}`);
          return f.src;
        })
        .filter(src => src && (
          src.includes('vidfast') || 
          src.includes('embed') ||
          src.includes('movie')
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
      console.log(`🎯 Found M3U8 URL: ${url}`);
      m3u8Url = url;
    }
    
    req.continue();
  };

  page.on('request', handleRequest);

  try {
    console.log(`🔗 Resolving M3U8 from embed: ${embedUrl}`);
    await page.goto(embedUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 15000 
    });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try multiple click strategies to trigger video playback
    try {
      // Click in center of page
      await page.mouse.click(400, 300);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Look for and click play buttons
      const playButtonClicked = await page.evaluate(() => {
        const playSelectors = [
          'button[aria-label*="play"]',
          'button[title*="play"]',
          '.play-button',
          '.video-play-button',
          '[class*="play"]',
          'video'
        ];
        
        for (const selector of playSelectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            (elements[0] as HTMLElement).click();
            console.log(`Clicked play button: ${selector}`);
            return true;
          }
        }
        return false;
      });
      
      if (playButtonClicked) {
        console.log('🎮 Play button clicked');
      }
      
    } catch (clickErr) {
      console.warn('⚠️ Click interaction failed:', clickErr);
    }
    
    // Wait for potential M3U8 request
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    // If no M3U8 found, try to extract from page source or network
    if (!m3u8Url) {
      console.log('🔍 No M3U8 found in requests, checking page content...');
      
      const pageM3U8 = await page.evaluate(() => {
        const text = document.body.innerText || document.body.textContent || '';
        const scripts = Array.from(document.scripts).map(s => s.textContent || '').join('\n');
        const combined = text + '\n' + scripts;
        
        const m3u8Match = combined.match(/(https?:\/\/[^\s'"]+\.m3u8[^\s'"]*)/gi);
        return m3u8Match ? m3u8Match[0] : null;
      });
      
      if (pageM3U8) {
        console.log(`📄 Found M3U8 in page content: ${pageM3U8}`);
        m3u8Url = pageM3U8;
      }
    }
    
  } catch (err) {
    console.warn(`⚠️ Failed to resolve M3U8 from ${embedUrl}:`, err);
  } finally {
    page.off('request', handleRequest);
    await page.removeAllListeners();
    await page.close();
  }

  return m3u8Url;
}