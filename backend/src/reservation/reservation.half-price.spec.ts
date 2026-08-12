import { ReservationService } from './reservation.service';
import { HalfPriceCategory } from './dto/create-reservation.dto';
import { SeatStatus } from '../event/entities/seat.entity';
import { EventStatus } from '../event/entities/event.entity';

/**
 * Tests for SPEC_CP12 — meia-entrada.
 * docs/plan/SPEC_CP12_organizador_meia_entrada.md
 *
 * Exercises the pricing and quota rules through reserveSeats, with the
 * QueryRunner faked so the arithmetic is tested without a database.
 */

const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const SEAT_A = '44444444-4444-4444-8444-444444444444';
const SEAT_B = '55555555-5555-4555-8555-555555555555';
const USER = 'user-1';

describe('ReservationService — meia-entrada (SPEC_CP12)', () => {
  let service: ReservationService;
  let savedReservation: any;
  /** Half-price seats already claimed by pending-or-paid reservations. */
  let halfPriceTaken: number;
  let eventOverrides: Record<string, unknown>;

  const buildEvent = () => ({
    id: EVENT_ID,
    status: EventStatus.PUBLISHED,
    price: 100,
    currency: 'BRL',
    halfPriceEnabled: true,
    halfPriceQuota: null,
    ...eventOverrides,
  });

  const availableSeats = (ids: string[]) =>
    ids.map((id) => ({ id, status: SeatStatus.AVAILABLE, eventId: EVENT_ID }));

  beforeEach(() => {
    savedReservation = null;
    halfPriceTaken = 0;
    eventOverrides = {};

    const seatQb: any = {
      setLock: jest.fn(() => seatQb),
      where: jest.fn(() => seatQb),
      andWhere: jest.fn(() => seatQb),
      getMany: jest.fn(async () => availableSeats([SEAT_A, SEAT_B])),
      update: jest.fn(() => seatQb),
      set: jest.fn(() => seatQb),
      execute: jest.fn(async () => ({ affected: 2 })),
    };

    const manager: any = {
      findOne: jest.fn(async () => buildEvent()),
      createQueryBuilder: jest.fn(() => seatQb),
      create: jest.fn((_entity: unknown, data: any) => data),
      save: jest.fn(async (_entity: unknown, data: any) => {
        savedReservation = { id: 'res-1', ...data };
        return savedReservation;
      }),
      // The quota query counts claims on pending/paid reservations
      query: jest.fn(async () => [{ taken: halfPriceTaken }]),
    };

    const queryRunner: any = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn(),
      manager,
    };

    service = new ReservationService(
      { find: jest.fn(), findOne: jest.fn(), save: jest.fn() } as any,
      { createQueryBuilder: jest.fn(() => seatQb), find: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      { createQueryRunner: () => queryRunner } as any,
      { get: jest.fn().mockReturnValue(10) } as any,
      { broadcastSeatsReserved: jest.fn(), broadcastSeatsReleased: jest.fn() } as any,
    );
  });

  const reserve = (claims?: Array<{ seatId: string; category: HalfPriceCategory; document: string }>) =>
    service.reserveSeats(USER, {
      eventId: EVENT_ID,
      seatIds: [SEAT_A, SEAT_B],
      halfPriceClaims: claims,
    });

  // ─── AC-1 / AC-2 ────────────────────────────────────────────────────────────

  it('AC-1: 1 inteira + 1 meia num evento de R$100 totaliza R$150', async () => {
    await reserve([
      { seatId: SEAT_A, category: HalfPriceCategory.STUDENT, document: '2024001234' },
    ]);

    expect(Number(savedReservation.totalAmount)).toBe(150);
  });

  it('AC-2: preço vem sempre do evento, nunca do cliente', async () => {
    // O DTO não tem campo de preço; ainda assim, forçamos um no payload
    await service.reserveSeats(USER, {
      eventId: EVENT_ID,
      seatIds: [SEAT_A, SEAT_B],
      price: 1,
      totalAmount: 1,
    } as any);

    expect(Number(savedReservation.totalAmount)).toBe(200);
  });

  it('AC-E3: todos os assentos como meia totalizam 50% de cada', async () => {
    await reserve([
      { seatId: SEAT_A, category: HalfPriceCategory.STUDENT, document: '2024001234' },
      { seatId: SEAT_B, category: HalfPriceCategory.SENIOR, document: '9988776655' },
    ]);

    expect(Number(savedReservation.totalAmount)).toBe(100);
  });

  it('grava as declarações indexadas por assento para a emissão do ingresso', async () => {
    await reserve([
      { seatId: SEAT_A, category: HalfPriceCategory.PCD, document: 'BEN-778899' },
    ]);

    expect(savedReservation.halfPriceClaims).toEqual({
      [SEAT_A]: { category: 'pcd', document: 'BEN-778899' },
    });
  });

  // ─── AC-3 ───────────────────────────────────────────────────────────────────

  it('AC-3: estourar a cota recusa a reserva inteira', async () => {
    eventOverrides = { halfPriceQuota: 2 };
    halfPriceTaken = 2; // cota já esgotada por reservas ativas

    await expect(
      reserve([{ seatId: SEAT_A, category: HalfPriceCategory.STUDENT, document: '2024001234' }]),
    ).rejects.toMatchObject({ code: 'HALF_PRICE_QUOTA_EXCEEDED' });

    expect(savedReservation).toBeNull();
  });

  it('AC-E4: cota nula significa sem limite', async () => {
    eventOverrides = { halfPriceQuota: null };
    halfPriceTaken = 999;

    await reserve([
      { seatId: SEAT_A, category: HalfPriceCategory.STUDENT, document: '2024001234' },
    ]);

    expect(Number(savedReservation.totalAmount)).toBe(150);
  });

  // ─── AC-4 ───────────────────────────────────────────────────────────────────

  it('AC-4: evento com meia desabilitada recusa a declaração', async () => {
    eventOverrides = { halfPriceEnabled: false };

    await expect(
      reserve([{ seatId: SEAT_A, category: HalfPriceCategory.STUDENT, document: '2024001234' }]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(savedReservation).toBeNull();
  });

  // ─── AC-E1 ──────────────────────────────────────────────────────────────────

  it('AC-E1: declaração para assento fora da reserva é recusada', async () => {
    await expect(
      reserve([
        {
          seatId: '99999999-9999-4999-8999-999999999999',
          category: HalfPriceCategory.STUDENT,
          document: '2024001234',
        },
      ]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(savedReservation).toBeNull();
  });
});
