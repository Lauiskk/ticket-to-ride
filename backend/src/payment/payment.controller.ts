import { Controller, Post, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { UserRole } from '../user/entities/user.entity';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

/**
 * Payment endpoints.
 * Client-only: create payment intent for a reservation.
 * Organizers are BLOCKED (Req 3.7).
 */
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * Create a Stripe PaymentIntent for a pending reservation.
   * Returns clientSecret for Stripe Elements on the frontend.
   */
  @Roles(UserRole.CLIENT)
  @Post(':reservationId')
  async createPayment(
    @CurrentUser() user: JwtPayload,
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ) {
    return this.paymentService.createPaymentIntent(user.sub, reservationId);
  }

  /**
   * Payment status of a reservation — polled by the checkout modal while the
   * Stripe webhook lands (SPEC_CP10 RF-3).
   */
  @Roles(UserRole.CLIENT)
  @Get(':reservationId/status')
  async paymentStatus(
    @CurrentUser() user: JwtPayload,
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ) {
    return this.paymentService.getPaymentStatus(user.sub, reservationId);
  }

  /**
   * Simulated-mode endpoint: confirm a payment without Stripe.
   * Only available when no real Stripe key is configured — with `sk_test_*`
   * the webhook is the single source of truth and this returns 400 (RF-5).
   */
  @Roles(UserRole.CLIENT)
  @Post(':reservationId/confirm')
  async confirmPayment(
    @CurrentUser() user: JwtPayload,
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ) {
    return this.paymentService.confirmTestPayment(user.sub, reservationId);
  }
}
