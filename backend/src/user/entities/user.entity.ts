import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export enum UserRole {
  ORGANIZER = 'organizer',
  CLIENT = 'client',
  GATE = 'gate',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_users_email', { unique: true })
  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ name: 'oauth_provider', type: 'varchar', nullable: true })
  oauthProvider: string | null;

  @Column({ name: 'oauth_id', type: 'varchar', nullable: true })
  oauthId: string | null;

  @Column({ name: 'totp_secret', type: 'varchar', nullable: true })
  totpSecret: string | null;

  @Column({ name: 'totp_enabled', type: 'boolean', default: false })
  totpEnabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
