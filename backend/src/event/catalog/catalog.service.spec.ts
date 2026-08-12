import { CatalogService } from './catalog.service';
import { TicketmasterClient } from './ticketmaster.client';
import { TmdbClient } from './tmdb.client';
import { ExternalServiceError } from '../../shared/errors';
import { CatalogSearchResult } from './catalog.interfaces';

/**
 * Unit tests for CatalogService fallback behavior.
 *
 * Validates Req 4.4:
 * - API failure → return cached results if available
 * - API timeout → return cached results if available
 * - API empty results + no cache → 503 EXTERNAL_SERVICE_UNAVAILABLE
 * - API empty results + cache exists → return cached results
 * - Successful response → cached for 1 hour
 */

describe('CatalogService', () => {
  let service: CatalogService;
  let ticketmasterClient: jest.Mocked<TicketmasterClient>;
  let tmdbClient: jest.Mocked<TmdbClient>;
  let mockRedis: Record<string, string>;

  const mockResult: CatalogSearchResult = {
    items: [
      { externalId: '1', source: 'ticketmaster', name: 'Rock Show', image: 'http://img.com/1.jpg', category: 'Music' },
    ],
    total: 1,
    page: 0,
    pageSize: 20,
  };

  const emptyResult: CatalogSearchResult = {
    items: [],
    total: 0,
    page: 0,
    pageSize: 20,
  };

  beforeEach(() => {
    ticketmasterClient = {
      search: jest.fn(),
    } as any;

    tmdbClient = {
      search: jest.fn(),
    } as any;

    mockRedis = {};

    // Create service with mocked dependencies
    const mockConfigService = {
      get: jest.fn().mockReturnValue(null), // No Redis URL — will use in-memory behavior
    } as any;

    service = new CatalogService(ticketmasterClient, tmdbClient, mockConfigService);

    // Patch internal cache methods for testing
    (service as any).getFromCache = jest.fn().mockImplementation(async (key: string) => {
      const val = mockRedis[key];
      return val ? JSON.parse(val) : null;
    });
    (service as any).setCache = jest.fn().mockImplementation(async (key: string, data: any) => {
      mockRedis[key] = JSON.stringify(data);
    });
  });

  describe('Ticketmaster search with fallback', () => {
    it('returns API result and caches it on success', async () => {
      ticketmasterClient.search.mockResolvedValue(mockResult);

      const result = await service.searchTicketmaster('rock', 0);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Rock Show');
      expect((service as any).setCache).toHaveBeenCalled();
    });

    it('returns cached results when API fails', async () => {
      // Pre-populate cache
      const cacheKey = 'catalog:tm:rock:0:20';
      mockRedis[cacheKey] = JSON.stringify(mockResult);

      ticketmasterClient.search.mockRejectedValue(new Error('Network timeout'));

      const result = await service.searchTicketmaster('rock', 0);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Rock Show');
    });

    it('throws ExternalServiceError when API fails and no cache', async () => {
      ticketmasterClient.search.mockRejectedValue(new Error('Network timeout'));

      await expect(service.searchTicketmaster('rock', 0)).rejects.toThrow(ExternalServiceError);
    });

    it('returns cached results when API returns empty results', async () => {
      // Pre-populate cache
      const cacheKey = 'catalog:tm:jazz:0:20';
      mockRedis[cacheKey] = JSON.stringify(mockResult);

      ticketmasterClient.search.mockResolvedValue(emptyResult);

      const result = await service.searchTicketmaster('jazz', 0);

      expect(result.items).toHaveLength(1); // Got cached, not empty
    });

    it('throws ExternalServiceError when API returns empty and no cache (Req 4.4)', async () => {
      ticketmasterClient.search.mockResolvedValue(emptyResult);

      await expect(service.searchTicketmaster('nonexistent', 0)).rejects.toThrow(
        ExternalServiceError,
      );
    });
  });

  describe('TMDb search with fallback', () => {
    const tmdbResult: CatalogSearchResult = {
      items: [
        { externalId: '550', source: 'tmdb', name: 'Fight Club', image: 'http://img.com/fc.jpg', category: 'Movie' },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };

    it('returns API result on success', async () => {
      tmdbClient.search.mockResolvedValue(tmdbResult);

      const result = await service.searchTmdb('fight', 1);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Fight Club');
    });

    it('throws ExternalServiceError when API fails and no cache', async () => {
      tmdbClient.search.mockRejectedValue(new Error('API error'));

      await expect(service.searchTmdb('fight', 1)).rejects.toThrow(ExternalServiceError);
    });
  });

  describe('searchAll (merged results)', () => {
    it('merges results from both sources', async () => {
      ticketmasterClient.search.mockResolvedValue(mockResult);
      tmdbClient.search.mockResolvedValue({
        items: [{ externalId: '2', source: 'tmdb', name: 'Movie', image: null, category: 'Movie' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await service.searchAll('test', 0);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].source).toBe('ticketmaster');
      expect(result.items[1].source).toBe('tmdb');
    });

    it('returns partial results if one source fails', async () => {
      ticketmasterClient.search.mockResolvedValue(mockResult);
      tmdbClient.search.mockRejectedValue(new Error('TMDb down'));

      const result = await service.searchAll('test', 0);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].source).toBe('ticketmaster');
    });

    it('throws ExternalServiceError when both sources fail and no cache', async () => {
      ticketmasterClient.search.mockRejectedValue(new Error('TM down'));
      tmdbClient.search.mockRejectedValue(new Error('TMDb down'));

      await expect(service.searchAll('test', 0)).rejects.toThrow(ExternalServiceError);
    });
  });
});
