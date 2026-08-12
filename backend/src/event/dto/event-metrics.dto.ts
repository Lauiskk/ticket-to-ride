import { EventStatus } from '../entities/event.entity';

/**
 * Sales panel for one event (SPEC_CP12 RF-6).
 *
 * Aggregates only — no buyer identity, e-mail or document. The organizer sees
 * how the house is filling, not who is in it.
 */
export class EventMetricsDto {
  eventId: string;
  title: string;
  status: EventStatus;

  seatsTotal: number;
  seatsSold: number;
  seatsReserved: number;
  seatsAvailable: number;
  /** Percentage of seats sold, 0–100. */
  occupancyRate: number;

  /** Sum of paid reservations. Reserved-but-unpaid is NOT revenue. */
  revenue: number;
  currency: string;

  ticketsIssued: number;
  ticketsValidated: number;
  halfPriceTickets: number;

  bySection: Array<{ section: string; total: number; sold: number }>;
}
