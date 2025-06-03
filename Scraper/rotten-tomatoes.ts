import puppeteer from 'puppeteer';

export async function fetchRottenTomatoesScore(title: string): Promise<number | null> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  try {
    // Set user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(`https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await new Promise(r => setTimeout(r, 2000));
    // Wait for search results to load
    await page.waitForSelector('search-page-result', { timeout: 10000 });

    const score = await page.evaluate(() => {
      // Try multiple selectors for different page layouts
      const selectors = [
        'search-page-result[type="movie"] span[data-qa="tomatometer"]', // New layout
        'search-page-media-row[slot="movies"] span[data-qa="tomatometer"]', // Alternate layout
        'span.percentage', // Fallback
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.textContent?.trim().replace('%', '');
          return text ? parseInt(text) : null;
        }
      }
      return null;
    });

    return score;
  } catch (err) {
    console.error(`Error fetching RT score for "${title}":`, err);
    return null;
  } finally {
    await browser.close();
  }
}