import { Repository } from 'typeorm';
import { EventService } from './event.service';
import { Event, EventStatus } from './entities/event.entity';
import { Seat, SeatStatus } from './entities/seat.entity';
import { PaymentService } from '../payment/payment.service';
import { ReservationGateway } from '../reservation/reservation.gateway';

/**
 * Cancelar devolve ao estoque (SPEC_CP23).
 *
 * Antes disto, cancelar era trocar uma palavra no banco: assentos seguiam
 * vendidos, ingressos seguiam válidos — e seguiam abrindo a portaria, porque a
 * validação olha a janela de entrada, não o status do evento — e o dinheiro
 * seguia conosco.
 */

const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const ORGANIZER = 'org-1';

function makeService({
  event,
  refundResult = 'refunded',
}: {
  event?: Partial<Event> | null;
  refundResult?: 'refunded' | 'no_payment' | 'failed';
}) {
  const eventRepo = {
    findOne: jest.fn().mockResolvedValue(event ?? null),
    save: jest.fn(async (e) => e),
  } as unknown as jest.Mocked<Repository<Event>>;

  const releasedSeats = ['seat-a', 'seat-b'];

  const manager = {
    update: jest.fn().mockResolvedValue({ affected: 2 }),
    find: jest.fn().mockResolvedValue(releasedSeats.map((id) => ({ id }))),
    save: jest.fn(async (_e: unknown, x: unknown) => x),
  };

  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager,
  };

  const seatRepo = {
    manager: {
      connection: { createQueryRunner: jest.fn(() => queryRunner) },
      find: jest.fn().mockResolvedValue([]),
    },
    createQueryBuilder: jest.fn(),
  } as unknown as jest.Mocked<Repository<Seat>>;

  const payments = {
    refundReservationsForEvent: jest.fn().mockResolvedValue({
      refunded: refundResult === 'refunded' ? 1 : 0,
      failed: refundResult === 'failed' ? 1 : 0,
      cancelled: 1,
    }),
  } as unknown as jest.Mocked<PaymentService>;

  const gateway = {
    broadcastSeatsReleased: jest.fn(),
  } as unknown as jest.Mocked<ReservationGateway>;

  const service = new EventService(eventRepo, seatRepo, payments, gateway);

  return { service, eventRepo, seatRepo, payments, gateway, queryRunner, manager };
}

const publishedEvent = (over: Partial<Event> = {}): Partial<Event> => ({
  id: EVENT_ID,
  organizerId: ORGANIZER,
  title: 'Evento com venda',
  status: EventStatus.PUBLISHED,
  currency: 'BRL',
  ...over,
});

describe('EventService.cancel (SPEC_CP23)', () => {
  it('AC-1: assentos vendidos e reservados voltam para available', async () => {
    const { service, manager } = makeService({ event: publishedEvent() });

    await service.cancel(EVENT_ID, ORGANIZER);

    const chamadaDeAssento = manager.update.mock.calls.find(
      ([entidade]) => entidade === Seat || (entidade as any)?.name === 'Seat',
    );
    expect(chamadaDeAssento).toBeDefined();
    expect(chamadaDeAssento?.[2]).toMatchObject({ status: SeatStatus.AVAILABLE });
  });

  it('AC-2 e AC-3: ingressos invalidados e reservas estornadas', async () => {
    const { service, payments, manager } = makeService({ event: publishedEvent() });

    await service.cancel(EVENT_ID, ORGANIZER);

    // Ingresso ativo não pode continuar abrindo portão
    const chamadas = manager.update.mock.calls.map(([e]) => (e as any)?.name ?? e);
    expect(chamadas).toContain('Ticket');

    expect(payments.refundReservationsForEvent).toHaveBeenCalledWith(EVENT_ID);
  });

  it('AC-5: cancelar de novo não estorna outra vez', async () => {
    const { service, payments } = makeService({
      event: publishedEvent({ status: EventStatus.CANCELLED }),
    });

    const result = await service.cancel(EVENT_ID, ORGANIZER);

    expect(result.status).toBe(EventStatus.CANCELLED);
    expect(payments.refundReservationsForEvent).not.toHaveBeenCalled();
  });

  it('AC-6: falha no estorno não desfaz o cancelamento', async () => {
    const { service, payments, queryRunner } = makeService({ event: publishedEvent() });
    (payments.refundReservationsForEvent as jest.Mock).mockRejectedValue(
      new Error('Stripe fora do ar'),
    );

    const result = await service.cancel(EVENT_ID, ORGANIZER);

    // O cancelamento é a decisão do organizador: vale mesmo que o dinheiro
    // demore a voltar. O que não pode é desfazer e deixar o evento à venda.
    expect(result.status).toBe(EventStatus.CANCELLED);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('RF-5: quem está com o mapa aberto vê os lugares voltarem', async () => {
    const { service, gateway } = makeService({ event: publishedEvent() });

    await service.cancel(EVENT_ID, ORGANIZER);

    expect(gateway.broadcastSeatsReleased).toHaveBeenCalledWith(EVENT_ID, ['seat-a', 'seat-b']);
  });

  it('AC-9: evento de outro organizador continua respondendo 404', async () => {
    const { service, payments } = makeService({
      event: publishedEvent({ organizerId: 'outro-organizador' }),
    });

    await expect(service.cancel(EVENT_ID, ORGANIZER)).rejects.toMatchObject({ statusCode: 404 });
    expect(payments.refundReservationsForEvent).not.toHaveBeenCalled();
  });
});
