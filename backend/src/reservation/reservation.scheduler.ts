import { Injectable, Logger } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { ReservationGateway } from './reservation.gateway';

/**
 * Reservation expiration scheduler (Req 7.4).
 *
 * Runs every 30 seconds to find and expire overdue reservations.
 * Releases seats back to "available" and broadcasts WebSocket updates.
 *
 * NOTE: In production, use @nestjs/schedule with @Cron() decorator.
 * For simplicity here, we use setInterval on module init.
 */
@Injectable()
export class ReservationScheduler {
  private readonly logger = new Logger(ReservationScheduler.name);
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly reservationService: ReservationService,
    private readonly gateway: ReservationGateway,
  ) {}

  onModuleInit(): void {
    // Run expiration check every 30 seconds
    this.intervalId = setInterval(() => {
      this.checkExpiredReservations().catch((err) => {
        this.logger.error('Expiration check failed', err instanceof Error ? err.message : String(err));
      });
    }, 30_000);

    this.logger.log('Reservation expiration scheduler started (30s interval)');
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async checkExpiredReservations(): Promise<void> {
    const result = await this.reservationService.expireOverdueReservationsDetailed();
    if (result.length > 0) {
      this.logger.log(`Expired ${result.length} reservations`);
      // Broadcast seat releases via WebSocket (Req 21.3)
      for (const { eventId, seatIds } of result) {
        this.gateway.broadcastSeatsReleased(eventId, seatIds);
      }
    }
  }
}
