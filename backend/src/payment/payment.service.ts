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

    // Detect simulated mode
    const stripeKey = this.configService.get<string>('stripe.secretKey') || '';
    const isSimulated = !stripeKey.startsWith('sk_test_');

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
