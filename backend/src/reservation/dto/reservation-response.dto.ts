import { Reservation, ReservationStatus } from '../entities/reservation.entity';

export class ReservationResponseDto {
  id: string;
  eventId: string;
  status: ReservationStatus;
  totalAmount: number;
  currency: string;
  expiresAt: Date;
  seatIds: string[];
  createdAt: Date;

  static fromEntity(reservation: Reservation): ReservationResponseDto {
    const dto = new ReservationResponseDto();
    dto.id = reservation.id;
    dto.eventId = reservation.eventId;
    dto.status = reservation.status;
    dto.totalAmount = Number(reservation.totalAmount);
    dto.currency = reservation.currency;
    dto.expiresAt = reservation.expiresAt;
    dto.seatIds = reservation.seats?.map((s) => s.id) || [];
    dto.createdAt = reservation.createdAt;
    // NOTE: userId intentionally excluded from response (Req 16.3)
    return dto;
  }
}
