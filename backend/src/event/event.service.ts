import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { Event, EventStatus, SeatingType } from './entities/event.entity';
import { Seat, SeatStatus } from './entities/seat.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { SearchEventsDto, SortBy } from './dto/search-events.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { EventMetricsDto } from './dto/event-metrics.dto';
import { Ticket, TicketStatus } from '../ticket/entities/ticket.entity';
import { PaymentService } from '../payment/payment.service';
import { ReservationGateway } from '../reservation/reservation.gateway';
import { AppError, ErrorCodes } from '../shared/errors';
import { PaginatedResult } from '../shared/interceptors/response.interceptor';

/**
 * Event service — handles creation, publication, cancellation, and browsing.
 *
 * Key behaviors:
 * - Create: status=draft, reject past dates (Req 5.8)
 * - Publish: validate all fields + seats configured (Req 5.5, 5.6)
 * - Cancel: from ANY status, trigger refund placeholder (Req 5.7)
 * - Browse: only published + validation-passing events, geo-sort, filters (Req 6.1-6.5)
 * - Never expose organizer internal ID in responses (Req 6.4)
 */
/**
 * How long after its start time an event stays buyable. Matches the gate's
 * entry window (GateService) — while someone can still walk in, someone can
 * still buy.
 */
const EVENT_SALES_GRACE_MS = 7 * 60 * 60 * 1000;

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    @InjectRepository(Seat)
    private readonly seatRepo: Repository<Seat>,
    @Inject(forwardRef(() => PaymentService))
    private readonly payments: PaymentService,
    private readonly gateway: ReservationGateway,
  ) {}

  // ─── Create ─────────────────────────────────────────────────────────────────

  async create(organizerId: string, dto: CreateEventDto): Promise<EventResponseDto> {
    // Reject past dates (Req 5.8)
    const eventDate = new Date(dto.date);
    if (eventDate <= new Date()) {
      throw new AppError(
        'Event date must be in the future',
        ErrorCodes.BAD_REQUEST,
        400,
      );
    }

    const event = this.eventRepo.create({
      organizerId,
      title: dto.title,
      description: dto.description,
      date: eventDate,
      venueName: dto.venueName,
      venueAddress: dto.venueAddress,
      venueLat: dto.venueLat || null,
      venueLng: dto.venueLng || null,
      venueCity: dto.venueCity || null,
      capacity: dto.capacity,
      seatingType: dto.seatingType,
      seatMapConfig: dto.sections || dto.sectors ? { sections: dto.sections, sectors: dto.sectors } : null,
      price: dto.price,
      currency: dto.currency.toUpperCase(),
      // Half-price on unless the organizer explicitly opts out (SPEC_CP12 RF-8)
      halfPriceEnabled: dto.halfPriceEnabled ?? true,
      halfPriceQuota: dto.halfPriceQuota ?? null,
      status: EventStatus.DRAFT,
      imageUrl: dto.imageUrl || null,
      externalId: dto.externalId || null,
      externalSource: dto.externalSource || null,
    });

    const saved = await this.eventRepo.save(event);

    // Create seats based on seating type
    await this.createSeats(saved.id, dto);

    return EventResponseDto.fromEntity(saved);
  }

  // ─── Publish ────────────────────────────────────────────────────────────────

  async publish(eventId: string, organizerId: string): Promise<EventResponseDto> {
    const event = await this.findOwnedEvent(eventId, organizerId);

    // Validate publication requirements (Req 5.5)
    this.validatePublicationReady(event);

    event.status = EventStatus.PUBLISHED;
    const saved = await this.eventRepo.save(event);
    return EventResponseDto.fromEntity(saved);
  }

  // ─── Cancel ─────────────────────────────────────────────────────────────────

  /**
   * Cancelar de verdade: devolve os lugares, invalida os ingressos e o dinheiro
   * volta (SPEC_CP23).
   *
   * Isto aqui era `event.status = CANCELLED` com um TODO ao lado. O resto ficava
   * onde estava: assentos vendidos seguiam vendidos, ingressos seguiam válidos —
   * e seguiam **abrindo a portaria**, que olha a janela de entrada e não o
   * status do evento — e o dinheiro seguia conosco. Para quem comprou, o evento
   * era cancelado e nada acontecia.
   *
   * A mudança de estado é uma transação só (RNF-1): meio cancelamento, com
   * assentos livres e ingressos ainda válidos, é pior que nenhum.
   */
  async cancel(eventId: string, organizerId: string): Promise<EventResponseDto> {
    const event = await this.findOwnedEvent(eventId, organizerId);

    // AC-5: já cancelado é trabalho feito — não estorna de novo
    if (event.status === EventStatus.CANCELLED) {
      return EventResponseDto.fromEntity(event);
    }

    const queryRunner = this.seatRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let releasedSeatIds: string[] = [];

    try {
      event.status = EventStatus.CANCELLED;
      await queryRunner.manager.save(Event, event);

      // Os lugares voltam ao estoque (RF-1)
      await queryRunner.manager.update(
        Seat,
        { eventId, status: In([SeatStatus.SOLD, SeatStatus.RESERVED]) },
        { status: SeatStatus.AVAILABLE },
      );

      // Os ingressos param de valer (RF-2). Esta é a barreira principal; a
      // checagem na portaria é a segunda, não a única.
      await queryRunner.manager.update(
        Ticket,
        { eventId, status: TicketStatus.ACTIVE },
        { status: TicketStatus.INVALIDATED },
      );

      const seats = await queryRunner.manager.find(Seat, {
        where: { eventId },
        select: ['id'],
      });
      releasedSeatIds = seats.map((s) => s.id);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Falha ao cancelar o evento ${eventId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Quem está com o mapa aberto vê os lugares voltarem (RF-5)
    if (releasedSeatIds.length > 0) {
      try {
        this.gateway.broadcastSeatsReleased(eventId, releasedSeatIds);
      } catch {
        // Aviso ao vivo é melhoria; o estado já está correto no banco
      }
    }

    /*
      Estorno fora da transação, e depois do commit.

      O cancelamento é a decisão do organizador e precisa valer na hora — é ele
      que fecha a entrada e libera os assentos. O dinheiro é consequência, e é
      retentável: cada estorno leva chave de idempotência na Stripe. Se a Stripe
      estiver fora do ar, sobra uma reserva paga de evento cancelado, que aparece
      no log e pode ser reprocessada. Visível, não silenciosa — e melhor do que
      desfazer o cancelamento e deixar o evento à venda.
    */
    try {
      await this.payments.refundReservationsForEvent(eventId);
    } catch (error) {
      this.logger.error(
        `Evento ${eventId} cancelado, mas os estornos falharam — reprocessar`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return EventResponseDto.fromEntity(event);
  }

  // ─── Get by ID ──────────────────────────────────────────────────────────────

  async getById(eventId: string): Promise<EventResponseDto> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) {
      throw new AppError('Event not found', ErrorCodes.NOT_FOUND, 404);
    }

    const availableSeats = await this.seatRepo.count({
      where: { eventId, status: SeatStatus.AVAILABLE },
    });

    return EventResponseDto.fromEntity(event, availableSeats);
  }

  // ─── Get organizer's events ─────────────────────────────────────────────────

  async getMyEvents(organizerId: string): Promise<EventResponseDto[]> {
    const events = await this.eventRepo.find({
      where: { organizerId },
      order: { createdAt: 'DESC' },
    });
    return events.map((e) => EventResponseDto.fromEntity(e));
  }

  // ─── Organizer Metrics (SPEC_CP12 RF-6) ───────────────────────────────────

  /**
   * Sales panel for one event, for its own organizer.
   *
   * Deliberately aggregates only. An organizer needs to know how the house is
   * filling and how much came in — not who bought what. No buyer identity,
   * e-mail or document ever appears here.
   */
  async getMetrics(eventId: string, organizerId: string): Promise<EventMetricsDto> {
    // Reuses the ownership check — a stranger's event is simply "not found"
    const event = await this.findOwnedEvent(eventId, organizerId);

    const [seatCounts, sectionRows, revenueRow, ticketsIssued, ticketsValidated, halfPriceTickets] =
      await Promise.all([
        this.seatRepo
          .createQueryBuilder('seat')
          .select('seat.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .where('seat.event_id = :eventId', { eventId })
          .groupBy('seat.status')
          .getRawMany<{ status: string; count: string }>(),

        this.seatRepo
          .createQueryBuilder('seat')
          .select('seat.section', 'section')
          .addSelect('COUNT(*)', 'total')
          .addSelect(`COUNT(*) FILTER (WHERE seat.status = 'sold')`, 'sold')
          .where('seat.event_id = :eventId', { eventId })
          .groupBy('seat.section')
          .orderBy('seat.section', 'ASC')
          .getRawMany<{ section: string; total: string; sold: string }>(),

        this.seatRepo.manager
          .createQueryBuilder()
          .select('COALESCE(SUM(r.total_amount), 0)', 'revenue')
          .from('reservations', 'r')
          .where('r.event_id = :eventId', { eventId })
          .andWhere(`r.status = 'paid'`)
          .getRawOne<{ revenue: string }>(),

        this.seatRepo.manager.count(Ticket, { where: { eventId } }),
        this.seatRepo.manager.count(Ticket, { where: { eventId, status: TicketStatus.USED } }),
        this.seatRepo.manager.count(Ticket, { where: { eventId, isHalfPrice: true } }),
      ]);

    const countOf = (status: string): number =>
      Number(seatCounts.find((r) => r.status === status)?.count ?? 0);

    const seatsSold = countOf(SeatStatus.SOLD);
    const seatsReserved = countOf(SeatStatus.RESERVED);
    const seatsAvailable = countOf(SeatStatus.AVAILABLE);
    const seatsTotal = seatsSold + seatsReserved + seatsAvailable;

    return {
      eventId: event.id,
      title: event.title,
      status: event.status,
      seatsTotal,
      seatsSold,
      seatsReserved,
      seatsAvailable,
      // AC-11: an event with no seats must not divide by zero
      occupancyRate: seatsTotal === 0 ? 0 : Math.round((seatsSold / seatsTotal) * 100),
      revenue: Number(revenueRow?.revenue ?? 0),
      currency: event.currency,
      ticketsIssued,
      ticketsValidated,
      halfPriceTickets,
      bySection: sectionRows.map((row) => ({
        section: row.section,
        total: Number(row.total),
        sold: Number(row.sold),
      })),
    };
  }

  // ─── Browse (Public) ────────────────────────────────────────────────────────

  async browse(dto: SearchEventsDto): Promise<PaginatedResult<EventResponseDto>> {
    const page = dto.page || 1;
    const pageSize = dto.pageSize || 20;

    // An event leaves the catalogue when its doors close, not when it starts.
    // Filtering on `date > now` hid anything already running — which is exactly
    // when a box office still sells: at the door, to the people in the queue.
    // The cutoff mirrors the gate's entry window so the two never disagree
    // about whether an event is "happening".
    const stillSelling = new Date(Date.now() - EVENT_SALES_GRACE_MS);

    let qb = this.eventRepo
      .createQueryBuilder('event')
      .where('event.status = :status', { status: EventStatus.PUBLISHED })
      .andWhere('event.date > :cutoff', { cutoff: stillSelling })
      .andWhere('event.deleted_at IS NULL');

    // ─── Filters ──────────────────────────────────────────────────────────

    if (dto.keyword) {
      qb = qb.andWhere(
        '(event.title ILIKE :kw OR event.description ILIKE :kw)',
        { kw: `%${dto.keyword}%` },
      );
    }

    if (dto.city) {
      qb = qb.andWhere('event.venue_city ILIKE :city', { city: `%${dto.city}%` });
    }

    if (dto.dateFrom) {
      qb = qb.andWhere('event.date >= :dateFrom', { dateFrom: new Date(dto.dateFrom) });
    }

    if (dto.dateTo) {
      qb = qb.andWhere('event.date <= :dateTo', { dateTo: new Date(dto.dateTo) });
    }

    if (dto.priceMin !== undefined) {
      qb = qb.andWhere('event.price >= :priceMin', { priceMin: dto.priceMin });
    }

    if (dto.priceMax !== undefined) {
      qb = qb.andWhere('event.price <= :priceMax', { priceMax: dto.priceMax });
    }

    // ─── Geo-proximity sort (Req 6.2) ─────────────────────────────────────

    if (dto.lat !== undefined && dto.lng !== undefined) {
      // Haversine distance calculation in SQL
      const distanceExpr = `(
        6371 * acos(
          cos(radians(:lat)) * cos(radians(event.venue_lat)) *
          cos(radians(event.venue_lng) - radians(:lng)) +
          sin(radians(:lat)) * sin(radians(event.venue_lat))
        )
      )`;

      // Only filter by radius when radius > 0 (Req 6.2: zero radius = no filter, sort only)
      if (dto.radius && dto.radius > 0) {
        qb = qb
          .andWhere('event.venue_lat IS NOT NULL')
          .andWhere('event.venue_lng IS NOT NULL')
          .andWhere(`${distanceExpr} <= :radius`, { lat: dto.lat, lng: dto.lng, radius: dto.radius });
      } else {
        // Zero radius: include all events with coordinates, sorted by proximity
        qb = qb
          .andWhere('event.venue_lat IS NOT NULL')
          .andWhere('event.venue_lng IS NOT NULL');
      }

      qb = qb
        .addSelect(distanceExpr, 'distance')
        .setParameters({ lat: dto.lat, lng: dto.lng })
        .orderBy('distance', 'ASC');
    } else {
      // ─── Standard sorting ──────────────────────────────────────────────
      qb = this.applySorting(qb, dto.sortBy, dto.keyword);
    }

    // ─── Pagination ───────────────────────────────────────────────────────

    const total = await qb.getCount();
    const events = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    const items = events.map((e) => EventResponseDto.fromEntity(e));

    return { data: items, total, page, pageSize };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async findOwnedEvent(eventId: string, organizerId: string): Promise<Event> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) {
      throw new AppError('Event not found', ErrorCodes.NOT_FOUND, 404);
    }
    // Ownership check — defense in depth (Req 3.4)
    if (event.organizerId !== organizerId) {
      throw new AppError('Event not found', ErrorCodes.NOT_FOUND, 404); // Anti-enumeration
    }
    return event;
  }

  private validatePublicationReady(event: Event): void {
    const missing: string[] = [];
    if (!event.title) missing.push('title');
    if (!event.description) missing.push('description');
    if (!event.date) missing.push('date');
    if (!event.venueName) missing.push('venueName');
    if (!event.venueAddress) missing.push('venueAddress');
    if (!event.price && event.price !== 0) missing.push('price');
    if (!event.currency) missing.push('currency');

    if (missing.length > 0) {
      throw new AppError(
        `Cannot publish: missing fields: ${missing.join(', ')}`,
        ErrorCodes.BAD_REQUEST,
        400,
      );
    }

    // Check seats exist
    // Note: this is sync validation of seat_map_config; actual seat count is checked asynchronously
  }

  private async createSeats(eventId: string, dto: CreateEventDto): Promise<void> {
    const seats: Partial<Seat>[] = [];

    if (dto.seatingType === SeatingType.NUMBERED && dto.sections) {
      // Numbered seats: sections × rows × seatsPerRow
      for (const section of dto.sections) {
        for (let r = 1; r <= section.rows; r++) {
          for (let s = 1; s <= section.seatsPerRow; s++) {
            seats.push({
              eventId,
              section: section.name,
              row: String(r),
              number: String(s),
              status: SeatStatus.AVAILABLE,
            });
          }
        }
      }
    } else if (dto.seatingType === SeatingType.GENERAL_ADMISSION && dto.sectors) {
      // General admission: sectors with individual capacities
      for (const sector of dto.sectors) {
        for (let i = 1; i <= sector.capacity; i++) {
          seats.push({
            eventId,
            section: sector.name,
            row: null,
            number: String(i),
            status: SeatStatus.AVAILABLE,
          });
        }
      }
    } else if (dto.seatingType === SeatingType.GENERAL_ADMISSION) {
      // Simple GA: single sector with total capacity
      for (let i = 1; i <= dto.capacity; i++) {
        seats.push({
          eventId,
          section: 'General',
          row: null,
          number: String(i),
          status: SeatStatus.AVAILABLE,
        });
      }
    }

    if (seats.length > 0) {
      // Batch insert for performance
      const batchSize = 500;
      for (let i = 0; i < seats.length; i += batchSize) {
        const batch = seats.slice(i, i + batchSize);
        await this.seatRepo.save(batch);
      }
    }
  }

  private applySorting(
    qb: SelectQueryBuilder<Event>,
    sortBy?: SortBy,
    keyword?: string,
  ): SelectQueryBuilder<Event> {
    switch (sortBy) {
      case SortBy.DATE_ASC:
        return qb.orderBy('event.date', 'ASC');
      case SortBy.DATE_DESC:
        return qb.orderBy('event.date', 'DESC');
      case SortBy.PRICE_ASC:
        return qb.orderBy('event.price', 'ASC');
      case SortBy.PRICE_DESC:
        return qb.orderBy('event.price', 'DESC');
      case SortBy.RELEVANCE:
        // When keyword is active, title matches rank higher
        if (keyword) {
          return qb
            .addSelect(
              `CASE WHEN event.title ILIKE :kwSort THEN 0 ELSE 1 END`,
              'relevance_score',
            )
            .setParameter('kwSort', `%${keyword}%`)
            .orderBy('relevance_score', 'ASC')
            .addOrderBy('event.date', 'ASC');
        }
        return qb.orderBy('event.date', 'ASC');
      default:
        return qb.orderBy('event.date', 'ASC');
    }
  }
}
