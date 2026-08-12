import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../ticket/entities/ticket.entity';
import { Event } from '../event/entities/event.entity';
import { GateService } from './gate.service';
import { GateController } from './gate.controller';
import { TicketModule } from '../ticket/ticket.module';
import { ReservationModule } from '../reservation/reservation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Event]),
    TicketModule, // For TicketSignerService
    ReservationModule, // For ReservationGateway — live ticket updates (SPEC_CP18)
  ],
  controllers: [GateController],
  providers: [GateService],
})
export class GateModule {}
