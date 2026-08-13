import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentModule } from '../payment/payment.module';
import { ReservationModule } from '../reservation/reservation.module';
import { Event } from './entities/event.entity';
import { Seat } from './entities/seat.entity';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { CatalogService } from './catalog/catalog.service';
import { CatalogController } from './catalog/catalog.controller';
import { TicketmasterClient } from './catalog/ticketmaster.client';
import { TmdbClient } from './catalog/tmdb.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([Event, Seat]),
    // Cancelar evento estorna as compras (SPEC_CP23). `forwardRef` porque o
    // PaymentModule também alcança este módulo pelas entidades.
    forwardRef(() => PaymentModule),
    // Para anunciar a liberação dos assentos a quem está com o mapa aberto
    ReservationModule,
  ],
  controllers: [EventController, CatalogController],
  providers: [EventService, CatalogService, TicketmasterClient, TmdbClient],
  exports: [EventService, CatalogService],
})
export class EventModule {}
