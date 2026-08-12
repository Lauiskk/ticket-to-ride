import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

export enum EventStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CANCELLED = 'cancelled',
}

export enum SeatingType {
  NUMBERED = 'numbered',
  GENERAL_ADMISSION = 'general-admission',
}

@Entity('events')
export class Event {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organizer_id' })
  organizerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'organizer_id' })
  organizer: User;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Index('idx_events_date')
  @Column({ type: 'timestamptz' })
  date: Date;

  @Column({ name: 'venue_name', length: 200 })
  venueName: string;

  @Column({ name: 'venue_address', length: 500 })
  venueAddress: string;

  @Column({ name: 'venue_lat', type: 'float', nullable: true })
  venueLat: number | null;

  @Column({ name: 'venue_lng', type: 'float', nullable: true })
  venueLng: number | null;

  @Index('idx_events_venue_city')
  @Column({ name: 'venue_city', type: 'varchar', length: 100, nullable: true })
  venueCity: string | null;

  @Column({ type: 'int' })
  capacity: number;

  @Column({ name: 'seating_type', type: 'enum', enum: SeatingType })
  seatingType: SeatingType;

  @Column({ name: 'seat_map_config', type: 'jsonb', nullable: true })
  seatMapConfig: Record<string, unknown> | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ length: 3 })
  currency: string;

  /**
   * Half-price tickets (SPEC_CP12 RF-8).
   *
   * On by default because in Brazil it is not a feature, it is the law
   * (Lei 12.933/2013 — 40% of tickets at half price for students, people over
   * 60 and people with disabilities). An organizer can switch it off for events
   * the law does not cover (private/corporate), but the default is compliance.
   */
  @Column({ name: 'half_price_enabled', type: 'boolean', default: true })
  halfPriceEnabled: boolean;

  /** Maximum half-price tickets for this event. `null` = no cap. */
  @Column({ name: 'half_price_quota', type: 'int', nullable: true })
  halfPriceQuota: number | null;

  @Index('idx_events_status')
  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.DRAFT })
  status: EventStatus;

  /**
   * Poster/banner, normally carried over from the external catalogue.
   * Without it the whole Ticketmaster/TMDb integration pulls an image and
   * throws it away, leaving the storefront full of grey rectangles.
   */
  @Column({ name: 'image_url', type: 'varchar', length: 1000, nullable: true })
  imageUrl: string | null;

  @Column({ name: 'external_id', type: 'varchar', nullable: true })
  externalId: string | null;

  @Column({ name: 'external_source', type: 'varchar', nullable: true })
  externalSource: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
