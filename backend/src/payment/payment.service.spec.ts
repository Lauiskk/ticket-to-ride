import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { Reservation, ReservationStatus } from '../reservation/entities/reservation.entity';
import { Seat } from '../event/entities/seat.entity';
import { TicketService } from '../ticket/ticket.service';
import { ReservationGateway } from '../reservation/reservation.gateway';
import { AppError } from '../shared/errors';

/**
 * Tests for SPEC_CP10 — compra ponta a ponta.
 * docs/plan/SPEC_CP10_compra_ponta_a_ponta.md
 *
 * Cada `it()` cita o AC que cobre. Escritos ANTES da implementação.
 */

describe('PaymentService (SPEC_CP10)', () => {
  let service: PaymentService;
  let paymentRepo: jest.Mocked<Repository<Payment>>;
  let reservationRepo: jest.Mocked<Repository<Reservation>>;
  let seatRepo: jest.Mocked<Repository<Seat>>;
  let configService: jest.Mocked<ConfigService>;
  let ticketService: jest.Mocked<TicketService>;
  let gateway: jest.Mocked<ReservationGateway>;

  // Not a credential — only the `sk_test_` prefix matters to hasRealStripeKey().
  // Kept deliberately unlike a real key so secret scanners don't flag the repo.
  const REAL_TEST_KEY = 'sk_test_placeholder-not-a-real-key';

  /** Captura o `.set({...})` do queryBuilder de assentos. */
  let seatUpdateSpy: jest.Mock;

  const makeSeatQueryBuilder = () => {
    seatUpdateSpy = jest.fn();
    const qb: any = {
      update: jest.fn(() => qb),
      set: jest.fn((values: unknown) => {
        seatUpdateSpy(values);
        return qb;
      }),
      where: jest.fn(() => qb),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    return qb;
  };

  beforeEach(() => {
    paymentRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => v as Payment),
      save: jest.fn(async (v) => v as Payment),
    } as unknown as jest.Mocked<Repository<Payment>>;

    reservationRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Repository<Reservation>>;

    seatRepo = {
      createQueryBuilder: jest.fn(() => makeSeatQueryBuilder()),
    } as unknown as jest.Mocked<Repository<Seat>>;

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'stripe.secretKey') return REAL_TEST_KEY;
        if (key === 'stripe.webhookSecret') return 'whsec_example';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    ticketService = {
      generateForReservation: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
      countForReservation: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<TicketService>;

    gateway = {
      broadcastSeatUpdate: jest.fn(),
      broadcastSeatsReleased: jest.fn(),
      broadcastSeatsReserved: jest.fn(),
    } as unknown as jest.Mocked<ReservationGateway>;

    service = new PaymentService(
      paymentRepo,
      reservationRepo,
      seatRepo,
      configService,
      ticketService,
      gateway,
    );
  });

  // ─── AC-3 ───────────────────────────────────────────────────────────────────

  describe('AC-3: webhook de sucesso é a fonte de verdade', () => {
    it('marca reserva como paid, assentos como sold e gera 1 ingresso por assento', async () => {
      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        reservationId: 'res-1',
        status: PaymentStatus.PENDING,
      } as Payment);

      reservationRepo.findOne.mockResolvedValue({
        id: 'res-1',
        seats: [{ id: 'seat-1' }, { id: 'seat-2' }],
      } as Reservation);

      await service.handlePaymentSuccess('pi_123');

      expect(reservationRepo.update).toHaveBeenCalledWith('res-1', {
        status: ReservationStatus.PAID,
      });
      expect(seatUpdateSpy).toHaveBeenCalledWith({ status: 'sold' });
      expect(ticketService.generateForReservation).toHaveBeenCalledWith('res-1');
    });
  });

  // ─── AC-4 ───────────────────────────────────────────────────────────────────

  describe('AC-4: idempotência do webhook', () => {
    it('não regenera ingressos quando o pagamento já está succeeded', async () => {
      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        reservationId: 'res-1',
        status: PaymentStatus.SUCCEEDED,
      } as Payment);

      await service.handlePaymentSuccess('pi_123');

      expect(reservationRepo.update).not.toHaveBeenCalled();
      expect(ticketService.generateForReservation).not.toHaveBeenCalled();
    });
  });

  // ─── AC-5 ───────────────────────────────────────────────────────────────────

  describe('AC-5: recusa devolve os assentos', () => {
    it('marca reserva como payment_failed e assentos voltam a available', async () => {
      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        reservationId: 'res-1',
        status: PaymentStatus.PENDING,
      } as Payment);

      reservationRepo.findOne.mockResolvedValue({
        id: 'res-1',
        seats: [{ id: 'seat-1' }],
      } as Reservation);

      await service.handlePaymentFailure('pi_123');

      expect(reservationRepo.update).toHaveBeenCalledWith('res-1', {
        status: ReservationStatus.PAYMENT_FAILED,
      });
      expect(seatUpdateSpy).toHaveBeenCalledWith({ status: 'available' });
      expect(ticketService.generateForReservation).not.toHaveBeenCalled();
    });
  });

  // ─── AC-6 ───────────────────────────────────────────────────────────────────

  describe('AC-6: ticketCount real na reconfirmação idempotente', () => {
    it('retorna a contagem real de ingressos, não zero', async () => {
      // Sem chave real → modo simulado, /confirm segue habilitado
      configService.get.mockImplementation((key: string) => {
        if (key === 'stripe.secretKey') return '';
        return undefined;
      });

      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        reservationId: 'res-1',
        userId: 'user-1',
        status: PaymentStatus.SUCCEEDED,
      } as Payment);

      ticketService.countForReservation.mockResolvedValue(3);

      const result = await service.confirmTestPayment('user-1', 'res-1');

      expect(result).toEqual({ success: true, ticketCount: 3 });
      expect(ticketService.countForReservation).toHaveBeenCalledWith('res-1');
    });
  });

  // ─── RF-5 ───────────────────────────────────────────────────────────────────

  describe('RF-5: /confirm desabilitado quando há chave Stripe real', () => {
    it('rejeita a confirmação manual com 400 quando a chave é sk_test_', async () => {
      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        reservationId: 'res-1',
        userId: 'user-1',
        status: PaymentStatus.PENDING,
      } as Payment);

      await expect(service.confirmTestPayment('user-1', 'res-1')).rejects.toThrow(AppError);

      expect(reservationRepo.update).not.toHaveBeenCalled();
      expect(ticketService.generateForReservation).not.toHaveBeenCalled();
    });
  });

  // ─── AC-E2 ──────────────────────────────────────────────────────────────────

  describe('AC-E2: assinatura de webhook inválida', () => {
    it('retorna null sem efeito colateral', () => {
      const result = service.verifyWebhookSignature(
        Buffer.from('{"id":"evt_1"}'),
        'assinatura-invalida',
      );

      expect(result).toBeNull();
      expect(reservationRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── SPEC_CP15 B13 ──────────────────────────────────────────────────────────

  describe('B13: pagamento pago sem ingresso é reparado', () => {
    beforeEach(() => {
      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        reservationId: 'res-1',
        userId: 'user-1',
        status: PaymentStatus.SUCCEEDED,
        stripePaymentIntentId: 'pi_1',
      } as Payment);
    });

    it('reemite quando o pagamento fechou mas nenhum ingresso existe', async () => {
      // Zero antes, dois depois da reemissão
      ticketService.countForReservation
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2);

      const result = await service.getPaymentStatus('user-1', 'res-1');

      expect(ticketService.generateForReservation).toHaveBeenCalledWith('res-1');
      expect(result.ticketCount).toBe(2);
      expect(result.ticketsPending).toBe(false);
    });

    it('não reemite quando o ingresso já existe', async () => {
      ticketService.countForReservation.mockResolvedValue(1);

      const result = await service.getPaymentStatus('user-1', 'res-1');

      expect(ticketService.generateForReservation).not.toHaveBeenCalled();
      expect(result.ticketCount).toBe(1);
      expect(result.ticketsPending).toBe(false);
    });

    it('sinaliza ticketsPending quando a reemissão também falha', async () => {
      ticketService.countForReservation.mockResolvedValue(0);
      ticketService.generateForReservation.mockRejectedValue(new Error('qr indisponível'));

      const result = await service.getPaymentStatus('user-1', 'res-1');

      // A falha não derruba a resposta — o cliente é informado, não abandonado
      expect(result.status).toBe(PaymentStatus.SUCCEEDED);
      expect(result.ticketsPending).toBe(true);
    });

    it('pagamento ainda pendente não dispara reemissão', async () => {
      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1', reservationId: 'res-1', userId: 'user-1',
        status: PaymentStatus.PENDING, stripePaymentIntentId: 'pi_1',
      } as Payment);
      configService.get.mockImplementation(() => '');
      ticketService.countForReservation.mockResolvedValue(0);

      const result = await service.getPaymentStatus('user-1', 'res-1');

      expect(ticketService.generateForReservation).not.toHaveBeenCalled();
      expect(result.ticketsPending).toBe(false);
    });
  });
});
