import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../../user/entities/user.entity';
import { Event } from '../../event/entities/event.entity';
import { Seat } from '../../event/entities/seat.entity';
import { Reservation } from '../../reservation/entities/reservation.entity';
import { Payment } from '../../payment/entities/payment.entity';
import { Ticket } from '../../ticket/entities/ticket.entity';
import { SharingLink } from '../../sharing/entities/sharing-link.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';

/**
 * All domain entities registered with TypeORM.
 */
export const entities = [
  User,
  Event,
  Seat,
  Reservation,
  Payment,
  Ticket,
  SharingLink,
  AuditLog,
];

/**
 * TypeORM configuration factory.
 * Used by both NestJS module and the CLI (for migrations).
 */
export function getTypeOrmConfig(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities,
    synchronize: process.env.NODE_ENV === 'development',
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    autoLoadEntities: true,
  };
}
