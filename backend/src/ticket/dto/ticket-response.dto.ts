import { Ticket, TicketStatus } from '../entities/ticket.entity';

/**
 * Ticket as the owner sees it.
 *
 * Carries the event inline because a ticket without the event name is useless:
 * the list used to lead with "Assento: Sala 1-1-1", which tells you nothing
 * about which show you are going to. It also saves the detail screen a second
 * round-trip just to learn the title.
 *
 * Deliberately shaped rather than returning the entity: the raw Event carries
 * `organizerId`, which is never exposed (Req 6.4).
 */
export class TicketResponseDto {
  id: string;
  eventId: string;
  reservationId: string;
  seatIdentifier: string;
  ticketCode: string;
  qrPayload: string;
  qrImageUrl: string;
  status: TicketStatus;
  isHalfPrice: boolean;
  halfPriceCategory: string | null;
  validatedAt: Date | null;
  createdAt: Date;

  /** Enough of the event to render the ticket without another request. */
  event: {
    title: string;
    date: Date;
    venueName: string;
    venueCity: string | null;
    venueAddress: string;
    imageUrl: string | null;
  } | null;

  static fromEntity(ticket: Ticket): TicketResponseDto {
    const dto = new TicketResponseDto();

    dto.id = ticket.id;
    dto.eventId = ticket.eventId;
    dto.reservationId = ticket.reservationId;
    dto.seatIdentifier = ticket.seatIdentifier;
    dto.ticketCode = ticket.ticketCode;
    dto.qrPayload = ticket.qrPayload;
    dto.qrImageUrl = ticket.qrImageUrl;
    dto.status = ticket.status;
    dto.isHalfPrice = ticket.isHalfPrice ?? false;
    dto.halfPriceCategory = ticket.halfPriceCategory ?? null;
    dto.validatedAt = ticket.validatedAt;
    dto.createdAt = ticket.createdAt;

    dto.event = ticket.event
      ? {
          title: ticket.event.title,
          date: ticket.event.date,
          venueName: ticket.event.venueName,
          venueCity: ticket.event.venueCity,
          venueAddress: ticket.event.venueAddress,
          imageUrl: ticket.event.imageUrl ?? null,
        }
      : null;

    // NOTE: holderDocument and hmacSignature are intentionally excluded.
    // The document is PII the owner already knows, and the signature travels
    // inside the QR payload — neither belongs in a list response.
    return dto;
  }
}
