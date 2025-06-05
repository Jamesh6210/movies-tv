import puppeteer, { Browser } from 'puppeteer';  // Make sure Browser is imported
import {
  getTrendingMoviesPuppeteer,
  getStreamLinksFromWatchPage,
  resolveM3U8FromEmbed,
  getAvailableGenres,
  GenreInfo,
  NunflixMovie
} from './Scraper/nunflix-puppeteer';
import { exportToM3U, M3UItem } from './export';
import { fetchTMDBInfo } from './Scraper/tmdb';

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
    const timeoutId = setTimeout(() => reject(new Error('Timeout')), ms);
    promise.then(resolve).catch(reject).finally(() => clearTimeout(timeoutId));
  });
}

async function processMovie(movie: NunflixMovie, browser: Browser, groupName: string): Promise<M3UItem | null> {
  console.log(`Processing movie: ${movie.title}`);
  console.log(`Watch page: ${movie.watchPage}`);

  const embedLinks = await getStreamLinksFromWatchPage(browser, movie.watchPage);
  const vidFastLink = embedLinks.find(link => link.includes('vidfast'));

  if (!vidFastLink) {
    console.log('No VidFast server found');
    return null;
  }

  const m3u8 = await resolveM3U8FromEmbed(browser, vidFastLink);
  if (!m3u8) {
    console.log('No .m3u8 found');
    return null;
  }

  const cleanTitle = cleanMovieTitle(movie.title);
  const tmdbInfo = await fetchTMDBInfo(cleanTitle);

  return {
    title: tmdbInfo?.title || movie.title,
    logo: tmdbInfo?.posterUrl || movie.poster || '',
    group: groupName,
    streamUrl: m3u8,
    description: [
      movie.quality,
      tmdbInfo?.rating ? `IMDb ${tmdbInfo.rating}` : null
    ].filter(Boolean).join(' • '),
  };
}

async function processGenre(genre: GenreInfo): Promise<M3UItem[]> {
  const items: M3UItem[] = [];
  let browser = await createBrowser();

  console.log(`\nProcessing genre: ${genre.name}`);
  console.log('==========================================');

  try {
    const movies = await withTimeout(getTrendingMoviesPuppeteer(browser, genre, 20), 120000);
    console.log(`Found ${movies.length} movies`);

    let processedCount = 0;
    for (let i = 0; i < movies.length; i++) {
      const movie = movies[i];

      if (i > 0 && i % 10 === 0) {
        await browser.close();
        browser = await createBrowser();
      }

      try {
        const item = await withTimeout(processMovie(movie, browser, genre.name), 75000);
        if (item) {
          items.push(item);
          processedCount++;
          console.log(`Processed: ${processedCount}/${movies.length}`);
        }
      } catch (err) {
        console.warn(`Skipped "${movie.title}" due to error`);
      }
    }

    console.log(`Completed ${genre.name}: ${processedCount} items`);
  } catch (err) {
    console.error(`Error processing genre:`, err);
  } finally {
    await browser.close();
  }

  return items;
}

async function createBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions',
      '--disable-plugins'
    ],
    protocolTimeout: 60000,
  });
}

(async () => {
  try {
    console.log('\nStarting trending movies processing');
    console.log('==========================================');

    const trendingBrowser = await createBrowser();
    const trendingItems: M3UItem[] = [];
    
    try {
      const trendingMovies = await withTimeout(getTrendingMoviesPuppeteer(trendingBrowser, undefined, 25), 120000);
      console.log(`Found ${trendingMovies.length} trending movies`);

      let trendingCount = 0;
      for (const movie of trendingMovies) {
        try {
          const item = await withTimeout(processMovie(movie, trendingBrowser, 'Trending Movies'), 75000);
          if (item) {
            trendingItems.push(item);
            trendingCount++;
            console.log(`Processed: ${trendingCount}/${trendingMovies.length}`);
          }
        } catch (err) {
          console.warn(`Skipped "${movie.title}" due to error`);
        }
      }

      console.log(`Completed trending movies: ${trendingCount} items`);
    } finally {
      await trendingBrowser.close();
    }

    const genres = await getAvailableGenres();
    if (genres.length === 0) {
      console.warn('No genres found');
    } else {
      console.log(`\nProcessing ${genres.length} genres`);

      const parallelLimit = 3;
      const genreChunks = [];
      for (let i = 0; i < genres.length; i += parallelLimit) {
        genreChunks.push(genres.slice(i, i + parallelLimit));
      }

      const allGenreItems: M3UItem[] = [];

      for (const chunk of genreChunks) {
        console.log(`Processing chunk: ${chunk.map(g => g.name).join(', ')}`);
        
        const chunkResults = await Promise.allSettled(
          chunk.map(genre => processGenre(genre))
        );

        for (const result of chunkResults) {
          if (result.status === 'fulfilled') {
            allGenreItems.push(...result.value);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      const allItems = [...trendingItems, ...allGenreItems];

      if (allItems.length > 0) {
        exportToM3U('movies&tvshows.m3u', allItems);

        const groupCounts = allItems.reduce((acc, item) => {
          acc[item.group] = (acc[item.group] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log('\nFinal Summary:');
        console.log('==========================================');
        Object.entries(groupCounts).forEach(([group, count]) => {
          console.log(`${group}: ${count} items`);
        });
        console.log(`Total: ${allItems.length} items`);
      } else {
        console.log('No playable streams found');
      }
    }
  } catch (err) {
    console.error('Main error:', err);
  } finally {
    console.log('Script finished');
    process.exit(0);
  }
})();