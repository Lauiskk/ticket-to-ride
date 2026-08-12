import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedService } from './seed.service';
import { User } from '../user/entities/user.entity';
import { Event } from '../event/entities/event.entity';
import { Seat } from '../event/entities/seat.entity';
import { EventModule } from '../event/event.module';

@Module({
  // EventModule brings CatalogService, so the seed can build its events from
  // the real Ticketmaster/TMDb catalogue instead of a hardcoded list.
  imports: [TypeOrmModule.forFeature([User, Event, Seat]), EventModule],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
