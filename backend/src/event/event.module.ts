import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Event } from './entities/event.entity';
import { Seat } from './entities/seat.entity';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { CatalogService } from './catalog/catalog.service';
import { CatalogController } from './catalog/catalog.controller';
import { TicketmasterClient } from './catalog/ticketmaster.client';
import { TmdbClient } from './catalog/tmdb.client';

@Module({
  imports: [TypeOrmModule.forFeature([Event, Seat])],
  controllers: [EventController, CatalogController],
  providers: [EventService, CatalogService, TicketmasterClient, TmdbClient],
  exports: [EventService, CatalogService],
})
export class EventModule {}
