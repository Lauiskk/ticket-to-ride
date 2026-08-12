import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../ticket/entities/ticket.entity';
import { Event } from '../event/entities/event.entity';
import { GateService } from './gate.service';
import { GateController } from './gate.controller';
import { TicketModule } from '../ticket/ticket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Event]),
    TicketModule, // For TicketSignerService
  ],
  controllers: [GateController],
  providers: [GateService],
})
export class GateModule {}
