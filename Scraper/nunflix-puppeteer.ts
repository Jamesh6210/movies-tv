import type { Browser, HTTPRequest, HTTPResponse } from 'puppeteer';

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

  await page.goto(`${BASE_URL}/explore/movie?sort=popularity.desc`, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  await page.waitForSelector('a.movieCard');

  // Scroll down to load more content
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

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
      const bgString = await page.evaluate(el => window.getComputedStyle(el).backgroundImage, lazyEl);
      const match = bgString.match(/url\(["']?(.*?)["']?\)/);
      if (match && match[1]) poster = match[1];
    }

    movies.push({ id, title, poster, detailPage, watchPage });
  }

  await page.close();
  return movies;
}

export async function getStreamLinksFromWatchPage(browser: Browser, watchUrl: string): Promise<string[]> {
  const page = await browser.newPage();
  await page.goto(watchUrl, { waitUntil: 'networkidle2' });
  await page.waitForSelector('iframe', { timeout: 5000 }).catch(() => null);

  const iframeLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map((f) => f.src).filter(Boolean);
  });

  await page.close();
  return iframeLinks;
}

export async function resolveM3U8FromEmbed(
  browser: Browser,
  embedUrl: string,
  maxAttempts = 2
): Promise<string | null> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    const page = await browser.newPage();
    let m3u8Url: string | null = null;

    const handleRequest = (req: HTTPRequest) => {
      const url = req.url();
      if (url.includes('.m3u8')) {
        m3u8Url = url;
      }
    };

    const handleResponse = (res: HTTPResponse) => {
      const url = res.url();
      if (url.includes('.m3u8')) {
        m3u8Url = url;
      }
    };

    page.on('request', handleRequest);
    page.on('response', handleResponse);

    try {
      console.log(`🔁 Attempt ${attempt + 1} for ${embedUrl}`);
      await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 20000 });

      await new Promise((res) => setTimeout(res, 3000));
      await page.mouse.click(400, 300); // try to start video
      await new Promise((res) => setTimeout(res, 8000)); // longer wait to trigger stream

      if (m3u8Url) {
        console.log(`🎯 Found .m3u8 on attempt ${attempt + 1}`);
        return m3u8Url;
      }
    } catch (err) {
      console.warn(`⚠️ Embed load failed on attempt ${attempt + 1}: ${err}`);
    } finally {
      page.off('request', handleRequest);
      page.off('response', handleResponse);
      await page.close();
    }

    attempt++;
  }

  console.warn(`❌ No .m3u8 found after ${maxAttempts} attempts for: ${embedUrl}`);
  return null;
}
