import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedService } from './seed.service';
import { User } from '../user/entities/user.entity';
import { Event } from '../event/entities/event.entity';
import { Seat } from '../event/entities/seat.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Event, Seat])],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
