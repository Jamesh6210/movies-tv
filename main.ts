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

// Configuration constants
const CONFIG = {
  TIMEOUTS: {
    MOVIE_PROCESSING: 75000,
    GENRE_PROCESSING: 120000,
    BROWSER_OPERATIONS: 60000,
  },
  LIMITS: {
    TRENDING_MOVIES: 25,
    GENRE_MOVIES: 20,
    PARALLEL_GENRES: 3,
    BROWSER_REFRESH_INTERVAL: 10,
  },
  DELAYS: {
    BETWEEN_CHUNKS: 3000,
    BROWSER_REFRESH: 1000,
  },
} as const;

/**
 * Cleans and formats movie titles by removing dates and special characters
 */
function cleanMovieTitle(rawTitle: string): string {
  return rawTitle
    .replace(/([a-zA-Z\d])((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?\d{1,2},\s?\d{2})/, '$1 $2')
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{2}\b/gi, '')
    .replace(/\u2022.*/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Wraps a promise with a timeout
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Operation timeout exceeded')), ms);
    promise.then((res) => {
      clearTimeout(timeoutId);
      resolve(res);
    }).catch((err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Processes a single movie to extract stream information and metadata
 */
async function processMovie(movie: NunflixMovie, browser: Browser, groupName: string): Promise<M3UItem | null> {
  console.log(`Processing: ${movie.title}`);
  console.log(`Watch page: ${movie.watchPage}`);

  try {
    // Get only VidFast links
    const embedLinks = await getStreamLinksFromWatchPage(browser, movie.watchPage);
    const vidFastLink = embedLinks.find(link => link.includes('vidfast'));

    if (!vidFastLink) {
      console.log(`No VidFast server found for: ${movie.title}`);
      return null;
    }

    console.log(`Using VidFast server for: ${movie.title}`);
    const m3u8 = await resolveM3U8FromEmbed(browser, vidFastLink);

    if (!m3u8) {
      console.log(`No M3U8 stream found for: ${movie.title}`);
      return null;
    }

    console.log(`Stream found: ${m3u8}`);

    const cleanTitle = cleanMovieTitle(movie.title);
    console.log(`Fetching metadata for: "${cleanTitle}"`);

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
  } catch (error) {
    console.error(`Error processing movie "${movie.title}":`, error);
    return null;
  }
}

/**
 * Processes all movies for a specific genre
 */
async function processGenre(genre: GenreInfo): Promise<M3UItem[]> {
  const items: M3UItem[] = [];
  let browser = await createBrowser();

  console.log(`\nProcessing genre: ${genre.name}`);
  console.log('==========================================');

  try {
    const movies = await withTimeout(
      getTrendingMoviesPuppeteer(browser, genre, CONFIG.LIMITS.GENRE_MOVIES), 
      CONFIG.TIMEOUTS.GENRE_PROCESSING
    );
    
    console.log(`Found ${movies.length} movies for ${genre.name}`);

    let processedCount = 0;
    for (let i = 0; i < movies.length; i++) {
      const movie = movies[i];

      // Refresh browser periodically to prevent memory issues
      if (i > 0 && i % CONFIG.LIMITS.BROWSER_REFRESH_INTERVAL === 0) {
        console.log('Refreshing browser to prevent memory issues...');
        try {
          await browser.close();
        } catch (error) {
          console.warn('Error closing browser:', error);
        }
        browser = await createBrowser();
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAYS.BROWSER_REFRESH));
      }

      try {
        const item = await withTimeout(
          processMovie(movie, browser, genre.name), 
          CONFIG.TIMEOUTS.MOVIE_PROCESSING
        );
        
        if (item) {
          items.push(item);
          processedCount++;
          console.log(`Progress ${genre.name}: ${processedCount}/${movies.length} processed`);
        }
      } catch (error) {
        console.warn(`Skipped "${movie.title}" in ${genre.name}: ${error}`);
      }
    }

    console.log(`Completed ${genre.name}: ${processedCount} items added`);
  } catch (error) {
    console.error(`Error processing genre ${genre.name}:`, error);
  } finally {
    try {
      await browser.close();
    } catch (error) {
      console.warn('Error closing browser:', error);
    }
  }

  return items;
}

/**
 * Creates a new browser instance with optimized settings
 */
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
      '--disable-renderer-backgrounding',
      '--memory-pressure-off',
      '--disable-background-networking',
    ],
    protocolTimeout: CONFIG.TIMEOUTS.BROWSER_OPERATIONS,
  });
}

