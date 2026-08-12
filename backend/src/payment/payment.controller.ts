import { Controller, Post, Body, Param, ParseUUIDPipe } from '@nestjs/common';
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
}
