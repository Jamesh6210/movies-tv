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

async function processMovie(
  movie: NunflixMovie, 
  browser: Browser, 
  groupName: string
): Promise<M3UItem | null> {
  console.log(`\n🎬 ${movie.title}`);
  console.log(`Watch page: ${movie.watchPage}`);

  const embedLinks = await getStreamLinksFromWatchPage(browser, movie.watchPage);
  console.log(`\n🧩 Trying up to 3 servers for: ${movie.title}`);

  const limitedLinks = embedLinks.slice(0, 5);
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
    group: groupName,
    streamUrl: m3u8,
    description: tmdbInfo ? `IMDb ${tmdbInfo.rating}` : '',
  };
}

async function processGenre(
  browser: Browser, 
  genre: GenreInfo, 
  items: M3UItem[]
): Promise<void> {
  console.log(`\n🎭 Processing genre: ${genre.name}`);
  console.log(`==========================================`);
  
  try {
    const movies = await withTimeout(
      getTrendingMoviesPuppeteer(browser, genre, 20), // Reduced from 25 to 20
      120000 // 2 minutes timeout per genre
    );
    
    console.log(`📊 Found ${movies.length} movies for ${genre.name}`);
    
    let processedCount = 0;
    for (const movie of movies) {
      try {
        const item = await withTimeout(
          processMovie(movie, browser, genre.name), 
          25000 // Reduced timeout for individual movies
        );
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
  }
}

// Function to create a fresh browser instance
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
    // Increase protocol timeout
    protocolTimeout: 60000,
  });
}

(async () => {
  let browser = await createBrowser();
  const items: M3UItem[] = [];

  try {
    // First, get trending movies without genre filtering
    console.log('\n🔥 Getting trending movies (no genre filter)...');
    console.log('==========================================');
    
    const trendingMovies = await withTimeout(
      getTrendingMoviesPuppeteer(browser, undefined, 25),
      120000 // 2 minutes for trending
    );
    console.log(`📊 Found ${trendingMovies.length} trending movies`);
    
    let trendingCount = 0;
    for (const movie of trendingMovies) {
      try {
        const item = await withTimeout(
          processMovie(movie, browser, 'Trending Movies'), 
          25000
        );
        if (item) {
          items.push(item);
          trendingCount++;
          console.log(`✅ Trending: ${trendingCount}/${trendingMovies.length} processed`);
        }
      } catch (err) {
        console.warn(`⚠️ Skipped "${movie.title}" in trending due to timeout or error.`);
      }
    }
    
    console.log(`🎯 Completed trending movies: ${trendingCount} items added`);

    // Get available genres - no longer needs browser instance
    const genres = await getAvailableGenres();
    
    if (genres.length === 0) {
      console.warn('⚠️ No genres found, skipping genre-specific scraping');
    } else {
      console.log(`\n📂 Processing ${genres.length} genres...`);
      
      // Process each genre with browser refresh every 3 genres to prevent memory issues
      for (let i = 0; i < genres.length && i < 12; i++) { // Limit to 12 genres to prevent timeouts
        const genre = genres[i];
        
        try {
          // Refresh browser every 3 genres to prevent connection issues
          if (i > 0 && i % 3 === 0) {
            console.log('\n🔄 Refreshing browser to prevent connection issues...');
            try {
              await browser.close();
            } catch (e) {
              console.warn('⚠️ Error closing old browser:', e);
            }
            browser = await createBrowser();
          }

          await processGenre(browser, genre, items);
          
          // Add a delay between genres to be respectful
          await new Promise(resolve => setTimeout(resolve, 5000));
          
        } catch (err) {
          console.error(`❌ Failed to process genre ${genre.name}:`, err);
          
          // Try to recover by creating a new browser
          try {
            await browser.close();
            browser = await createBrowser();
            console.log('🔄 Browser refreshed after error');
          } catch (e) {
            console.error('❌ Failed to refresh browser:', e);
            break; // Exit if we can't recover
          }
        }
      }
    }

    // Export results
    if (items.length > 0) {
      exportToM3U('movies&tvshows.m3u', items);
      
      // Log summary by group
      const groupCounts = items.reduce((acc, item) => {
        acc[item.group] = (acc[item.group] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log('\n📊 Final Summary:');
      console.log('==========================================');
      Object.entries(groupCounts).forEach(([group, count]) => {
        console.log(`${group}: ${count} items`);
      });
      console.log(`Total: ${items.length} items exported`);
    } else {
      console.log('⚠️ No playable streams found to export.');
    }
    
  } catch (err) {
    console.error('❌ Error in main flow:', err);
  } finally {
    // Cleanup
    try {
      const pages = await browser.pages();
      for (const page of pages) {
        try {
          if (!page.isClosed()) await page.close();
        } catch (_) {}
      }
      await browser.close();
    } catch (e) {
      console.warn('⚠️ Error during cleanup:', e);
    }
    
    console.log('🧹 Browser closed, script finished.');
    process.exit(0);
  }
})();