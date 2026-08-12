// ─── User & Auth ────────────────────────────────────────────────────────────

export type UserRole = 'organizer' | 'client' | 'gate';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

// ─── Events ─────────────────────────────────────────────────────────────────

export type EventStatus = 'draft' | 'published' | 'cancelled';
export type SeatingType = 'numbered' | 'general-admission';

export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  venueName: string;
  venueAddress: string;
  venueCity: string | null;
  venueLat: number | null;
  venueLng: number | null;
  capacity: number;
  seatingType: SeatingType;
  price: number;
  currency: string;
  status: EventStatus;
  /** Half-price offered (Lei 12.933/2013). Defaults to true on the API. */
  halfPriceEnabled: boolean;
  /** Cap on half-price tickets; null = no cap. */
  halfPriceQuota: number | null;
  availableSeats?: number;
  externalId: string | null;
  externalSource: string | null;
  createdAt: string;
}

export interface EventSearchParams {
  keyword?: string;
  city?: string;
  dateFrom?: string;
  dateTo?: string;
  priceMin?: number;
  priceMax?: number;
  sortBy?: 'date_asc' | 'date_desc' | 'price_asc' | 'price_desc' | 'relevance';
  page?: number;
  pageSize?: number;
  lat?: number;
  lng?: number;
  radius?: number;
}

// ─── Seats ──────────────────────────────────────────────────────────────────

export type SeatStatus = 'available' | 'reserved' | 'sold';

export interface Seat {
  id: string;
  eventId: string;
  section: string;
  row: string | null;
  number: string | null;
  status: SeatStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Reservations ───────────────────────────────────────────────────────────

export type ReservationStatus = 'pending_payment' | 'paid' | 'expired' | 'payment_failed' | 'refunded';

export interface Reservation {
  id: string;
  eventId: string;
  status: ReservationStatus;
  totalAmount: number;
  currency: string;
  expiresAt: string;
  seatIds: string[];
  createdAt: string;
}

export interface CreateReservationPayload {
  eventId: string;
  seatIds: string[];
}

// ─── Payments ───────────────────────────────────────────────────────────────

export interface PaymentIntent {
  clientSecret: string;
  paymentId: string;
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export type TicketStatus = 'active' | 'used' | 'invalidated';

export interface Ticket {
  id: string;
  eventId: string;
  reservationId: string;
  ownerId: string;
  seatIdentifier: string;
  ticketCode: string;
  qrPayload: string;
  qrImageUrl: string;
  qrImageFormat: string;
  hmacSignature: string;
  status: TicketStatus;
  /** Half-price ticket — the gate will ask for the declared document. */
  isHalfPrice: boolean;
  halfPriceCategory: string | null;
  validatedAt: string | null;
  validatedByGateId: string | null;
  createdAt: string;
}

// ─── Sharing ────────────────────────────────────────────────────────────────

export interface SharingLink {
  token: string;
  shareUrl: string;
  expiresAt: string;
}

// ─── Gate Validation ────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  ticketId?: string;
  seatIdentifier?: string;
  eventTitle?: string;
  validatedAt?: string;
  /** Half-price ticket — the operator must check the matching document. */
  isHalfPrice?: boolean;
  halfPriceCategory?: string | null;
  /** Masked by the API — never the full number. */
  holderDocumentMasked?: string | null;
  error?: { code: string; message: string; firstValidatedAt?: string };
}

export interface ValidateTicketPayload {
  qrPayload: string;
  eventId: string;
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export type CatalogSource = 'ticketmaster' | 'tmdb';

export interface CatalogItem {
  externalId: string;
  source: CatalogSource;
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

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface PaginatedMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

// ─── API Error ──────────────────────────────────────────────────────────────

export interface ApiError {
  message: string;
  code: string;
  statusCode: number;
  errors?: Array<{ field: string; message: string; code: string }>;
}

// ─── WebSocket ──────────────────────────────────────────────────────────────

/** Sales panel for one event (GET /events/:id/metrics) — aggregates only. */
export interface EventMetrics {
  eventId: string;
  title: string;
  status: EventStatus;
  seatsTotal: number;
  seatsSold: number;
  seatsReserved: number;
  seatsAvailable: number;
  occupancyRate: number;
  revenue: number;
  currency: string;
  ticketsIssued: number;
  ticketsValidated: number;
  halfPriceTickets: number;
  bySection: Array<{ section: string; total: number; sold: number }>;
}

export type HalfPriceCategory = 'student' | 'senior' | 'pcd';

export interface HalfPriceClaim {
  seatId: string;
  category: HalfPriceCategory;
  document: string;
}

/**
 * One line of the gate's operational agenda (GET /gate/events).
 * Intentionally not an Event: no price, no description, no buyer data.
 */
export interface GateEventSummary {
  id: string;
  title: string;
  venueName: string;
  date: string;
  entryOpen: boolean;
  entryOpensAt: string;
  entryClosesAt: string;
  ticketsIssued: number;
  ticketsValidated: number;
}

export interface SeatStatusUpdate {
  eventId: string;
  seats: Array<{ id: string; status: SeatStatus }>;
  timestamp: string;
}
