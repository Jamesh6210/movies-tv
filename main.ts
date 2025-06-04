import puppeteer from 'puppeteer';
import {
  getTrendingMoviesPuppeteer,
  getStreamLinksFromWatchPage,
  resolveM3U8FromEmbed,
  getAvailableGenres,
  GenreInfo,
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
    promise.then((res) => {
      clearTimeout(timeoutId);
      resolve(res);
    }).catch((err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

async function processMovie(movie: NunflixMovie, browser: Browser, groupName: string): Promise<M3UItem | null> {
  console.log(`\n🎬 ${movie.title}`);
  console.log(`Watch page: ${movie.watchPage}`);

  // Get only VidFast links
  const embedLinks = await getStreamLinksFromWatchPage(browser, movie.watchPage);
  const vidFastLink = embedLinks.find(link => link.includes('vidfast'));

  if (!vidFastLink) {
    console.log('❌ No VidFast server found.');
    return null;
  }

  console.log(`🧩 Using VidFast server for: ${movie.title}`);
  const m3u8 = await resolveM3U8FromEmbed(browser, vidFastLink);

  if (!m3u8) {
    console.log('❌ No .m3u8 found from VidFast server.');
    return null;
  }

  console.log(`✅ Found .m3u8: ${m3u8}`);

  const cleanTitle = cleanMovieTitle(movie.title);
  console.log(`🧪 Raw title: "${movie.title}"`);
  console.log(`🔎 Cleaned title for TMDb: "${cleanTitle}"`);

  const tmdbInfo = await fetchTMDBInfo(cleanTitle);

  return {
    title: tmdbInfo?.title || movie.title,
    logo: tmdbInfo?.posterUrl || movie.poster || '',
    group: groupName,
    streamUrl: m3u8,
    description: [
      movie.quality ? `${movie.quality}` : null,
      tmdbInfo?.rating ? `IMDb ${tmdbInfo.rating}` : null
    ].filter(Boolean).join(' • '),
  };
}

async function processGenre(genre: GenreInfo): Promise<M3UItem[]> {
  const items: M3UItem[] = [];
  let browser = await createBrowser();

  console.log(`\n🎭 Processing genre: ${genre.name}`);
  console.log(`==========================================`);

  try {
    const movies = await withTimeout(getTrendingMoviesPuppeteer(browser, genre, 20), 120000);
    console.log(`📊 Found ${movies.length} movies for ${genre.name}`);

    let processedCount = 0;
    for (let i = 0; i < movies.length; i++) {
      const movie = movies[i];

      if (i > 0 && i % 10 === 0) {
        console.log('\n🔄 Refreshing browser mid-genre to prevent memory issues...');
        try {
          await browser.close();
        } catch (_) {}
        browser = await createBrowser();
      }

      try {
        const item = await withTimeout(processMovie(movie, browser, genre.name), 75000);
        if (item) {
          items.push(item);
          processedCount++;
          console.log(`✅ ${genre.name}: ${processedCount}/${movies.length} processed`);
        }
      } catch (err) {
        console.warn(`⚠️ Skipped "${movie.title}" in ${genre.name} due to timeout or error.`);
      }
    }

    console.log(`🎯 Completed ${genre.name}: ${processedCount} items added`);
  } catch (err) {
    console.error(`❌ Error processing genre ${genre.name}:`, err);
  } finally {
    try {
      await browser.close();
    } catch (_) {}
  }

  return items;
}

async function createBrowser(): Promise<Browser> {
  return await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    protocolTimeout: 60000,
  });
}

(async () => {
  try {
    console.log('\n🔥 Getting trending movies (no genre filter)...');
    console.log('==========================================');

    // Process trending movies first with a dedicated browser
    const trendingBrowser = await createBrowser();
    const trendingItems: M3UItem[] = [];
    
    try {
      const trendingMovies = await withTimeout(getTrendingMoviesPuppeteer(trendingBrowser, undefined, 25), 120000);
      console.log(`📊 Found ${trendingMovies.length} trending movies`);

      let trendingCount = 0;
      for (const movie of trendingMovies) {
        try {
          const item = await withTimeout(processMovie(movie, trendingBrowser, 'Trending Movies'), 75000);
          if (item) {
            trendingItems.push(item);
            trendingCount++;
            console.log(`✅ Trending: ${trendingCount}/${trendingMovies.length} processed`);
          }
        } catch (err) {
          console.warn(`⚠️ Skipped "${movie.title}" in trending due to timeout or error.`);
        }
      }

      console.log(`🎯 Completed trending movies: ${trendingCount} items added`);
    } finally {
      await trendingBrowser.close();
    }

    // Process genres in parallel
    const genres = await getAvailableGenres();
    if (genres.length === 0) {
      console.warn('⚠️ No genres found, skipping genre-specific scraping');
    } else {
      console.log(`\n📂 Processing ${genres.length} genres in parallel...`);

      // Process 3 genres at a time to avoid overwhelming the system
      const parallelLimit = 3;
      const genreChunks = [];
      for (let i = 0; i < genres.length; i += parallelLimit) {
        genreChunks.push(genres.slice(i, i + parallelLimit));
      }

      const allGenreItems: M3UItem[] = [];

      for (const chunk of genreChunks) {
        console.log(`\n🚀 Processing chunk: ${chunk.map(g => g.name).join(', ')}`);
        
        const chunkResults = await Promise.allSettled(
          chunk.map(genre => processGenre(genre))
        );

        for (const result of chunkResults) {
          if (result.status === 'fulfilled') {
            allGenreItems.push(...result.value);
          } else {
            console.error('❌ Genre processing failed:', result.reason);
          }
        }

        // Small delay between chunks
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Combine all results
      const allItems = [...trendingItems, ...allGenreItems];

      if (allItems.length > 0) {
        exportToM3U('movies&tvshows.m3u', allItems);

        const groupCounts = allItems.reduce((acc, item) => {
          acc[item.group] = (acc[item.group] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log('\n📊 Final Summary:');
        console.log('==========================================');
        Object.entries(groupCounts).forEach(([group, count]) => {
          console.log(`${group}: ${count} items`);
        });
        console.log(`Total: ${allItems.length} items exported`);
      } else {
        console.log('⚠️ No playable streams found to export.');
      }
    }
  } catch (err) {
    console.error('❌ Error in main flow:', err);
  } finally {
    console.log('🧹 Script finished.');
    process.exit(0);
  }
})();