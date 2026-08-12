import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { Seat, SeatStatus } from '../event/entities/seat.entity';
import { Event } from '../event/entities/event.entity';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationResponseDto } from './dto/reservation-response.dto';
import { AppError, ErrorCodes, SeatUnavailableError } from '../shared/errors';
import { ConfigService } from '@nestjs/config';

/**
 * Reservation service with concurrency control.
 *
 * Key behaviors:
 * - Pessimistic locking via SELECT FOR UPDATE NOWAIT (Req 7.1)
 * - Multi-seat atomic reservation: all succeed or all fail (Req 7.5)
 * - 10-minute expiration on pending reservations (Req 7.3, 7.4)
 * - Excluded reserved/sold seats from availability (Req 7.7)
 * - Returns 409 SEAT_UNAVAILABLE within 2 seconds (Req 7.2)
 */
@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);
  private readonly reservationTtlMinutes: number;

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    @InjectRepository(Seat)
    private readonly seatRepo: Repository<Seat>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.reservationTtlMinutes = this.configService.get<number>('reservation.ttlMinutes', 10);
  }

  // ─── Reserve Seats ────────────────────────────────────────────────────────

  /**
   * Reserve one or more seats atomically with pessimistic locking.
   *
   * Uses SELECT FOR UPDATE NOWAIT to prevent concurrent reservation of the same seat.
   * If ANY seat is already locked or reserved, the entire transaction fails (Req 7.5).
   */
  async reserveSeats(userId: string, dto: CreateReservationDto): Promise<ReservationResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Verify event exists and is published
      const event = await queryRunner.manager.findOne(Event, {
        where: { id: dto.eventId },
      });

      if (!event) {
        throw new AppError('Event not found', ErrorCodes.NOT_FOUND, 404);
      }

      if (event.status !== 'published') {
        throw new AppError('Event is not available for reservations', ErrorCodes.BAD_REQUEST, 400);
      }

      // Lock all requested seats with NOWAIT (Req 7.1, 7.2)
      // If any seat is already locked by another transaction → immediate error
      let lockedSeats: Seat[];
      try {
        lockedSeats = await queryRunner.manager
          .createQueryBuilder(Seat, 'seat')
          .setLock('pessimistic_write_or_fail') // NOWAIT semantics
          .where('seat.id IN (:...seatIds)', { seatIds: dto.seatIds })
          .andWhere('seat.event_id = :eventId', { eventId: dto.eventId })
          .getMany();
      } catch (lockError: any) {
        // NOWAIT lock failure → 409 within 2 seconds (Req 7.2)
        throw new SeatUnavailableError();
      }

      // Verify all requested seats were found
      if (lockedSeats.length !== dto.seatIds.length) {
        throw new AppError(
          'One or more seats not found for this event',
          ErrorCodes.BAD_REQUEST,
          400,
        );
      }

      // Verify all seats are available (Req 7.7)
      const unavailable = lockedSeats.filter((s) => s.status !== SeatStatus.AVAILABLE);
      if (unavailable.length > 0) {
        throw new SeatUnavailableError(unavailable[0].id);
      }

      // Calculate total price
      const totalAmount = Number(event.price) * dto.seatIds.length;

      // Set expiration (Req 7.3)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + this.reservationTtlMinutes);

      // Mark seats as reserved
      await queryRunner.manager
        .createQueryBuilder()
        .update(Seat)
        .set({ status: SeatStatus.RESERVED })
        .where('id IN (:...seatIds)', { seatIds: dto.seatIds })
        .execute();

      // Create reservation record
      const reservation = queryRunner.manager.create(Reservation, {
        userId,
        eventId: dto.eventId,
        status: ReservationStatus.PENDING_PAYMENT,
        totalAmount,
        currency: event.currency,
        expiresAt,
      });

      const savedReservation = await queryRunner.manager.save(Reservation, reservation);

      // Link seats to reservation via join table
      await queryRunner.query(
        `INSERT INTO reservation_seats (reservation_id, seat_id) VALUES ${dto.seatIds.map((_, i) => `($1, $${i + 2})`).join(', ')}`,
        [savedReservation.id, ...dto.seatIds],
      );

      await queryRunner.commitTransaction();

      // Return response with seat IDs
      savedReservation.seats = lockedSeats;
      return ReservationResponseDto.fromEntity(savedReservation);
    } catch (error) {
      await queryRunner.rollbackTransaction();

      // Re-throw our own errors
      if (error instanceof AppError) throw error;

      // Unknown DB errors → wrap as SeatUnavailableError (likely lock contention)
      this.logger.error('Reservation failed', error instanceof Error ? error.message : String(error));
      throw new SeatUnavailableError();
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Get Available Seats ────────────────────────────────────────────────────

  async getAvailableSeats(eventId: string): Promise<Seat[]> {
    return this.seatRepo.find({
      where: { eventId, status: SeatStatus.AVAILABLE },
      order: { section: 'ASC', row: 'ASC', number: 'ASC' },
    });
  }

  // ─── Get User's Reservations ────────────────────────────────────────────────

  async getMyReservations(userId: string): Promise<ReservationResponseDto[]> {
    const reservations = await this.reservationRepo.find({
      where: { userId },
      relations: ['seats'],
      order: { createdAt: 'DESC' },
    });
    return reservations.map((r) => ReservationResponseDto.fromEntity(r));
  }

  // ─── Expire Pending Reservations (Req 7.4) ────────────────────────────────

  /**
   * Find all expired pending_payment reservations and release their seats.
   * Called by the scheduled task (cron).
   */
  async expireOverdueReservations(): Promise<number> {
    const result = await this.expireOverdueReservationsDetailed();
    return result.length;
  }

  /**
   * Same as expireOverdueReservations but returns details for WebSocket broadcasting.
   */
  async expireOverdueReservationsDetailed(): Promise<Array<{ eventId: string; seatIds: string[] }>> {
    const now = new Date();

    const expired = await this.reservationRepo.find({
      where: { status: ReservationStatus.PENDING_PAYMENT },
      relations: ['seats'],
    });

    const toExpire = expired.filter((r) => r.expiresAt <= now);
    if (toExpire.length === 0) return [];

    const results: Array<{ eventId: string; seatIds: string[] }> = [];

    for (const reservation of toExpire) {
      const seatIds = reservation.seats.map((s) => s.id);
      if (seatIds.length > 0) {
        await this.seatRepo
          .createQueryBuilder()
          .update(Seat)
          .set({ status: SeatStatus.AVAILABLE })
          .where('id IN (:...seatIds)', { seatIds })
          .execute();
      }

      reservation.status = ReservationStatus.EXPIRED;
      await this.reservationRepo.save(reservation);

      results.push({ eventId: reservation.eventId, seatIds });
    }

    this.logger.log(`Expired ${toExpire.length} overdue reservations, released seats`);
    return results;
  }
}
