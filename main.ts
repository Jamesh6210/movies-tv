import puppeteer from 'puppeteer';
import {
  getTrendingMoviesPuppeteer,
  getStreamLinksFromWatchPage,
  resolveM3U8FromEmbed,
} from './Scraper/nunflix-puppeteer';

import { exportToM3U, M3UItem } from './export';
import { fetchTMDBInfo } from './Scraper/tmdb';

function cleanMovieTitle(rawTitle: string): string {
  return rawTitle
    .replace(/([a-zA-Z\d])((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?\d{1,2},\s?\d{2})/, '$1 $2')
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{2}\b/gi, '')
    .replace(/•.*/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

import type { Browser } from 'puppeteer';
import type { NunflixMovie } from './Scraper/nunflix-puppeteer';

async function processMovie(movie: NunflixMovie, browser: Browser): Promise<M3UItem | null> {

  console.log(`\n🎬 ${movie.title}`);
  console.log(`Watch page: ${movie.watchPage}`);

  const embedLinks = await getStreamLinksFromWatchPage(browser, movie.watchPage);
  console.log(`\n🧩 Trying up to 3 servers for: ${movie.title}`);

  const limitedLinks = embedLinks.slice(0, 3);
  const results = await Promise.allSettled(
    limitedLinks.map((embed) => resolveM3U8FromEmbed(browser, embed))
  );

  const successful = results.find(
    (res): res is PromiseFulfilledResult<string> => res.status === 'fulfilled' && !!res.value
  );

  const m3u8 = successful?.value;

  if (!m3u8) {
    console.log('❌ No .m3u8 found from any server.');
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

    for (const movie of movies.slice(0, 5)) {
      try {
        const item = await Promise.race([
          processMovie(movie, browser),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('⏱️ Movie processing timed out')), 30000)
          ),
        ]);

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
  } finally {
    try {
      await browser.close();
      console.log('🧹 Browser closed, script finished.');
    } catch (err) {
      console.error('❌ Failed to close browser:', err);
    }
  }
  
})();
