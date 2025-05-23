import puppeteer from 'puppeteer';
import {
  getTrendingMoviesPuppeteer,
  getStreamLinksFromWatchPage,
  resolveM3U8FromEmbed,
} from './Scraper/nunflix-puppeteer';

import { exportToM3U, M3UItem } from './export';
import { fetchTMDBInfo } from './Scraper/tmdb';
import type { NunflixMovie } from './Scraper/nunflix-puppeteer';
import type { Browser } from 'puppeteer';

function cleanMovieTitle(rawTitle: string): string {
  return rawTitle
    .replace(/([a-zA-Z\d])((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?\d{1,2},\s?\d{2})/, '$1 $2')
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{2}\b/gi, '')
    .replace(/\u2022.*/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('⏱️ Timeout exceeded')), ms);

    promise
      .then((res) => {
        clearTimeout(timeoutId);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

async function processMovie(movie: NunflixMovie, browser: Browser): Promise<M3UItem | null> {
  console.log(`\n🎬 ${movie.title}`);
  console.log(`Watch page: ${movie.watchPage}`);

  const embedLinks = await getStreamLinksFromWatchPage(browser, movie.watchPage);
  console.log(`\n🧩 Trying VidFast server for: ${movie.title}`);

  // Ensure there are at least 5 servers
  if (embedLinks.length < 5) {
    console.log('❌ VidFast (5th server) not available.');
    return null;
  }

  const vidFastEmbed = embedLinks[4]; // 5th server
  const m3u8 = await resolveM3U8FromEmbed(browser, vidFastEmbed);

  if (!m3u8) {
    console.log('❌ No .m3u8 found from VidFast server.');
    return null;
  }

  console.log(`✅ Found .m3u8: ${m3u8}`);


  const cleanTitle = cleanMovieTitle(movie.title);
  console.log(`🧪 Raw title: "${movie.title}"`);
  console.log(`🔎 Cleaned title for TMDb: "${cleanTitle}"`);

  const tmdbInfo = await fetchTMDBInfo(cleanTitle);
  if (!tmdbInfo) {
    console.log(`⚠️ TMDb not found: ${movie.title} — using fallback info.`);
  }

  return {
    title: tmdbInfo?.title || movie.title,
    logo: tmdbInfo?.posterUrl || movie.poster || '',
    group: 'Movies',
    streamUrl: m3u8,
    description: tmdbInfo ? `IMDb ${tmdbInfo.rating}` : '',
  };
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const items: M3UItem[] = [];

  try {
    const movies = await getTrendingMoviesPuppeteer(browser);

    for (const movie of movies.slice(0, 40)) {
      try {
        const item = await withTimeout(processMovie(movie, browser), 30000);
        if (item) {
          items.push(item);
          console.log(`✅ Playlist so far: ${items.length} items`);
        }
      } catch (err) {
        console.warn(`⚠️ Skipped "${movie.title}" due to timeout or error.`);
      }
    }

    if (items.length > 0) {
      exportToM3U('movies&tvshows.m3u', items);
      console.log(`✅ M3U exported with ${items.length} items.`);
    } else {
      console.log('⚠️ No playable streams found to export.');
    }
  } catch (err) {
    console.error('❌ Error in main flow:', err);
  } finally {
    const pages = await browser.pages();
    for (const page of pages) {
      try {
        if (!page.isClosed()) await page.close();
      } catch (_) {}
    }
    await browser.close();
    console.log('🧹 Browser closed, script finished.');

    // ✅ Final cleanup for GitHub Actions
    process.exit(0);
  }
})();