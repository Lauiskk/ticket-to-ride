import { Event, EventStatus, SeatingType } from '../entities/event.entity';

/**
 * Event response DTO.
 * NEVER exposes organizer internal ID or other user IDs (Req 6.4, 16.3).
 */
export class EventResponseDto {
  id: string;
  title: string;
  description: string;
  date: Date;
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
  halfPriceEnabled: boolean;
  halfPriceQuota: number | null;
  availableSeats?: number;
  imageUrl: string | null;
  externalId: string | null;
  externalSource: string | null;
  createdAt: Date;

  static fromEntity(event: Event, availableSeats?: number): EventResponseDto {
    const dto = new EventResponseDto();
    dto.id = event.id;
    dto.title = event.title;
    dto.description = event.description;
    dto.date = event.date;
    dto.venueName = event.venueName;
    dto.venueAddress = event.venueAddress;
    dto.venueCity = event.venueCity;
    dto.venueLat = event.venueLat;
    dto.venueLng = event.venueLng;
    dto.capacity = event.capacity;
    dto.seatingType = event.seatingType;
    dto.price = Number(event.price);
    dto.currency = event.currency;
    dto.status = event.status;
    dto.halfPriceEnabled = event.halfPriceEnabled ?? true;
    dto.halfPriceQuota = event.halfPriceQuota ?? null;
    dto.imageUrl = event.imageUrl ?? null;
    dto.externalId = event.externalId;
    dto.externalSource = event.externalSource;
    dto.createdAt = event.createdAt;
    if (availableSeats !== undefined) {
      dto.availableSeats = availableSeats;
    }
    // NOTE: organizerId is intentionally excluded (Req 6.4)
    return dto;
  }
}
