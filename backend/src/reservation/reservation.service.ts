import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, EntityManager } from 'typeorm';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { Seat, SeatStatus } from '../event/entities/seat.entity';
import { Event } from '../event/entities/event.entity';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationResponseDto } from './dto/reservation-response.dto';
import { AppError, ErrorCodes, SeatUnavailableError } from '../shared/errors';
import { ConfigService } from '@nestjs/config';
import { ReservationGateway } from './reservation.gateway';

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
    private readonly gateway: ReservationGateway,
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

      // ─── Half-price (SPEC_CP12 RF-9..RF-11) ─────────────────────────────
      // Validated and priced inside the transaction, so two simultaneous
      // buyers cannot both slip past the last slot of the quota.
      const halfPriceClaims = await this.resolveHalfPriceClaims(
        queryRunner.manager,
        event,
        dto,
      );

      // Price is always derived from the event — the client only says WHICH
      // seats are half-price, never what anything costs (RF-10, AC-2).
      const fullPrice = Number(event.price);
      const halfCount = halfPriceClaims ? Object.keys(halfPriceClaims).length : 0;
      const fullCount = dto.seatIds.length - halfCount;
      const totalAmount = fullPrice * fullCount + (fullPrice / 2) * halfCount;

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
        halfPriceClaims,
      });

      const savedReservation = await queryRunner.manager.save(Reservation, reservation);

      // Link seats to reservation via join table
      await queryRunner.query(
        `INSERT INTO reservation_seats (reservation_id, seat_id) VALUES ${dto.seatIds.map((_, i) => `($1, $${i + 2})`).join(', ')}`,
        [savedReservation.id, ...dto.seatIds],
      );

      await queryRunner.commitTransaction();

      // Everyone else watching this event sees the seats grey out immediately
      this.gateway.broadcastSeatsReserved(dto.eventId, dto.seatIds);

      // Return response with seat IDs
      savedReservation.seats = lockedSeats;
      return ReservationResponseDto.fromEntity(savedReservation);
    } catch (error) {
      await queryRunner.rollbackTransaction();

      // Re-throw our own errors
      if (error instanceof AppError) throw error;

      // Only a genuine contention error means "someone took this seat".
      //
      // This used to blanket-convert EVERY unknown exception into
      // SeatUnavailableError. The result was that a database hiccup during a
      // deploy told buyers "alguém garantiu esse lugar primeiro" for every seat
      // on the map — sending them to hunt for a free seat that was never taken.
      // Reporting an infrastructure failure as a business conflict is worse than
      // failing: it makes the user debug the wrong problem.
      if (ReservationService.isContentionError(error)) {
        this.logger.warn(
          `Seat contention on event ${dto.eventId}: ${ReservationService.pgCode(error)}`,
        );
        throw new SeatUnavailableError();
      }

      this.logger.error(
        `Reservation failed for event ${dto.eventId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new AppError(
        'Não foi possível concluir a reserva agora. Tente novamente em instantes.',
        ErrorCodes.INTERNAL_ERROR,
        500,
      );
    } finally {
      await queryRunner.release();
    }
  }

  /** Postgres error code, when the driver gives us one. */
  private static pgCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null
      ? (error as { code?: string }).code
      : undefined;
  }

  /**
   * Errors that genuinely mean another buyer got there first.
   *
   * - `55P03` lock_not_available — our SELECT ... FOR UPDATE NOWAIT lost the race
   * - `40001` serialization_failure
   * - `40P01` deadlock_detected
   * - `23505` unique_violation — the seat is already linked to another reservation
   */
  private static isContentionError(error: unknown): boolean {
    const code = ReservationService.pgCode(error);
    return code === '55P03' || code === '40001' || code === '40P01' || code === '23505';
  }

  // ─── Get Available Seats ────────────────────────────────────────────────────

  async getAvailableSeats(eventId: string): Promise<Seat[]> {
    // Return ALL seats with their status so frontend can show unavailable ones as gray
    return this.seatRepo.find({
      where: { eventId },
      order: { section: 'ASC', row: 'ASC', number: 'ASC' },
    });
  }

  // ─── Half-price resolution (SPEC_CP12) ────────────────────────────────────

  /**
   * Validate the half-price claims and turn them into the seat-keyed map stored
   * on the reservation. Returns `null` when there are no claims.
   *
   * Runs on the transaction's manager on purpose: the quota check has to see the
   * same snapshot as the seat locks, otherwise two buyers racing for the last
   * half-price slot both pass (RNF-1).
   */
  private async resolveHalfPriceClaims(
    manager: EntityManager,
    event: Event,
    dto: CreateReservationDto,
  ): Promise<Record<string, { category: string; document: string }> | null> {
    const claims = dto.halfPriceClaims;
    if (!claims || claims.length === 0) return null;

    if (!event.halfPriceEnabled) {
      throw new AppError(
        'Este evento não oferece meia-entrada.',
        ErrorCodes.BAD_REQUEST,
        400,
      );
    }

    const requestedSeats = new Set(dto.seatIds);
    const seen = new Set<string>();

    for (const claim of claims) {
      if (!requestedSeats.has(claim.seatId)) {
        throw new AppError(
          'Meia-entrada declarada para um assento que não está na reserva.',
          ErrorCodes.BAD_REQUEST,
          400,
        );
      }
      if (seen.has(claim.seatId)) {
        throw new AppError(
          'O mesmo assento foi declarado como meia-entrada mais de uma vez.',
          ErrorCodes.BAD_REQUEST,
          400,
        );
      }
      seen.add(claim.seatId);
    }

    if (event.halfPriceQuota !== null && event.halfPriceQuota !== undefined) {
      // Count claims on reservations that are still holding or already own their
      // seats — NOT issued tickets.
      //
      // Counting tickets was wrong and real testing proved it: while a buyer is
      // in checkout their reservation has no tickets yet, so a second buyer saw
      // a free quota and both got through. A pending reservation is a claim on
      // the quota exactly like a paid one.
      const [row] = await manager.query(
        `SELECT COALESCE(SUM(k.cnt), 0)::int AS taken
           FROM reservations r
           CROSS JOIN LATERAL (
             SELECT count(*) AS cnt FROM jsonb_object_keys(r.half_price_claims)
           ) k
          WHERE r.event_id = $1
            AND r.half_price_claims IS NOT NULL
            AND r.status IN ('pending_payment', 'paid')`,
        [event.id],
      );

      const taken = Number(row?.taken ?? 0);

      if (taken + claims.length > event.halfPriceQuota) {
        const remaining = Math.max(event.halfPriceQuota - taken, 0);
        throw new AppError(
          remaining === 0
            ? 'As meias-entradas deste evento esgotaram.'
            : `Restam apenas ${remaining} meia(s)-entrada(s) para este evento.`,
          ErrorCodes.HALF_PRICE_QUOTA_EXCEEDED,
          409,
        );
      }
    }

    return Object.fromEntries(
      claims.map((c) => [c.seatId, { category: c.category, document: c.document }]),
    );
  }

  // ─── Cancel a Pending Reservation (SPEC_CP10 RF-8) ────────────────────────

  /**
   * Client gave up at checkout. Release the seats immediately instead of making
   * everyone wait for the 10-minute expiration sweep — during that window the
   * seats look taken to every other buyer for no reason.
   *
   * Only the owner can cancel, and only while payment is still pending: a paid
   * reservation is a ticket already issued and must go through refund instead.
   */
  async cancelReservation(userId: string, reservationId: string): Promise<{ released: number }> {
    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId, userId },
      relations: ['seats'],
    });

    if (!reservation) {
      // Anti-enumeration: someone else's reservation is simply "not found"
      throw new AppError('Reservation not found', ErrorCodes.NOT_FOUND, 404);
    }

    // Already released by expiration or a previous cancel — idempotent success
    if (
      reservation.status === ReservationStatus.CANCELLED ||
      reservation.status === ReservationStatus.EXPIRED
    ) {
      return { released: 0 };
    }

    if (reservation.status !== ReservationStatus.PENDING_PAYMENT) {
      throw new AppError(
        'Esta reserva não pode mais ser cancelada.',
        ErrorCodes.BAD_REQUEST,
        400,
      );
    }

    const seatIds = reservation.seats.map((s) => s.id);

    if (seatIds.length > 0) {
      // Only flip seats still held by this reservation — never steal a sold seat
      await this.seatRepo
        .createQueryBuilder()
        .update(Seat)
        .set({ status: SeatStatus.AVAILABLE })
        .where('id IN (:...seatIds)', { seatIds })
        .andWhere('status = :reserved', { reserved: SeatStatus.RESERVED })
        .execute();
    }

    reservation.status = ReservationStatus.CANCELLED;
    await this.reservationRepo.save(reservation);

    if (seatIds.length > 0) {
      this.gateway.broadcastSeatsReleased(reservation.eventId, seatIds);
    }

    this.logger.log(
      `Reservation ${reservationId} cancelled by owner — ${seatIds.length} seats released`,
    );

    return { released: seatIds.length };
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
