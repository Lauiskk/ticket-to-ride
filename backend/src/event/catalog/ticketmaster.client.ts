import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogItem, CatalogSearchResult, CatalogSearchFilters } from './catalog.interfaces';

/**
 * Ticketmaster Discovery API v2 client.
 *
 * Field shapes, quirks and rate limits documented in
 * `SDD/08-anexos/API_TICKETMASTER_TMDB.md` — written against real responses.
 *
 * - 5-second timeout on all requests
 * - 5000 requests/day per key, so every call goes through the CatalogService cache
 * - API key never appears in responses or logs
 */

const TICKETMASTER_BASE = 'https://app.ticketmaster.com/discovery/v2';
const TIMEOUT_MS = 5000;

/**
 * Default market. Without it the API answers with US events — a Brazilian
 * organizer searching "rock" got Las Vegas.
 */
const DEFAULT_COUNTRY = 'BR';

/** Smallest width that still looks sharp on an event card. */
const MIN_CARD_IMAGE_WIDTH = 640;

@Injectable()
export class TicketmasterClient {
  private readonly logger = new Logger(TicketmasterClient.name);
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('externalApis.ticketmasterApiKey') || '';
  }

  async search(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
    const page = filters.page ?? 0;
    const size = filters.size ?? 20;

    const url = new URL(`${TICKETMASTER_BASE}/events.json`);
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('countryCode', filters.countryCode || DEFAULT_COUNTRY);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(size));
    url.searchParams.set('sort', 'date,asc');
    // `*` keeps non-English listings in the results
    url.searchParams.set('locale', '*');

    if (filters.query) url.searchParams.set('keyword', filters.query);
    if (filters.city) url.searchParams.set('city', filters.city);
    if (filters.classificationName) {
      url.searchParams.set('classificationName', filters.classificationName);
    }
    if (filters.startDateTime) {
      // The API rejects fractional seconds — `2026-09-01T00:00:00.000Z` is a 400
      url.searchParams.set('startDateTime', filters.startDateTime.replace(/\.\d{3}(?=Z$)/, ''));
    }

    const response = await this.fetchWithTimeout(url.toString());

    if (!response.ok) {
      throw new Error(`Ticketmaster API returned ${response.status}`);
    }

    const data = await response.json();
    // `_embedded` is absent when there are no results — not defensive, required
    const events = data?._embedded?.events ?? [];

    return {
      items: events.map((event: any) => this.toCatalogItem(event)),
      total: data?.page?.totalElements ?? 0,
      page,
      pageSize: size,
    };
  }

  private toCatalogItem(event: any): CatalogItem {
    const venue = event?._embedded?.venues?.[0];
    const classification = event?.classifications?.[0];

    return {
      externalId: event.id,
      source: 'ticketmaster',
      name: event.name,
      image: this.bestImage(event.images),
      // The genre ("Rock") tells the organizer more than the segment ("Music")
      category: classification?.genre?.name || classification?.segment?.name || 'Evento',
      description: event.info || event.pleaseNote || '',
      date: event.dates?.start?.dateTime || event.dates?.start?.localDate || undefined,
      venue: venue?.name ?? null,
      venueCity: venue?.city?.name ?? null,
      venueAddress: venue?.address?.line1 ?? null,
      // The API sends coordinates as strings
      venueLat: this.toNumber(venue?.location?.latitude),
      venueLng: this.toNumber(venue?.location?.longitude),
    };
  }

  /**
   * Pick a 16:9 image sized for a card.
   *
   * The array is unordered and mixes ratios and sizes — a real event ships
   * eleven variants from 100×56 to 2462×1365. Taking `images[0]` lands on the
   * thumbnail; taking the largest ships a 260 KB `_SOURCE` file into a tile
   * that renders at 400px. So: the smallest widescreen image that is still
   * sharp enough, and only fall back to the biggest when nothing qualifies.
   */
  private bestImage(images: any[] | undefined): string | null {
    if (!Array.isArray(images) || images.length === 0) return null;

    const widescreen = images.filter((i) => i?.ratio === '16_9' && i?.url);
    const pool = widescreen.length > 0 ? widescreen : images.filter((i) => i?.url);
    if (pool.length === 0) return null;

    const sharpEnough = pool
      .filter((i) => (i.width ?? 0) >= MIN_CARD_IMAGE_WIDTH)
      .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));

    if (sharpEnough.length > 0) return sharpEnough[0].url;

    return pool.reduce((best, img) => ((img.width ?? 0) > (best.width ?? 0) ? img : best)).url;
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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
