import {
  getTrendingMoviesPuppeteer,
  getStreamLinksFromWatchPage,
  resolveM3U8FromEmbed,
} from './Scraper/nunflix-puppeteer';

import { exportToM3U, M3UItem } from './export';
import { fetchTMDBInfo } from './Scraper/tmdb';

function cleanMovieTitle(rawTitle: string): string {
  return rawTitle
    // Insert space before month if stuck to title (e.g., "MovieApr" → "Movie Apr")
    .replace(/([a-z])([A-Z][a-z]{2})/, '$1 $2')
    // Remove full date patterns like "Apr 29, 25"
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{2}\b/gi, '')
    // Remove trailing labels like "•Movie"
    .replace(/•.*/g, '')
    // Collapse extra spaces
    .replace(/\s{2,}/g, ' ')
    .trim();
}




(async () => {
  const movies = await getTrendingMoviesPuppeteer();
  const items: M3UItem[] = [];

  for (const movie of movies.slice(0, 5)) {
    console.log(`\n🎬 ${movie.title}`);
    console.log(`Watch page: ${movie.watchPage}`);

    const embedLinks = await getStreamLinksFromWatchPage(movie.watchPage);

    for (const embed of embedLinks) {
      console.log(`\n🧩 Trying server: ${embed}`);
      const m3u8 = await resolveM3U8FromEmbed(embed);

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


        break; // Stop after first working stream
      } else {
        console.log('❌ No .m3u8 found.');
      }
    }
  }

  if (items.length > 0) {
    exportToM3U('movies&tvshows.m3u', items);
  } else {
    console.log('⚠️ No playable streams found to export.');
  }
})();
