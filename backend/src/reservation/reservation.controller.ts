import { Controller, Post, Get, Param, Body, ParseUUIDPipe } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Public } from '../shared/decorators/public.decorator';
import { UserRole } from '../user/entities/user.entity';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

/**
 * Reservation endpoints.
 *
 * Client-only: create reservation, my reservations
 * Public: available seats for an event
 */
@Controller('reservations')
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  /**
   * Reserve seats for an event.
   * Organizers are BLOCKED from this endpoint (Req 3.7).
   */
  @Roles(UserRole.CLIENT)
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservationService.reserveSeats(user.sub, dto);
  }

  /**
   * Get current user's reservations.
   */
  @Roles(UserRole.CLIENT)
  @Get('my')
  async myReservations(@CurrentUser() user: JwtPayload) {
    return this.reservationService.getMyReservations(user.sub);
  }

  /**
   * Get available seats for an event (public — no auth required).
   */
  @Public()
  @Get('seats/:eventId')
  async availableSeats(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.reservationService.getAvailableSeats(eventId);
  }
}
