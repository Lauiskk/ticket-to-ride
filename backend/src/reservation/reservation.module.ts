import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from './entities/reservation.entity';
import { Seat } from '../event/entities/seat.entity';
import { Event } from '../event/entities/event.entity';
import { ReservationService } from './reservation.service';
import { ReservationController } from './reservation.controller';
import { ReservationScheduler } from './reservation.scheduler';
import { ReservationGateway } from './reservation.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, Seat, Event])],
  controllers: [ReservationController],
  providers: [ReservationService, ReservationScheduler, ReservationGateway],
  exports: [ReservationService, ReservationGateway],
})
export class ReservationModule {}
