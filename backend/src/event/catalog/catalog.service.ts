import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TicketmasterClient } from './ticketmaster.client';
import { TmdbClient } from './tmdb.client';
import { CatalogSearchResult, CatalogSearchFilters } from './catalog.interfaces';
import { ExternalServiceError } from '../../shared/errors';

/**
 * Catalog service aggregating Ticketmaster and TMDb results.
 *
 * Key behaviors (Req 4.4 updated):
 * - Caches all external API responses for 1 hour (Redis)
 * - On API failure, timeout (5s), OR empty result set: return cached results if available
 * - If no cache available → throw ExternalServiceError (503 EXTERNAL_SERVICE_UNAVAILABLE)
 * - Empty results + no cache = failure (not an empty success)
 * - API keys are NEVER included in response payloads or logs
 */

const CACHE_TTL_SECONDS = 3600; // 1 hour
const CACHE_PREFIX = 'catalog:';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);
  private redis: Redis | null = null;

  constructor(
    private readonly ticketmasterClient: TicketmasterClient,
    private readonly tmdbClient: TmdbClient,
    private readonly configService: ConfigService,
  ) {
    try {
      const redisUrl = this.configService.get<string>('redis.url');
      if (redisUrl) {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 2000)),
          lazyConnect: true,
        });
        this.redis.connect().catch(() => {
          this.logger.warn('Redis unavailable for catalog cache');
        });
      }
    } catch {
      this.logger.warn('Redis not configured for catalog cache');
    }
  }

  /**
   * Search Ticketmaster with cache-first fallback.
   */
  async searchTicketmaster(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
    return this.withCacheFallback(
      this.cacheKey('tm', filters),
      () => this.ticketmasterClient.search(filters),
      'Ticketmaster',
    );
  }

  /**
   * Search TMDb with cache-first fallback.
   */
  async searchTmdb(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
    return this.withCacheFallback(
      this.cacheKey('tmdb', filters),
      () => this.tmdbClient.search({ ...filters, page: (filters.page ?? 0) + 1 }),
      'TMDb',
    );
  }

  /**
   * Movies currently in Brazilian cinemas (SPEC_CP13).
   *
   * Separate from search on purpose: "what can I put on sale tonight" is a
   * different question from "find me this title", and the answer comes from a
   * different endpoint.
   */
  async nowPlaying(page = 0): Promise<CatalogSearchResult> {
    return this.withCacheFallback(
      `${CACHE_PREFIX}tmdb:nowplaying:${page}`,
      () => this.tmdbClient.nowPlaying(page + 1),
      'TMDb',
    );
  }

  /**
   * Search both sources and merge results.
   */
  async searchAll(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
    const page = filters.page ?? 0;

    const [tmResult, tmdbResult] = await Promise.allSettled([
      this.searchTicketmaster(filters),
      this.searchTmdb(filters),
    ]);

    const tmItems = tmResult.status === 'fulfilled' ? tmResult.value.items : [];
    const tmdbItems = tmdbResult.status === 'fulfilled' ? tmdbResult.value.items : [];

    const items = [...tmItems, ...tmdbItems];

    // If both failed and we got nothing
    if (items.length === 0 && tmResult.status === 'rejected' && tmdbResult.status === 'rejected') {
      throw new ExternalServiceError('All external catalog services');
    }

    return {
      items,
      total: items.length,
      page,
      pageSize: 20,
    };
  }

  /**
   * Cache-first fallback pattern (Req 4.4).
   *
   * 1. Try to fetch from API
   * 2. If API fails/times out → return cached results
   * 3. If API returns empty results → return cached results
   * 4. If no cache available → throw ExternalServiceError (503)
   * 5. On success → cache the result for 1 hour
   */
  private async withCacheFallback(
    cacheKey: string,
    fetcher: () => Promise<CatalogSearchResult>,
    serviceName: string,
  ): Promise<CatalogSearchResult> {
    try {
      const result = await fetcher();

      // Empty results treated as failure when no cache exists (Req 4.4)
      if (result.items.length === 0) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger.debug(`${serviceName}: empty result, returning cache`);
          return cached;
        }
        throw new ExternalServiceError(serviceName);
      }

      // Cache successful non-empty result
      await this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      // If it's already our error, check cache before re-throwing
      if (error instanceof ExternalServiceError) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) return cached;
        throw error;
      }

      // API failure/timeout — try cache
      this.logger.warn(`${serviceName} API failed: ${error instanceof Error ? error.message : 'unknown'}`);
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        this.logger.debug(`${serviceName}: returning cached results after API failure`);
        return cached;
      }

      throw new ExternalServiceError(serviceName);
    }
  }

  /**
   * Cache key covering every filter — two searches that differ only by city are
   * different questions and must not share an answer.
   */
  private cacheKey(source: string, filters: CatalogSearchFilters): string {
    const parts = [
      filters.query ?? '',
      filters.countryCode ?? '',
      filters.city ?? '',
      filters.classificationName ?? '',
      filters.startDateTime ?? '',
      filters.page ?? 0,
      filters.size ?? 20,
    ];
    return `${CACHE_PREFIX}${source}:${parts.join('|')}`;
  }

  // ─── Cache helpers ──────────────────────────────────────────────────────────

  private async getFromCache(key: string): Promise<CatalogSearchResult | null> {
    if (!this.redis) return null;
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch {
      // Cache read failure is non-critical
    }
    return null;
  }

  private async setCache(key: string, data: CatalogSearchResult): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(data));
    } catch {
      // Cache write failure is non-critical
    }
  }
}
