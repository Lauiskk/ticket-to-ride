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
 * Reserva de assentos — o ponto crítico do sistema: dois compradores disputando
 * o mesmo lugar no mesmo instante.
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

  /**
   * Tudo ou nada, com `SELECT … FOR UPDATE NOWAIT`. Um assento já travado por
   * outra transação derruba a reserva inteira.
   */
  async reserveSeats(userId: string, dto: CreateReservationDto): Promise<ReservationResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const event = await queryRunner.manager.findOne(Event, {
        where: { id: dto.eventId },
      });

      if (!event) {
        throw new AppError('Event not found', ErrorCodes.NOT_FOUND, 404);
      }

      if (event.status !== 'published') {
        throw new AppError('Event is not available for reservations', ErrorCodes.BAD_REQUEST, 400);
      }

      let lockedSeats: Seat[];
      try {
        lockedSeats = await queryRunner.manager
          .createQueryBuilder(Seat, 'seat')
          .setLock('pessimistic_write_or_fail') // NOWAIT semantics
          .where('seat.id IN (:...seatIds)', { seatIds: dto.seatIds })
          .andWhere('seat.event_id = :eventId', { eventId: dto.eventId })
          .getMany();
      } catch (lockError: any) {
        throw new SeatUnavailableError();
      }

      if (lockedSeats.length !== dto.seatIds.length) {
        throw new AppError(
          'One or more seats not found for this event',
          ErrorCodes.BAD_REQUEST,
          400,
        );
      }

      const unavailable = lockedSeats.filter((s) => s.status !== SeatStatus.AVAILABLE);
      if (unavailable.length > 0) {
        throw new SeatUnavailableError(unavailable[0].id);
      }
      // Dentro da transação: dois compradores simultâneos não passam os dois
      // pela última vaga da cota de meia-entrada.
      const halfPriceClaims = await this.resolveHalfPriceClaims(
        queryRunner.manager,
        event,
        dto,
      );

      // O preço vem do evento. O cliente diz QUAIS assentos são meia, nunca quanto custam.
      const fullPrice = Number(event.price);
      const halfCount = halfPriceClaims ? Object.keys(halfPriceClaims).length : 0;
      const fullCount = dto.seatIds.length - halfCount;
      const totalAmount = fullPrice * fullCount + (fullPrice / 2) * halfCount;

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + this.reservationTtlMinutes);

      await queryRunner.manager
        .createQueryBuilder()
        .update(Seat)
        .set({ status: SeatStatus.RESERVED })
        .where('id IN (:...seatIds)', { seatIds: dto.seatIds })
        .execute();

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

      await queryRunner.query(
        `INSERT INTO reservation_seats (reservation_id, seat_id) VALUES ${dto.seatIds.map((_, i) => `($1, $${i + 2})`).join(', ')}`,
        [savedReservation.id, ...dto.seatIds],
      );

      await queryRunner.commitTransaction();

      // Quem está olhando o mapa vê os lugares apagarem na hora
      this.gateway.broadcastSeatsReserved(dto.eventId, dto.seatIds);

      savedReservation.seats = lockedSeats;
      return ReservationResponseDto.fromEntity(savedReservation);
    } catch (error) {
      await queryRunner.rollbackTransaction();

      if (error instanceof AppError) throw error;

      // Só disputa de verdade vira "alguém pegou esse lugar". Isto embrulhava
      // qualquer exceção, e uma falha de banco no deploy mandava o comprador
      // caçar lugar livre num mapa inteiro livre. Erro de infra com cara de
      // conflito de negócio é pior que falhar: faz depurar o problema errado.
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

  /** Código de erro do Postgres, quando o driver entrega um. */
  private static pgCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null
      ? (error as { code?: string }).code
      : undefined;
  }

  /**
   * Erros que realmente significam "outro comprador chegou primeiro":
   * `55P03` lock_not_available, `40001` serialization_failure,
   * `40P01` deadlock_detected, `23505` unique_violation.
   */
  private static isContentionError(error: unknown): boolean {
    const code = ReservationService.pgCode(error);
    return code === '55P03' || code === '40001' || code === '40P01' || code === '23505';
  }

  async getAvailableSeats(eventId: string): Promise<Seat[]> {
    // Todos os assentos, com status: o mapa precisa desenhar os ocupados também
    return this.seatRepo.find({
      where: { eventId },
      order: { section: 'ASC', row: 'ASC', number: 'ASC' },
    });
  }

  /**
   * Confere as declarações de meia-entrada e devolve o mapa por assento.
   *
   * Roda no manager da transação de propósito: a cota precisa enxergar o mesmo
   * instantâneo dos bloqueios de assento, senão dois compradores disputando a
   * última meia passam os dois.
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
      // Conta declarações de reservas pendentes E pagas, não ingressos emitidos.
      // Contar ingresso era furável: quem está em checkout ainda não tem ingresso,
      // então um segundo comprador via a cota livre e os dois passavam.
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

  /**
   * Desistiu no checkout: devolve os lugares agora, em vez de deixá-los parecendo
   * ocupados até a varredura de 10 minutos. Só o dono cancela, e só enquanto o
   * pagamento está pendente — reserva paga é ingresso emitido, e sai por estorno.
   */
  async cancelReservation(userId: string, reservationId: string): Promise<{ released: number }> {
    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId, userId },
      relations: ['seats'],
    });

    if (!reservation) {
      // Anti-enumeração: reserva de outra pessoa é "não encontrada"
      throw new AppError('Reservation not found', ErrorCodes.NOT_FOUND, 404);
    }

    // Já liberada por expiração ou cancelamento anterior — sucesso idempotente
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
      // Só devolve o que ainda está reservado: nunca rouba assento vendido
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

  async getMyReservations(userId: string): Promise<ReservationResponseDto[]> {
    const reservations = await this.reservationRepo.find({
      where: { userId },
      relations: ['seats'],
      order: { createdAt: 'DESC' },
    });
    return reservations.map((r) => ReservationResponseDto.fromEntity(r));
  }

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
