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
  date?: string;
  venue?: string;
}

export interface CatalogSearchResult {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
}
