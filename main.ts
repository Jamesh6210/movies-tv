import { 
  getTMDBGenres, 
  getPopularMovies, 
  getMoviesByGenre, 
  getTrendingMovies,
  TMDBMovie,
  TMDBGenre 
} from './Scraper/tmdb';
import { getM3U8FromVidFast, createBrowser } from './Scraper/vidfast-scraper';
import { exportToM3U, M3UItem } from './export';
import { Browser } from 'puppeteer';

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Timeout')), ms);
    promise.then(resolve).catch(reject).finally(() => clearTimeout(timeoutId));
  });
}

async function processMovie(movie: TMDBMovie, browser: Browser, groupName: string): Promise<M3UItem | null> {
  try {
    const m3u8Url = await withTimeout(getM3U8FromVidFast(browser, movie.id), 10000);
    
    if (!m3u8Url) {
      return null;
    }
    
    return {
      title: movie.title,
      logo: movie.posterUrl,
      group: groupName,
      streamUrl: m3u8Url,
      description: [
        movie.year,
        movie.rating ? `⭐ ${movie.rating}` : null,
        movie.genres.slice(0, 2).join(', ')
      ].filter(Boolean).join(' • ')
    };
  } catch (error) {
    return null;
  }
}

async function processMovieList(
  movies: TMDBMovie[], 
  groupName: string, 
  maxItems: number = 20
): Promise<M3UItem[]> {
  const items: M3UItem[] = [];
  let browser = await createBrowser();
  
  console.log(`\nProcessing ${groupName}: ${Math.min(movies.length, maxItems)} movies`);
  
  try {
    const promises: Promise<M3UItem | null>[] = [];
    
    // Process 5 movies concurrently for speed
    for (let i = 0; i < Math.min(movies.length, maxItems); i += 5) {
      const batch = movies.slice(i, i + 5);
      
      // Create concurrent promises for this batch
      const batchPromises = batch.map(movie => processMovie(movie, browser, groupName));
      promises.push(...batchPromises);
      
      // Process batch and collect results
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, idx) => {
        const movie = batch[idx];
        if (result.status === 'fulfilled' && result.value) {
          items.push(result.value);
          console.log(`✅ ${movie.title} (${items.length}/${maxItems})`);
        } else {
          console.log(`❌ ${movie.title}`);
        }
      });
      
      // Restart browser every 15 movies to prevent memory issues
      if (i > 0 && i % 15 === 0) {
        await browser.close();
        browser = await createBrowser();
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`Completed ${groupName}: ${items.length} streams found`);
    
  } finally {
    await browser.close();
  }
  
  return items;
}

(async () => {
  try {
    console.log('🎬 Starting TMDB Movie Scraper');
    console.log('==========================================');
    
    const allItems: M3UItem[] = [];
    
    // 1. Get trending movies
    console.log('📈 Fetching trending movies...');
    const trendingMovies = await getTrendingMovies(25);
    if (trendingMovies.length > 0) {
      const trendingItems = await processMovieList(trendingMovies, 'Trending Movies', 20);
      allItems.push(...trendingItems);
    }
    
    // 2. Get popular movies
    console.log('🔥 Fetching popular movies...');
    const popularMovies = await getPopularMovies(1, 30);
    if (popularMovies.length > 0) {
      const popularItems = await processMovieList(popularMovies, 'Popular Movies', 15);
      allItems.push(...popularItems);
    }
    
    // 3. Get movies by genre (reduced for speed)
    console.log('🎭 Processing genres...');
    const genres = await getTMDBGenres();
    
    // Process fewer genres but more efficiently
    const selectedGenres = ['Action', 'Comedy', 'Horror', 'Thriller', 'Adventure'];
    
    for (const genreName of selectedGenres) {
      const genre = genres.find(g => g.name === genreName);
      if (!genre) continue;
      
      console.log(`🎯 Fetching ${genreName} movies...`);
      const genreMovies = await getMoviesByGenre(genre.id, 1, 15);
      
      if (genreMovies.length > 0) {
        const genreItems = await processMovieList(genreMovies, genreName, 8);
        allItems.push(...genreItems);
      }
    }
    
    // 4. Export results
    if (allItems.length > 0) {
      console.log('\n📝 Exporting M3U playlist...');
      exportToM3U('movies&tvshows.m3u', allItems);
      
      // Summary
      const groupCounts = allItems.reduce((acc, item) => {
        acc[item.group] = (acc[item.group] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log('\n🎉 Final Summary:');
      console.log('==========================================');
      Object.entries(groupCounts).forEach(([group, count]) => {
        console.log(`${group}: ${count} items`);
      });
      console.log(`Total: ${allItems.length} items`);
      
    } else {
      console.log('❌ No streams found');
    }
    
  } catch (error) {
    console.error('💥 Main error:', error);
  } finally {
    console.log('🏁 Scraper finished');
    process.exit(0);
  }
})();