import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
  Index,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Event } from '../../event/entities/event.entity';
import { Seat } from '../../event/entities/seat.entity';

export enum ReservationStatus {
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  EXPIRED = 'expired',
  PAYMENT_FAILED = 'payment_failed',
  REFUNDED = 'refunded',
}

@Entity('reservations')
@Index('idx_reservations_user_status', ['userId', 'status'])
@Index('idx_reservations_expires_at', ['expiresAt'])
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'event_id' })
  eventId: string;

  @ManyToOne(() => Event)
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @ManyToMany(() => Seat)
  @JoinTable({
    name: 'reservation_seats',
    joinColumn: { name: 'reservation_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'seat_id', referencedColumnName: 'id' },
  })
  seats: Seat[];

  @Column({ type: 'enum', enum: ReservationStatus })
  status: ReservationStatus;

  @Column({ name: 'total_amount', type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ length: 3 })
  currency: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
