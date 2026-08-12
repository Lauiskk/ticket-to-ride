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
  const isDevelopment = process.env.NODE_ENV === 'development';

  return {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities,
    /**
     * Schema sync.
     *
     * On in development, and opt-in elsewhere via `DB_SYNCHRONIZE=true`.
     * The project has no migrations yet, so a fresh production database would
     * otherwise start with **zero tables** and fail every query. Making it an
     * explicit flag beats the alternative of lying about NODE_ENV to get a
     * schema — and it stays off unless someone asks for it.
     *
     * Known limitation, documented in the README: real production wants
     * migrations, not synchronize.
     */
    synchronize: isDevelopment || process.env.DB_SYNCHRONIZE === 'true',
    /** Managed Postgres (Railway, Neon, Supabase) requires TLS. */
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    logging: isDevelopment ? ['error', 'warn'] : ['error'],
    autoLoadEntities: true,
  };
}
