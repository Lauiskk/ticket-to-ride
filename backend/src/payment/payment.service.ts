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
 * Payment service — Stripe test mode integration.
 *
 * Key behaviors:
 * - Creates Stripe PaymentIntent for reservation total (Req 8.1)
 * - On success → reservation "paid", trigger ticket generation (Req 8.2)
 * - On failure → reservation "payment_failed", release seats (Req 8.3)
 * - Webhook idempotency: duplicate webhook returns 200, no reprocessing (Req 8.5)
 * - Logs all state transitions to audit (Req 8.6)
 * - Simulated mode: if Stripe key is not a real test key, bypasses Stripe API
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

  // ─── Create Payment Intent ────────────────────────────────────────────────

  /**
   * Creates a Stripe PaymentIntent for a pending reservation.
   * If the Stripe key is not a real test key, runs in simulated mode
   * (skips Stripe API, marks payment as succeeded immediately).
   */
  async createPaymentIntent(userId: string, reservationId: string): Promise<{
    clientSecret: string;
    paymentId: string;
  }> {
    // Find reservation and validate ownership
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

    // Check if reservation has expired
    if (reservation.expiresAt <= new Date()) {
      throw new AppError(
        'Reservation has expired. Please create a new one.',
        ErrorCodes.BAD_REQUEST,
        400,
      );
    }

    // Check if payment already exists for this reservation (idempotent)
    const existing = await this.paymentRepo.findOne({
      where: { reservationId },
    });
    if (existing && existing.status === PaymentStatus.PENDING) {
      // Return existing payment intent
      return {
        clientSecret: `reuse_${existing.stripePaymentIntentId}`,
        paymentId: existing.id,
      };
    }

    // Detect simulated mode (no usable Stripe key configured)
    const isSimulated = !this.hasRealStripeKey();

    if (isSimulated) {
      // ─── Simulated Mode: skip Stripe API entirely ───────────────────────
      this.logger.log(`Simulated mode — skipping Stripe API for reservation ${reservationId}`);

      // Create payment record with SUCCEEDED status directly
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

      // Transition reservation to PAID
      await this.reservationRepo.update(reservationId, {
        status: ReservationStatus.PAID,
      });

      // Mark seats as SOLD
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

      // Generate tickets
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

    // ─── Real Stripe Mode ─────────────────────────────────────────────────

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

    // Save payment record
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

  // ─── Handle Webhook Events ────────────────────────────────────────────────

  /**
   * Simulated-mode confirmation: manually mark a payment as succeeded.
   *
   * Only available when there is NO real Stripe key configured (SPEC_CP10 RF-5).
   * With a `sk_test_*` key the Stripe webhook is the single source of truth, so
   * this shortcut would let a client mint tickets without ever paying.
   */
  async confirmTestPayment(userId: string, reservationId: string): Promise<{ success: boolean; ticketCount: number }> {
    // Find the payment for this reservation
    const payment = await this.paymentRepo.findOne({
      where: { reservationId, userId },
    });

    if (!payment) {
      throw new AppError('Payment not found', ErrorCodes.NOT_FOUND, 404);
    }

    // Idempotency: if already succeeded, return success
    if (payment.status === PaymentStatus.SUCCEEDED) {
      const ticketCount = await this.countTickets(reservationId);
      return { success: true, ticketCount };
    }

    // With a real Stripe key, only the webhook may confirm a payment (RF-5)
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

    // Mark payment as succeeded
    payment.status = PaymentStatus.SUCCEEDED;
    payment.stripeStatus = 'succeeded';
    await this.paymentRepo.save(payment);

    // Transition reservation to PAID
    await this.reservationRepo.update(reservationId, {
      status: ReservationStatus.PAID,
    });

    // Mark seats as SOLD
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

    // Generate tickets
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

  /**
   * How many tickets already exist for this reservation (SPEC_CP10 AC-6).
   * Used on idempotent re-confirmation so the client gets the real number.
   */
  private async countTickets(reservationId: string): Promise<number> {
    return this.ticketService.countForReservation(reservationId);
  }

  // ─── Payment Status (polling + reconciliation) ────────────────────────────

  /**
   * Status of the payment of a reservation, for the checkout modal to poll
   * while the Stripe webhook lands (SPEC_CP10 RF-3).
   *
   * Also acts as a reconciliation path: if the local record is still pending but
   * Stripe already settled the PaymentIntent, we apply the same transition the
   * webhook would. This keeps the flow working when `stripe listen` is not
   * running locally, without ever trusting the client about the outcome —
   * the source of truth is always Stripe, never the browser.
   */
  async getPaymentStatus(
    userId: string,
    reservationId: string,
  ): Promise<{ status: PaymentStatus; ticketCount: number }> {
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

    return {
      status,
      ticketCount: await this.countTickets(reservationId),
    };
  }

  /**
   * Ask Stripe for the real PaymentIntent state and apply the matching
   * transition. Safe to call repeatedly — both handlers are idempotent.
   */
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
      // Reconciliation is best-effort — the webhook remains the primary path
      this.logger.warn(
        `Stripe reconciliation failed for payment ${payment.id}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /**
   * True when a usable Stripe key is configured — in that case the webhook is
   * the single source of truth and the simulated shortcuts are disabled.
   */
  private hasRealStripeKey(): boolean {
    const key = this.configService.get<string>('stripe.secretKey') || '';
    return key.startsWith('sk_test_') || key.startsWith('sk_live_');
  }

  /**
   * Process a payment_intent.succeeded event.
   * Idempotent: if already processed, returns without changes (Req 8.5).
   */
  async handlePaymentSuccess(paymentIntentId: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) {
      this.logger.warn(`Payment not found for intent: ${paymentIntentId}`);
      return;
    }

    // Idempotency check (Req 8.5)
    if (payment.status === PaymentStatus.SUCCEEDED) {
      this.logger.debug(`Payment ${payment.id} already processed — skipping`);
      return;
    }

    // Update payment status
    payment.status = PaymentStatus.SUCCEEDED;
    payment.stripeStatus = 'succeeded';
    await this.paymentRepo.save(payment);

    // Transition reservation to "paid" (Req 8.2)
    await this.reservationRepo.update(payment.reservationId, {
      status: ReservationStatus.PAID,
    });

    // Mark seats as "sold"
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

    // Trigger ticket generation (Req 8.2 → 9.1)
    try {
      await this.ticketService.generateForReservation(payment.reservationId);
    } catch (err) {
      this.logger.error(
        `Failed to generate tickets for reservation ${payment.reservationId}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /**
   * Process a payment_intent.payment_failed event.
   */
  async handlePaymentFailure(paymentIntentId: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) return;

    // Idempotency
    if (payment.status === PaymentStatus.FAILED) return;

    // Update payment status
    payment.status = PaymentStatus.FAILED;
    payment.stripeStatus = 'failed';
    await this.paymentRepo.save(payment);

    // Transition reservation to "payment_failed" (Req 8.3)
    await this.reservationRepo.update(payment.reservationId, {
      status: ReservationStatus.PAYMENT_FAILED,
    });

    // Release seats back to available
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

  // ─── Webhook Signature Verification ───────────────────────────────────────

  /**
   * Verify Stripe webhook signature and parse event.
   * Returns null if signature is invalid.
   */
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
