import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharingLink } from './entities/sharing-link.entity';
import { Ticket } from '../ticket/entities/ticket.entity';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';
import { TicketModule } from '../ticket/ticket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SharingLink, Ticket]),
    TicketModule, // For TicketSignerService + QrGeneratorService
  ],
  controllers: [SharingController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
