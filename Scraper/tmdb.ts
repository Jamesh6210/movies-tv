import axios from 'axios';

const TMDB_API_KEY = '0e8066a21ffbca4c9ab24e0dd7fd71ab';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TMDBMovie {
  title: string;
  year: string;
  rating: number;
  posterUrl: string;
}


export async function fetchTMDBInfo(query: string): Promise<TMDBMovie | null> {
  const url = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;

  try {
    const response = await axios.get(url);
    const results = response.data.results;

    if (results && results.length > 0) {
      const movie = results[0];

      return {
        title: movie.title,
        year: (movie.release_date || 'N/A').split('-')[0],
        rating: Math.round((movie.vote_average || 0) * 10) / 10,
        posterUrl: movie.poster_path
          ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
          : 'https://via.placeholder.com/500x750?text=No+Image',
      };
    }
  } catch (error) {
    console.error(`❌ TMDb API error: ${error}`);
  }

  return null;
}
