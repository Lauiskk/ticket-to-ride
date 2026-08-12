import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_audit_logs_timestamp')
  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ name: 'actor_id', type: 'varchar', nullable: true })
  actorId: string | null;

  @Column({ name: 'actor_ip', type: 'varchar', nullable: true })
  actorIp: string | null;

  @Column({ type: 'varchar' })
  action: string;

  @Column({ name: 'target_type', type: 'varchar', nullable: true })
  targetType: string | null;

  @Column({ name: 'target_id', type: 'varchar', nullable: true })
  targetId: string | null;

  @Column({ type: 'varchar', default: 'success' })
  result: string;

  @Column({ name: 'request_id', type: 'varchar', nullable: true })
  requestId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
