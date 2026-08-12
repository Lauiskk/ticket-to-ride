/**
 * Shared interfaces for external catalog integration.
 */

export interface CatalogItem {
  externalId: string;
  source: 'ticketmaster' | 'tmdb';
  name: string;
  image: string | null;
  category: string;
  description?: string;
  /**
   * Ticketmaster: the real session start. TMDb: the theatrical release date —
   * informative only, never the event date (SDD/08-anexos, §3).
   */
  date?: string;
  venue?: string | null;
  /**
   * Venue details, when the source knows them (Ticketmaster does, TMDb does not).
   * These exist so the organizer does not retype an address the API already has.
   */
  venueCity?: string | null;
  venueAddress?: string | null;
  venueLat?: number | null;
  venueLng?: number | null;
}

/** Filters accepted by the catalogue search (SPEC_CP13). */
export interface CatalogSearchFilters {
  query?: string;
  /** ISO 3166 country. Defaults to BR — without it Ticketmaster answers with the US. */
  countryCode?: string;
  city?: string;
  /** Ticketmaster classification: Music, Film, Arts & Theatre, Sports... */
  classificationName?: string;
  /** ISO-8601 without milliseconds. */
  startDateTime?: string;
  page?: number;
  size?: number;
}

export interface CatalogSearchResult {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
}
