import puppeteer from 'puppeteer';

const BASE_URL = 'https://nunflix.org';

export interface NunflixMovie {
  id: string;
  title: string;
  poster: string;
  detailPage: string;
  watchPage: string;
}

export async function getTrendingMoviesPuppeteer(): Promise<NunflixMovie[]> {
  const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  await page.goto(`${BASE_URL}/explore/movie?sort=popularity.desc`, {
    waitUntil: 'networkidle2',
    timeout: 60000, // wait up to 60 seconds
  });
  

  await page.waitForSelector('a.movieCard');
  await new Promise(resolve => setTimeout(resolve, 1000));


  const cards = await page.$$('a.movieCard');
  const movies: NunflixMovie[] = [];

  for (const card of cards) {
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
      const bgString = await page.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.backgroundImage;
      }, lazyEl);

      const match = bgString.match(/url\(["']?(.*?)["']?\)/);
      if (match && match[1]) {
        poster = match[1];
      }
    }

    movies.push({ id, title, poster, detailPage, watchPage });
  }

  await browser.close();
  return movies;
}

export async function getStreamLinksFromWatchPage(watchUrl: string): Promise<string[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  
    const page = await browser.newPage();
  
    await page.goto(watchUrl, { waitUntil: 'networkidle2' });
  
    // Wait for iframes or the server list to load
    await page.waitForSelector('iframe', { timeout: 5000 }).catch(() => null);
  
    const iframeLinks = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      return iframes.map((frame) => frame.src).filter(Boolean);
    });
  
    await browser.close();
    return iframeLinks;
  }
  
  export async function resolveM3U8FromEmbed(embedUrl: string): Promise<string | null> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  
    const page = await browser.newPage();
    let m3u8Url: string | null = null;
  
    // Listen for network requests
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('.m3u8')) {
        m3u8Url = url;
      }
    });
  
    try {
      await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 15000 });
  
      // Wait for iframe or player to load
      await new Promise(resolve => setTimeout(resolve, 3000));

  
      // Simulate click on video player area (usually triggers video load)
      await page.mouse.click(400, 300); // Adjust coords as needed
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (err) {
      console.warn(`⚠️ Failed to load or interact with ${embedUrl}`);
    }
  
    await browser.close();
    return m3u8Url;
  }
  
