import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogItem, CatalogSearchResult } from './catalog.interfaces';

/**
 * TMDb (The Movie Database) API client.
 *
 * Docs: https://developer.themoviedb.org/docs
 *
 * - 5-second timeout on all requests
 * - Returns structured CatalogItem results (movies for cinema-type events)
 * - API key from environment variable, NEVER in responses or logs
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TIMEOUT_MS = 5000;

@Injectable()
export class TmdbClient {
  private readonly logger = new Logger(TmdbClient.name);
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('externalApis.tmdbApiKey') || '';
  }

  /**
   * Search movies on TMDb.
   */
  async search(query: string, page = 1): Promise<CatalogSearchResult> {
    if (!this.apiKey) {
      return { items: [], total: 0, page, pageSize: 20 };
    }

    const url = new URL(`${TMDB_BASE}/search/movie`);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('query', query);
    url.searchParams.set('page', String(page));
    url.searchParams.set('language', 'pt-BR');

    const response = await this.fetchWithTimeout(url.toString());

    if (!response.ok) {
      throw new Error(`TMDb API returned ${response.status}`);
    }

    const data = await response.json();
    const movies = data?.results || [];
    const totalResults = data?.total_results || 0;

    const items: CatalogItem[] = movies.map((movie: any) => ({
      externalId: String(movie.id),
      source: 'tmdb' as const,
      name: movie.title,
      image: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
      category: 'Movie',
      description: movie.overview || '',
      date: movie.release_date || null,
      venue: null,
    }));

    return {
      items,
      total: totalResults,
      page,
      pageSize: 20,
    };
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}
