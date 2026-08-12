import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Reservation } from '../reservation/entities/reservation.entity';
import { Seat } from '../event/entities/seat.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { StripeWebhookController } from './webhook/stripe-webhook.controller';
import { TicketModule } from '../ticket/ticket.module';
import { ReservationModule } from '../reservation/reservation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Reservation, Seat]),
    TicketModule,
    // For ReservationGateway — payment outcomes change seat status, and every
    // browser on the event page must see it without reloading (SPEC_CP10 RF-6)
    ReservationModule,
  ],
  /**
   * ORDER MATTERS — do not sort this array.
   *
   * Both controllers are mounted on `payments`, and PaymentController declares
   * `POST :reservationId`. Registered first, it swallows `POST /payments/webhook`
   * as `reservationId = "webhook"` — a client-only route, so Stripe got 401 and
   * the `@Public()` on the webhook was never even consulted. Guards run before
   * pipes, so ParseUUIDPipe never got the chance to reject "webhook" either.
   *
   * Nest matches in registration order, so the literal path must come first.
   * Covered by payment.routing.spec.ts.
   */
  controllers: [StripeWebhookController, PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
