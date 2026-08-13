import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TicketmasterClient } from './ticketmaster.client';
import { TmdbClient } from './tmdb.client';
import { CatalogSearchResult, CatalogSearchFilters } from './catalog.interfaces';
import { ExternalServiceError } from '../../shared/errors';

/**
 * Catálogo externo: Ticketmaster e TMDb, com cache de 1 hora no Redis.
 *
 * Falha, timeout ou resultado vazio caem no cache; sem cache, é 503. Vazio sem
 * cache conta como falha, não como sucesso vazio — devolver "nenhum evento"
 * para uma API fora do ar faz o organizador achar que não há o que vender.
 * Chave de API nunca aparece em resposta nem em log.
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

  async searchTicketmaster(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
    return this.withCacheFallback(
      this.cacheKey('tm', filters),
      () => this.ticketmasterClient.search(filters),
      'Ticketmaster',
    );
  }

  async searchTmdb(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
    return this.withCacheFallback(
      this.cacheKey('tmdb', filters),
      () => this.tmdbClient.search({ ...filters, page: (filters.page ?? 0) + 1 }),
      'TMDb',
    );
  }

  /**
   * Filmes em cartaz no Brasil. Separado da busca de propósito: "o que posso pôr
   * à venda hoje" é outra pergunta, e vem de outro endpoint.
   */
  async nowPlaying(page = 0): Promise<CatalogSearchResult> {
    return this.withCacheFallback(
      `${CACHE_PREFIX}tmdb:nowplaying:${page}`,
      () => this.tmdbClient.nowPlaying(page + 1),
      'TMDb',
    );
  }

  async searchAll(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
    const page = filters.page ?? 0;

    const [tmResult, tmdbResult] = await Promise.allSettled([
      this.searchTicketmaster(filters),
      this.searchTmdb(filters),
    ]);

    const tmItems = tmResult.status === 'fulfilled' ? tmResult.value.items : [];
    const tmdbItems = tmdbResult.status === 'fulfilled' ? tmdbResult.value.items : [];

    const items = [...tmItems, ...tmdbItems];

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

  /** Tenta a API; falha, timeout ou vazio caem no cache; sem cache, 503. */
  private async withCacheFallback(
    cacheKey: string,
    fetcher: () => Promise<CatalogSearchResult>,
    serviceName: string,
  ): Promise<CatalogSearchResult> {
    try {
      const result = await fetcher();

      if (result.items.length === 0) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger.debug(`${serviceName}: empty result, returning cache`);
          return cached;
        }
        throw new ExternalServiceError(serviceName);
      }

      await this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      if (error instanceof ExternalServiceError) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) return cached;
        throw error;
      }

      this.logger.warn(`${serviceName} API failed: ${error instanceof Error ? error.message : 'unknown'}`);
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        this.logger.debug(`${serviceName}: returning cached results after API failure`);
        return cached;
      }

      throw new ExternalServiceError(serviceName);
    }
  }

  /** Duas buscas que diferem só na cidade são perguntas diferentes. */
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

  private async getFromCache(key: string): Promise<CatalogSearchResult | null> {
    if (!this.redis) return null;
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch {
    }
    return null;
  }

  private async setCache(key: string, data: CatalogSearchResult): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(data));
    } catch {
    }
  }
}
