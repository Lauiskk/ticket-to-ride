import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Event } from '../../event/entities/event.entity';
import { Reservation } from '../../reservation/entities/reservation.entity';

export enum TicketStatus {
  ACTIVE = 'active',
  USED = 'used',
  INVALIDATED = 'invalidated',
}

@Entity('tickets')
@Index('idx_tickets_event_status', ['eventId', 'status'])
@Index('idx_tickets_owner', ['ownerId'])
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id' })
  eventId: string;

  @ManyToOne(() => Event)
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @Column({ name: 'reservation_id' })
  reservationId: string;

  @ManyToOne(() => Reservation)
  @JoinColumn({ name: 'reservation_id' })
  reservation: Reservation;

  @Column({ name: 'owner_id' })
  ownerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ name: 'seat_identifier' })
  seatIdentifier: string;

  @Index('idx_tickets_ticket_code', { unique: true })
  @Column({ name: 'ticket_code', unique: true })
  ticketCode: string;

  @Column({ name: 'qr_payload', type: 'text' })
  qrPayload: string;

  @Column({ name: 'qr_image_url' })
  qrImageUrl: string;

  @Column({ name: 'qr_image_format', default: 'png' })
  qrImageFormat: string;

  @Column({ name: 'hmac_signature' })
  hmacSignature: string;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.ACTIVE })
  status: TicketStatus;

  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt: Date | null;

  /**
   * Half-price ticket (SPEC_CP12 RF-12). The gate must ask for the matching
   * document before letting this holder in.
   */
  @Column({ name: 'is_half_price', type: 'boolean', default: false })
  isHalfPrice: boolean;

  /** `student` | `senior` | `pcd` — null on full-price tickets. */
  @Column({ name: 'half_price_category', type: 'varchar', nullable: true })
  halfPriceCategory: string | null;

  /**
   * Document number declared at checkout. PII: never leaves the API in full —
   * the gate receives a masked version (see GateService).
   */
  @Column({ name: 'holder_document', type: 'varchar', nullable: true })
  holderDocument: string | null;

  @Column({ name: 'validated_by_gate_id', type: 'varchar', nullable: true })
  validatedByGateId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
