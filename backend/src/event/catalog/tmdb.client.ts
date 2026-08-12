import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogItem, CatalogSearchResult, CatalogSearchFilters } from './catalog.interfaces';

/**
 * TMDb (The Movie Database) client.
 *
 * Field shapes and quirks documented in `SDD/08-anexos/API_TICKETMASTER_TMDB.md`.
 *
 * Two questions this answers that Ticketmaster cannot: "what is showing in
 * Brazilian cinemas right now" (`now_playing?region=BR`) and "what is this
 * movie about, in Portuguese".
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TIMEOUT_MS = 5000;

@Injectable()
export class TmdbClient {
  private readonly logger = new Logger(TmdbClient.name);
  private readonly apiKey: string;

  /**
   * id → name for movie genres. The API returns `genre_ids: [878, 28]` and the
   * UI cannot show numbers to a human. The list is small and effectively static,
   * so it is fetched once per process.
   */
  private genreCache: Map<number, string> | null = null;
  private genreLoad: Promise<Map<number, string>> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('externalApis.tmdbApiKey') || '';
  }

  /** Full-text movie search. */
  async search(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
    const page = filters.page ?? 1;

    const url = new URL(`${TMDB_BASE}/search/movie`);
    url.searchParams.set('query', filters.query ?? '');
    url.searchParams.set('page', String(page));

    return this.fetchMovies(url, page);
  }

  /**
   * Movies currently in Brazilian cinemas — the list that makes "sessão de
   * cinema" mean something. A search result can be a film from 1994.
   */
  async nowPlaying(page = 1): Promise<CatalogSearchResult> {
    const url = new URL(`${TMDB_BASE}/movie/now_playing`);
    url.searchParams.set('region', 'BR');
    url.searchParams.set('page', String(page));

    return this.fetchMovies(url, page);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async fetchMovies(url: URL, page: number): Promise<CatalogSearchResult> {
    if (!this.apiKey) {
      return { items: [], total: 0, page, pageSize: 20 };
    }

    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('language', 'pt-BR');

    const [response, genres] = await Promise.all([
      this.fetchWithTimeout(url.toString()),
      this.loadGenres(),
    ]);

    if (!response.ok) {
      throw new Error(`TMDb API returned ${response.status}`);
    }

    const data = await response.json();
    const movies = data?.results ?? [];

    return {
      items: movies.map((movie: any) => this.toCatalogItem(movie, genres)),
      total: data?.total_results ?? 0,
      page,
      pageSize: 20,
    };
  }

  private toCatalogItem(movie: any, genres: Map<number, string>): CatalogItem {
    const genreName = movie?.genre_ids?.map((id: number) => genres.get(id)).find(Boolean);

    return {
      externalId: String(movie.id),
      source: 'tmdb',
      name: movie.title,
      image: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
      category: genreName || 'Filme',
      description: movie.overview || '',
      // Theatrical release, NOT the session time — the organizer sets that
      date: movie.release_date || undefined,
      venue: null,
      venueCity: null,
      venueAddress: null,
      venueLat: null,
      venueLng: null,
    };
  }

  /** Loads the genre map once; concurrent callers share the same request. */
  private loadGenres(): Promise<Map<number, string>> {
    if (this.genreCache) return Promise.resolve(this.genreCache);
    if (this.genreLoad) return this.genreLoad;

    this.genreLoad = (async () => {
      try {
        const url = new URL(`${TMDB_BASE}/genre/movie/list`);
        url.searchParams.set('api_key', this.apiKey);
        url.searchParams.set('language', 'pt-BR');

        const res = await this.fetchWithTimeout(url.toString());
        if (!res.ok) throw new Error(`TMDb genres returned ${res.status}`);

        const data = await res.json();
        this.genreCache = new Map<number, string>(
          (data?.genres ?? []).map((g: any) => [g.id, g.name]),
        );
        return this.genreCache;
      } catch (err) {
        // A missing genre name is cosmetic — never fail a search over it
        this.logger.warn(
          `TMDb genre list unavailable: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        return new Map<number, string>();
      } finally {
        this.genreLoad = null;
      }
    })();

    return this.genreLoad;
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