/**
 * Processes trending movies
 */
async function processTrendingMovies(): Promise<M3UItem[]> {
  console.log('\nProcessing trending movies...');
  console.log('==========================================');

  const trendingBrowser = await createBrowser();
  const trendingItems: M3UItem[] = [];
  
  try {
    const trendingMovies = await withTimeout(
      getTrendingMoviesPuppeteer(trendingBrowser, undefined, CONFIG.LIMITS.TRENDING_MOVIES), 
      CONFIG.TIMEOUTS.GENRE_PROCESSING
    );
    
    console.log(`Found ${trendingMovies.length} trending movies`);

    let trendingCount = 0;
    for (const movie of trendingMovies) {
      try {
        const item = await withTimeout(
          processMovie(movie, trendingBrowser, 'Trending Movies'), 
          CONFIG.TIMEOUTS.MOVIE_PROCESSING
        );
        
        if (item) {
          trendingItems.push(item);
          trendingCount++;
          console.log(`Trending progress: ${trendingCount}/${trendingMovies.length} processed`);
        }
      } catch (error) {
        console.warn(`Skipped "${movie.title}" in trending: ${error}`);
      }
    }

    console.log(`Completed trending movies: ${trendingCount} items added`);
  } finally {
    await trendingBrowser.close();
  }

  return trendingItems;
}

/**
 * Processes all genres in parallel chunks
 */
async function processAllGenres(): Promise<M3UItem[]> {
  const genres = await getAvailableGenres();
  
  if (genres.length === 0) {
    console.warn('No genres found, skipping genre-specific scraping');
    return [];
  }

  console.log(`\nProcessing ${genres.length} genres in parallel...`);

  // Process genres in chunks to avoid overwhelming the system
  const genreChunks = [];
  for (let i = 0; i < genres.length; i += CONFIG.LIMITS.PARALLEL_GENRES) {
    genreChunks.push(genres.slice(i, i + CONFIG.LIMITS.PARALLEL_GENRES));
  }

  const allGenreItems: M3UItem[] = [];

  for (const chunk of genreChunks) {
    console.log(`\nProcessing chunk: ${chunk.map(g => g.name).join(', ')}`);
    
    const chunkResults = await Promise.allSettled(
      chunk.map(genre => processGenre(genre))
    );

    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        allGenreItems.push(...result.value);
      } else {
        console.error('Genre processing failed:', result.reason);
      }
    }

    // Delay between chunks to prevent overwhelming the server
    if (chunk !== genreChunks[genreChunks.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.DELAYS.BETWEEN_CHUNKS));
    }
  }

  return allGenreItems;
}

/**
 * Prints final summary statistics
 */
function printSummary(items: M3UItem[]): void {
  const groupCounts = items.reduce((acc, item) => {
    acc[item.group] = (acc[item.group] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\nFinal Summary:');
  console.log('==========================================');
  Object.entries(groupCounts).forEach(([group, count]) => {
    console.log(`${group}: ${count} items`);
  });
  console.log(`Total: ${items.length} items exported`);
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    console.log('Movie Scraper Starting...');
    console.log('==========================================');

    // Process trending movies and genres
    const [trendingItems, genreItems] = await Promise.all([
      processTrendingMovies(),
      processAllGenres()
    ]);

    // Combine all results
    const allItems = [...trendingItems, ...genreItems];

    if (allItems.length > 0) {
      exportToM3U('movies&tvshows.m3u', allItems);
      printSummary(allItems);
    } else {
      console.log('No playable streams found to export.');
    }
  } catch (error) {
    console.error('Error in main flow:', error);
  } finally {
    console.log('Script finished.');
    process.exit(0);
  }
}

// Execute main function
main();