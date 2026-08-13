import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Stripe = require('stripe');
import { Payment, PaymentStatus } from './entities/payment.entity';
import { Reservation, ReservationStatus } from '../reservation/entities/reservation.entity';
import { Seat, SeatStatus } from '../event/entities/seat.entity';
import { AppError, ErrorCodes } from '../shared/errors';
import { TicketService } from '../ticket/ticket.service';
import { ReservationGateway } from '../reservation/reservation.gateway';

/**
 * Cobrança na Stripe em modo de teste.
 *
 * A confirmação nunca vem do navegador: quem move a reserva para `paid` é o
 * webhook ou a reconciliação contra a própria Stripe. Sem chave configurada, o
 * serviço entra em modo simulado e fecha o fluxo sem rede.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly stripe: any;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    @InjectRepository(Seat)
    private readonly seatRepo: Repository<Seat>,
    private readonly configService: ConfigService,
    private readonly ticketService: TicketService,
    private readonly gateway: ReservationGateway,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('stripe.secretKey') || '',
      { apiVersion: '2024-06-20' },
    );
  }

  /** Abre a cobrança de uma reserva pendente. */
  async createPaymentIntent(userId: string, reservationId: string): Promise<{
    clientSecret: string;
    paymentId: string;
  }> {
    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId, userId },
    });

    if (!reservation) {
      throw new AppError('Reservation not found', ErrorCodes.NOT_FOUND, 404);
    }

    if (reservation.status !== ReservationStatus.PENDING_PAYMENT) {
      throw new AppError(
        'Reservation is not in pending payment state',
        ErrorCodes.BAD_REQUEST,
        400,
      );
    }

    if (reservation.expiresAt <= new Date()) {
      throw new AppError(
        'Reservation has expired. Please create a new one.',
        ErrorCodes.BAD_REQUEST,
        400,
      );
    }

    // Cobrança já aberta: buscar o intent na Stripe e devolver o `client_secret`
    // real. Devolvíamos uma string inventada, que o Stripe.js recusa — quem
    // reservava, fechava a aba e voltava para pagar nunca mais conseguia (B21).
    const existing = await this.paymentRepo.findOne({
      where: { reservationId },
    });
    if (existing && existing.status === PaymentStatus.PENDING) {
      if (this.hasRealStripeKey() && existing.stripePaymentIntentId?.startsWith('pi_')) {
        try {
          const intent = await this.stripe.paymentIntents.retrieve(
            existing.stripePaymentIntentId,
          );
          return { clientSecret: intent.client_secret, paymentId: existing.id };
        } catch (error) {
          // Intent sumiu da Stripe (chave trocada, ambiente limpo): criar outro
          // é melhor do que travar a compra.
          this.logger.warn(
            `PaymentIntent ${existing.stripePaymentIntentId} não encontrado na Stripe; criando outro para a reserva ${reservationId}`,
          );
        }
      } else {
        return {
          clientSecret: `simulated_${existing.stripePaymentIntentId}`,
          paymentId: existing.id,
        };
      }
    }

    const isSimulated = !this.hasRealStripeKey();

    if (isSimulated) {
      this.logger.log(`Simulated mode — skipping Stripe API for reservation ${reservationId}`);

      const payment = this.paymentRepo.create({
        reservationId,
        userId,
        amount: Number(reservation.totalAmount),
        currency: reservation.currency,
        stripePaymentIntentId: `sim_${Date.now()}_${reservationId}`,
        stripeStatus: 'succeeded',
        status: PaymentStatus.SUCCEEDED,
      });

      const saved = await this.paymentRepo.save(payment);

      await this.reservationRepo.update(reservationId, {
        status: ReservationStatus.PAID,
      });

      const fullReservation = await this.reservationRepo.findOne({
        where: { id: reservationId },
        relations: ['seats'],
      });

      if (fullReservation?.seats) {
        const seatIds = fullReservation.seats.map((s) => s.id);
        if (seatIds.length > 0) {
          await this.seatRepo
            .createQueryBuilder()
            .update(Seat)
            .set({ status: SeatStatus.SOLD })
            .where('id IN (:...seatIds)', { seatIds })
            .execute();
        }
      }

      try {
        await this.ticketService.generateForReservation(reservationId);
      } catch (err) {
        this.logger.error(
          `Simulated mode — ticket generation failed for reservation ${reservationId}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }

      this.logger.log(`Simulated payment ${saved.id} succeeded — reservation ${reservationId} → paid`);

      return {
        clientSecret: 'simulated_' + saved.id,
        paymentId: saved.id,
      };
    }

    // Create Stripe PaymentIntent
    const amount = Math.round(Number(reservation.totalAmount) * 100); // Stripe uses cents
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount,
      currency: reservation.currency.toLowerCase(),
      metadata: {
        reservationId: reservation.id,
        userId,
      },
    });

    const payment = this.paymentRepo.create({
      reservationId,
      userId,
      amount: Number(reservation.totalAmount),
      currency: reservation.currency,
      stripePaymentIntentId: paymentIntent.id,
      stripeStatus: paymentIntent.status,
      status: PaymentStatus.PENDING,
    });

    const saved = await this.paymentRepo.save(payment);

    return {
      clientSecret: paymentIntent.client_secret || '',
      paymentId: saved.id,
    };
  }

  /**
   * Confirmação manual, só no modo simulado (SPEC_CP10 RF-5). Com chave
   * `sk_test_*` este atalho deixaria o cliente emitir ingresso sem pagar.
   */
  async confirmTestPayment(userId: string, reservationId: string): Promise<{ success: boolean; ticketCount: number }> {
    const payment = await this.paymentRepo.findOne({
      where: { reservationId, userId },
    });

    if (!payment) {
      throw new AppError('Payment not found', ErrorCodes.NOT_FOUND, 404);
    }

    if (payment.status === PaymentStatus.SUCCEEDED) {
      const ticketCount = await this.countTickets(reservationId);
      return { success: true, ticketCount };
    }

    // Com chave real, só o webhook confirma pagamento (SPEC_CP10 RF-5)
    if (this.hasRealStripeKey()) {
      throw new AppError(
        'Confirmação manual indisponível: o pagamento é confirmado pela Stripe.',
        ErrorCodes.BAD_REQUEST,
        400,
      );
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new AppError('Payment cannot be confirmed in current state', ErrorCodes.BAD_REQUEST, 400);
    }

    payment.status = PaymentStatus.SUCCEEDED;
    payment.stripeStatus = 'succeeded';
    await this.paymentRepo.save(payment);

    await this.reservationRepo.update(reservationId, {
      status: ReservationStatus.PAID,
    });

    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId },
      relations: ['seats'],
    });

    if (reservation?.seats) {
      const seatIds = reservation.seats.map((s) => s.id);
      if (seatIds.length > 0) {
        await this.seatRepo
          .createQueryBuilder()
          .update(Seat)
          .set({ status: SeatStatus.SOLD })
          .where('id IN (:...seatIds)', { seatIds })
          .execute();
      }
    }

    let ticketCount = 0;
    try {
      const tickets = await this.ticketService.generateForReservation(reservationId);
      ticketCount = Array.isArray(tickets) ? tickets.length : 1;
    } catch (err) {
      this.logger.error(
        `Test confirm — ticket generation failed for reservation ${reservationId}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    this.logger.log(`Test payment confirmed — reservation ${reservationId} → paid, ${ticketCount} tickets generated`);
    return { success: true, ticketCount };
  }

  private async countTickets(reservationId: string): Promise<number> {
    return this.ticketService.countForReservation(reservationId);
  }

  /**
   * Estado da cobrança, consultado pelo checkout enquanto o webhook não chega.
   *
   * Também reconcilia: se o registro local ainda está pendente mas a Stripe já
   * liquidou o intent, aplica a mesma transição que o webhook aplicaria. A fonte
   * de verdade continua sendo a Stripe, nunca o navegador (SPEC_CP10 RF-3).
   */
  async getPaymentStatus(
    userId: string,
    reservationId: string,
  ): Promise<{ status: PaymentStatus; ticketCount: number; ticketsPending: boolean }> {
    const payment = await this.paymentRepo.findOne({
      where: { reservationId, userId },
    });

    if (!payment) {
      throw new AppError('Payment not found', ErrorCodes.NOT_FOUND, 404);
    }

    if (payment.status === PaymentStatus.PENDING && this.hasRealStripeKey()) {
      await this.reconcileWithStripe(payment);
    }

    const refreshed = await this.paymentRepo.findOne({ where: { id: payment.id } });
    const status = refreshed?.status ?? payment.status;

    let ticketCount = await this.countTickets(reservationId);

    // Pago e sem ingresso: a emissão falhou depois do dinheiro sair. Toda
    // chamada a generateForReservation só loga o erro, então isso deixava o
    // comprador com cobrança e lista vazia. Reparo barato — só dispara no zero.
    if (status === PaymentStatus.SUCCEEDED && ticketCount === 0) {
      ticketCount = await this.reissueMissingTickets(reservationId);
    }

    return {
      status,
      ticketCount,
      // Lets the checkout say "emitindo seu ingresso" instead of dropping the
      // buyer on an empty list.
      ticketsPending: status === PaymentStatus.SUCCEEDED && ticketCount === 0,
    };
  }

  /** Reemite o ingresso de uma reserva paga que ficou sem nenhum. */
  private async reissueMissingTickets(reservationId: string): Promise<number> {
    this.logger.warn(
      `Reservation ${reservationId} is paid with no tickets — reissuing.`,
    );

    try {
      await this.ticketService.generateForReservation(reservationId);
    } catch (err) {
      this.logger.error(
        `Ticket reissue failed for reservation ${reservationId}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    return this.countTickets(reservationId);
  }

  /** Pergunta o estado real do intent à Stripe. Idempotente dos dois lados. */
  private async reconcileWithStripe(payment: Payment): Promise<void> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(
        payment.stripePaymentIntentId,
      );

      if (intent.status === 'succeeded') {
        this.logger.log(
          `Reconciled payment ${payment.id} from Stripe — intent succeeded`,
        );
        await this.handlePaymentSuccess(payment.stripePaymentIntentId);
      } else if (intent.status === 'canceled') {
        await this.handlePaymentFailure(payment.stripePaymentIntentId);
      }
    } catch (err) {
      // Melhor esforço: o webhook continua sendo o caminho principal
      this.logger.warn(
        `Stripe reconciliation failed for payment ${payment.id}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /** Com chave real, o webhook é a única fonte de verdade e o modo simulado sai. */
  private hasRealStripeKey(): boolean {
    const key = this.configService.get<string>('stripe.secretKey') || '';
    return key.startsWith('sk_test_') || key.startsWith('sk_live_');
  }

  /** `payment_intent.succeeded`. Idempotente: webhook repetido não reprocessa. */
  async handlePaymentSuccess(paymentIntentId: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) {
      this.logger.warn(`Payment not found for intent: ${paymentIntentId}`);
      return;
    }

    if (payment.status === PaymentStatus.SUCCEEDED) {
      this.logger.debug(`Payment ${payment.id} already processed — skipping`);
      return;
    }

    payment.status = PaymentStatus.SUCCEEDED;
    payment.stripeStatus = 'succeeded';
    await this.paymentRepo.save(payment);

    await this.reservationRepo.update(payment.reservationId, {
      status: ReservationStatus.PAID,
    });

    const reservation = await this.reservationRepo.findOne({
      where: { id: payment.reservationId },
      relations: ['seats'],
    });

    if (reservation?.seats) {
      const seatIds = reservation.seats.map((s) => s.id);
      if (seatIds.length > 0) {
        await this.seatRepo
          .createQueryBuilder()
          .update(Seat)
          .set({ status: SeatStatus.SOLD })
          .where('id IN (:...seatIds)', { seatIds })
          .execute();

        this.gateway.broadcastSeatUpdate(reservation.eventId, seatIds, 'sold');
      }
    }

    this.logger.log(`Payment ${payment.id} succeeded — reservation ${payment.reservationId} → paid`);

    try {
      await this.ticketService.generateForReservation(payment.reservationId);
    } catch (err) {
      this.logger.error(
        `Failed to generate tickets for reservation ${payment.reservationId}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /** `payment_intent.payment_failed`: devolve os assentos ao mapa. */
  async handlePaymentFailure(paymentIntentId: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) return;

    if (payment.status === PaymentStatus.FAILED) return;

    payment.status = PaymentStatus.FAILED;
    payment.stripeStatus = 'failed';
    await this.paymentRepo.save(payment);

    await this.reservationRepo.update(payment.reservationId, {
      status: ReservationStatus.PAYMENT_FAILED,
    });

    const reservation = await this.reservationRepo.findOne({
      where: { id: payment.reservationId },
      relations: ['seats'],
    });

    if (reservation?.seats) {
      const seatIds = reservation.seats.map((s) => s.id);
      if (seatIds.length > 0) {
        await this.seatRepo
          .createQueryBuilder()
          .update(Seat)
          .set({ status: SeatStatus.AVAILABLE })
          .where('id IN (:...seatIds)', { seatIds })
          .execute();

        this.gateway.broadcastSeatsReleased(reservation.eventId, seatIds);
      }
    }

    this.logger.log(`Payment ${payment.id} failed — reservation ${payment.reservationId} → payment_failed, seats released`);
  }

  /**
   * Devolve o dinheiro de todas as reservas de um evento cancelado.
   *
   * Roda depois do commit do cancelamento: estorno é chamada de rede, e mantê-la
   * na transação seguraria bloqueios do banco durante a latência da Stripe.
   * Idempotente por `idempotencyKey` derivada da reserva.
   */
  async refundReservationsForEvent(eventId: string): Promise<{
    refunded: number;
    failed: number;
    cancelled: number;
  }> {
    const reservations = await this.reservationRepo.find({ where: { eventId } });

    let refunded = 0;
    let failed = 0;
    let cancelled = 0;

    for (const reservation of reservations) {
      // Reserva pendente nunca cobrou nada: só deixa de existir
      if (reservation.status === ReservationStatus.PENDING_PAYMENT) {
        reservation.status = ReservationStatus.CANCELLED;
        await this.reservationRepo.save(reservation);
        cancelled += 1;
        continue;
      }

      if (reservation.status !== ReservationStatus.PAID) continue;

      try {
        await this.refundPaidReservation(reservation);
        refunded += 1;
      } catch (error) {
        // Parar no meio deixaria metade dos clientes sem dinheiro e sem registro
        failed += 1;
        this.logger.error(
          `Estorno falhou para a reserva ${reservation.id} do evento ${eventId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `Evento ${eventId} cancelado: ${refunded} estornadas, ${cancelled} pendentes canceladas, ${failed} falhas`,
    );

    return { refunded, failed, cancelled };
  }

  private async refundPaidReservation(reservation: Reservation): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { reservationId: reservation.id, status: PaymentStatus.SUCCEEDED },
    });

    // Modo simulado ou pagamento que nunca chegou à Stripe: não há o que
    // estornar lá fora, mas o estado local ainda precisa fechar.
    if (payment && this.hasRealStripeKey() && payment.stripePaymentIntentId) {
      await this.stripe.refunds.create(
        { payment_intent: payment.stripePaymentIntentId },
        { idempotencyKey: `refund-${reservation.id}` },
      );
    }

    reservation.status = ReservationStatus.REFUNDED;
    await this.reservationRepo.save(reservation);
  }

  /** Confere a assinatura do webhook. `null` = não veio da Stripe. */
  verifyWebhookSignature(payload: Buffer, signature: string): any | null {
    const webhookSecret = this.configService.get<string>('stripe.webhookSecret') || '';
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return null;
    }
  }
}
