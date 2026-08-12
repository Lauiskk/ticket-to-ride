import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Ticket } from '../../ticket/entities/ticket.entity';

export enum SharingLinkStatus {
  ACTIVE = 'active',
  USED = 'used',
  EXPIRED = 'expired',
}

@Entity('sharing_links')
export class SharingLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ticket_id' })
  ticketId: string;

  @ManyToOne(() => Ticket)
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({ name: 'creator_id' })
  creatorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @Index('idx_sharing_links_token', { unique: true })
  @Column({ unique: true })
  token: string;

  @Column({ name: 'transfer_token_signature' })
  transferTokenSignature: string;

  @Column({ type: 'enum', enum: SharingLinkStatus, default: SharingLinkStatus.ACTIVE })
  status: SharingLinkStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'recipient_id', type: 'varchar', nullable: true })
  recipientId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'recipient_id' })
  recipient: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
