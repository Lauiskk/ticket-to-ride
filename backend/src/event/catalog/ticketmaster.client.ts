import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogItem, CatalogSearchResult } from './catalog.interfaces';

/**
 * Ticketmaster Discovery API v2 client.
 *
 * Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2
 *
 * - 5-second timeout on all requests
 * - Returns structured CatalogItem results
 * - API key from environment variable, NEVER in responses or logs
 */

const TICKETMASTER_BASE = 'https://app.ticketmaster.com/discovery/v2';
const TIMEOUT_MS = 5000;

@Injectable()
export class TicketmasterClient {
  private readonly logger = new Logger(TicketmasterClient.name);
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('externalApis.ticketmasterApiKey') || '';
  }

  /**
   * Search events on Ticketmaster.
   */
  async search(query: string, page = 0, size = 20): Promise<CatalogSearchResult> {
    const url = new URL(`${TICKETMASTER_BASE}/events.json`);
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('keyword', query);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(size));

    const response = await this.fetchWithTimeout(url.toString());

    if (!response.ok) {
      throw new Error(`Ticketmaster API returned ${response.status}`);
    }

    const data = await response.json();
    const events = data?._embedded?.events || [];
    const totalElements = data?.page?.totalElements || 0;

    const items: CatalogItem[] = events.map((event: any) => ({
      externalId: event.id,
      source: 'ticketmaster' as const,
      name: event.name,
      image: event.images?.[0]?.url || null,
      category: event.classifications?.[0]?.segment?.name || 'Event',
      description: event.info || event.pleaseNote || '',
      date: event.dates?.start?.dateTime || null,
      venue: event._embedded?.venues?.[0]?.name || null,
    }));

    return {
      items,
      total: totalElements,
      page,
      pageSize: size,
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
