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
    // Insert space before month if stuck to title, e.g. "Moana 2Nov" → "Moana 2 Nov"
    .replace(/([a-zA-Z])((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?\d{1,2},\s?\d{2})/, '$1 $2')

    // Remove any date pattern like "Nov 21, 24"
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{2}\b/gi, '')

    // Remove everything after the first "•"
    .replace(/•.*/, '')

    // Optional: Add space in PascalCase (GoodFellas → Good Fellas)
    .replace(/([a-z])([A-Z])/g, '$1 $2')

    // Collapse extra spaces
    .replace(/\s{2,}/g, ' ')
    .trim();
}


(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const movies = await getTrendingMoviesPuppeteer(browser);
  const items: M3UItem[] = [];

  for (const movie of movies.slice(0, 30)) {
    console.log(`\n🎬 ${movie.title}`);
    console.log(`Watch page: ${movie.watchPage}`);

    const embedLinks = await getStreamLinksFromWatchPage(browser, movie.watchPage);

    console.log(`\n🧩 Trying up to 3 servers for: ${movie.title}`);

    // Try first 3 embed links in parallel
    const limitedLinks = embedLinks.slice(0, 3);
    
    const results = await Promise.allSettled(
      limitedLinks.map((embed) => resolveM3U8FromEmbed(browser, embed))
    );
    
    const successful = results.find(
      (res): res is PromiseFulfilledResult<string> => res.status === 'fulfilled' && !!res.value
    );
    
    const m3u8 = successful?.value;
    
    if (m3u8) {
      console.log(`✅ Found .m3u8: ${m3u8}`);
    
      const cleanTitle = cleanMovieTitle(movie.title);
      console.log(`🧪 Raw title: "${movie.title}"`);
      console.log(`🔎 Cleaned title for TMDb: "${cleanTitle}"`);
    
      const tmdbInfo = await fetchTMDBInfo(cleanTitle);
      if (!tmdbInfo) {
        console.log(`⚠️ TMDb not found: ${movie.title} — using fallback info.`);
      }
    
      items.push({
        title: tmdbInfo?.title || movie.title,
        logo: tmdbInfo?.posterUrl || movie.poster || '',
        group: 'Movies',
        streamUrl: m3u8,
        description: tmdbInfo ? `IMDb ${tmdbInfo.rating}` : '',
      });
    } else {
      console.log('❌ No .m3u8 found from any server.');
    }
    
  }

  await browser.close();

  if (items.length > 0) {
    exportToM3U('movies&tvshows.m3u', items);
  } else {
    console.log('⚠️ No playable streams found to export.');
  }
})();
