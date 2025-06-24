import axios from 'axios';

const TMDB_API_KEY = '0e8066a21ffbca4c9ab24e0dd7fd71ab';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TMDBMovie {
  id: number;
  title: string;
  year: string;
  rating: number;
  posterUrl: string;
  genres: string[];
  overview: string;
}

export interface TMDBGenre {
  id: number;
  name: string;
}

// Get all available genres from TMDB
export async function getTMDBGenres(): Promise<TMDBGenre[]> {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/genre/movie/list?api_key=${TMDB_API_KEY}`);
    return response.data.genres || [];
  } catch (error) {
    console.error('Error fetching TMDB genres:', error);
    return [];
  }
}

// Get popular movies (trending/popular)
export async function getPopularMovies(page: number = 1, limit: number = 20): Promise<TMDBMovie[]> {
  try {
    const response = await axios.get(
      `${TMDB_BASE_URL}/movie/popular?api_key=${TMDB_API_KEY}&page=${page}`
    );
    
    const movies = response.data.results?.slice(0, limit) || [];
    return movies.map(formatTMDBMovie);
  } catch (error) {
    console.error('Error fetching popular movies:', error);
    return [];
  }
}

// Get movies by genre
export async function getMoviesByGenre(genreId: number, page: number = 1, limit: number = 20): Promise<TMDBMovie[]> {
  try {
    const response = await axios.get(
      `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&page=${page}&sort_by=popularity.desc`
    );
    
    const movies = response.data.results?.slice(0, limit) || [];
    return movies.map(formatTMDBMovie);
  } catch (error) {
    console.error(`Error fetching movies for genre ${genreId}:`, error);
    return [];
  }
}

// Get trending movies
export async function getTrendingMovies(limit: number = 20): Promise<TMDBMovie[]> {
  try {
    const response = await axios.get(
      `${TMDB_BASE_URL}/trending/movie/week?api_key=${TMDB_API_KEY}`
    );
    
    const movies = response.data.results?.slice(0, limit) || [];
    return movies.map(formatTMDBMovie);
  } catch (error) {
    console.error('Error fetching trending movies:', error);
    return [];
  }
}

// Get movie details by ID
export async function getMovieDetails(movieId: number): Promise<TMDBMovie | null> {
  try {
    const response = await axios.get(
      `${TMDB_BASE_URL}/movie/${movieId}?api_key=${TMDB_API_KEY}`
    );
    
    return formatTMDBMovie(response.data);
  } catch (error) {
    console.error(`Error fetching movie details for ID ${movieId}:`, error);
    return null;
  }
}

// Format TMDB API response to our TMDBMovie interface
function formatTMDBMovie(movie: any): TMDBMovie {
  return {
    id: movie.id,
    title: movie.title || 'Unknown Title',
    year: movie.release_date ? movie.release_date.split('-')[0] : 'N/A',
    rating: Math.round((movie.vote_average || 0) * 10) / 10,
    posterUrl: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : 'https://via.placeholder.com/500x750?text=No+Image',
    genres: movie.genres?.map((g: any) => g.name) || [],
    overview: movie.overview || ''
  };
}