import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from './entities/ticket.entity';
import { Reservation } from '../reservation/entities/reservation.entity';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { TicketSignerService } from './crypto/ticket-signer.service';
import { QrGeneratorService } from './qr/qr-generator.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, Reservation])],
  controllers: [TicketController],
  providers: [TicketService, TicketSignerService, QrGeneratorService],
  exports: [TicketService, TicketSignerService, QrGeneratorService],
})
export class TicketModule {}
