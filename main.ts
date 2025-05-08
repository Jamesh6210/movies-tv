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

// Memory optimization: Add a global resource tracking map
const openPages = new Map();

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

// Add better resource management
async function processMovie(movie: NunflixMovie, browser: Browser): Promise<M3UItem | null> {
  console.log(`\n🎬 ${movie.title}`);
  console.log(`Watch page: ${movie.watchPage}`);

  try {
    const embedLinks = await getStreamLinksFromWatchPage(browser, movie.watchPage);
    console.log(`\n🧩 Trying up to 3 servers for: ${movie.title}`);

    const limitedLinks = embedLinks.slice(0, 3);
    
    // Process one embed at a time instead of all at once to save memory
    let m3u8 = null;
    for (const embed of limitedLinks) {
      try {
        m3u8 = await withTimeout(resolveM3U8FromEmbed(browser, embed), 20000);
        if (m3u8) {
          console.log(`✅ Found .m3u8: ${m3u8}`);
          break;
        }
      } catch (error) {
        console.log(`⚠️ Failed with one server, trying next...`);
        // Continue to the next embed
      }
    }

    if (!m3u8) {
      console.log('❌ No .m3u8 found from any server.');
      return null;
    }

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
  } catch (error) {
    console.error(`❌ Error processing movie ${movie.title}:`, error);
    return null;
  }
}

// Manage pages better with a lower concurrency
async function safeCloseBrowser(browser: Browser) {
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      try {
        if (!page.isClosed()) {
          await page.removeAllListeners();
          await page.close();
        }
      } catch (e) {
        console.warn('Error closing page:', e);
      }
    }
    await browser.close();
    console.log('🧹 Browser closed successfully.');
  } catch (e) {
    console.error('Error during browser cleanup:', e);
  }
}

// Add memory management and better error handling
(async () => {
  // Set reasonable memory limits for GitHub Actions
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-audio-output',
      '--disable-speech-api',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--single-process',
      '--mute-audio',
      '--js-flags=--max-old-space-size=256'
    ]
  });

  const items: M3UItem[] = [];
  let completedItems = 0;
  const MAX_RETRIES = 2;

  try {
    // Determine number of movies to process - you can adjust this manually if needed
    const moviesLimit = 15; // Process a reasonable number of movies to balance completion vs. size
    
    const movies = await getTrendingMoviesPuppeteer(browser);
    console.log(`📋 Found ${movies.length} movies, processing up to ${moviesLimit}...`);
    
    // Process in smaller batches to manage memory better
    const MAX_CONCURRENT = 1; // Process one movie at a time
    const movieBatches = [];
    
    for (let i = 0; i < Math.min(movies.length, moviesLimit); i += MAX_CONCURRENT) {
      movieBatches.push(movies.slice(i, i + MAX_CONCURRENT));
    }
    
    for (const batch of movieBatches) {
      try {
        // Process each batch sequentially
        const results = await Promise.all(
          batch.map(async (movie) => {
            let retries = 0;
            while (retries <= MAX_RETRIES) {
              try {
                const item = await withTimeout(processMovie(movie, browser), 25000);
                if (item) {
                  completedItems++;
                  console.log(`✅ Processed ${completedItems}/20 items`);
                  return item;
                }
                break; // Skip to next movie if no streams found
              } catch (err) {
                retries++;
                if (retries <= MAX_RETRIES) {
                  console.warn(`⚠️ Retry ${retries}/${MAX_RETRIES} for "${movie.title}"`);
                } else {
                  console.warn(`⚠️ Skipped "${movie.title}" after ${MAX_RETRIES} retries.`);
                  return null;
                }
              }
            }
            return null;
          })
        );
        
        // Add valid results to items array
        items.push(...results.filter(Boolean) as M3UItem[]);
        
        // Force garbage collection between batches
        if (global.gc) {
          global.gc();
        }
        
        // Small delay to let resources settle
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (batchError) {
        console.error(`❌ Error processing batch:`, batchError);
      }
    }

    // Handle the results
    if (items.length > 0) {
      exportToM3U('movies&tvshows.m3u', items);
      console.log(`✅ M3U exported with ${items.length} items.`);
    } else {
      console.log('⚠️ No playable streams found to export.');
    }
  } catch (err) {
    console.error('❌ Error in main flow:', err);
  } finally {
    // Ensure browser is properly closed
    await safeCloseBrowser(browser);
    console.log('🏁 Script finished.');

    // ✅ Final cleanup for GitHub Actions
    process.exit(0);
  }
})();