import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  VersionColumn,
} from 'typeorm';
import { Event } from './event.entity';

export enum SeatStatus {
  AVAILABLE = 'available',
  RESERVED = 'reserved',
  SOLD = 'sold',
}

@Entity('seats')
@Unique('uq_seats_event_section_row_number', ['eventId', 'section', 'row', 'number'])
@Index('idx_seats_event_status', ['eventId', 'status'])
export class Seat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id' })
  eventId: string;

  @ManyToOne(() => Event)
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @Column({ length: 50 })
  section: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  row: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  number: string | null;

  @Column({ type: 'enum', enum: SeatStatus, default: SeatStatus.AVAILABLE })
  status: SeatStatus;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
