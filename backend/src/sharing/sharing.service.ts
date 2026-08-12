import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SharingLink, SharingLinkStatus } from './entities/sharing-link.entity';
import { Ticket, TicketStatus } from '../ticket/entities/ticket.entity';
import { TicketService } from '../ticket/ticket.service';
import { TicketSignerService, TicketPayload } from '../ticket/crypto/ticket-signer.service';
import { QrGeneratorService } from '../ticket/qr/qr-generator.service';
import {
  AppError,
  ErrorCodes,
  LinkExpiredError,
  LinkAlreadyUsedError,
} from '../shared/errors';

/**
 * Sharing service — generate links, transfer tickets (Req 10.1-10.6).
 *
 * Key behaviors:
 * - Generate signed URL with 48-hour expiry (Req 10.1)
 * - Transfer: invalidate old ticket, generate new with fresh QR (Req 10.2, 10.3)
 * - Link validation priority: USED > EXPIRED (Req 10.5)
 * - Active link does NOT lock ticket — owner can still use at gate (Req 10.6)
 */
@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);
  private readonly sharingTtlHours: number;
  private readonly secret: string;

  constructor(
    @InjectRepository(SharingLink)
    private readonly linkRepo: Repository<SharingLink>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly ticketSignerService: TicketSignerService,
    private readonly qrGenerator: QrGeneratorService,
    private readonly configService: ConfigService,
  ) {
    this.sharingTtlHours = this.configService.get<number>('sharing.ttlHours', 48);
    this.secret = this.configService.get<string>('ticket.signingSecret') || '';
  }

  // ─── Generate Sharing Link ────────────────────────────────────────────────

  /**
   * Generate a sharing link for a ticket the user owns (Req 10.1).
   * Active link does NOT lock the ticket (Req 10.6).
   */
  async generateLink(ticketId: string, userId: string): Promise<{
    token: string;
    shareUrl: string;
    expiresAt: Date;
  }> {
    // Verify ownership
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) {
      throw new AppError('Ticket not found', ErrorCodes.NOT_FOUND, 404);
    }
    if (ticket.ownerId !== userId) {
      throw new AppError('Ticket not found', ErrorCodes.NOT_FOUND, 404); // Anti-enumeration
    }
    if (ticket.status !== TicketStatus.ACTIVE) {
      throw new AppError('Ticket is not eligible for sharing', ErrorCodes.BAD_REQUEST, 400);
    }

    // Invalidate any existing active links for this ticket
    await this.linkRepo.update(
      { ticketId, status: SharingLinkStatus.ACTIVE },
      { status: SharingLinkStatus.EXPIRED },
    );

    // Generate token and signature
    const token = randomBytes(32).toString('hex');
    const signature = createHmac('sha256', this.secret)
      .update(`${ticketId}:${token}`)
      .digest('hex');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.sharingTtlHours);

    // Save link
    const link = this.linkRepo.create({
      ticketId,
      creatorId: userId,
      token,
      transferTokenSignature: signature,
      status: SharingLinkStatus.ACTIVE,
      expiresAt,
    });

    await this.linkRepo.save(link);

    const baseUrl = this.configService.get<string>('cors.origin', 'http://localhost:5173');
    const shareUrl = `${baseUrl}/share/${token}`;

    return { token, shareUrl, expiresAt };
  }

  // ─── Accept Transfer ──────────────────────────────────────────────────────

  /**
   * Accept a sharing link and transfer ticket ownership (Req 10.2, 10.3).
   *
   * Validation priority (Req 10.5):
   * 1. Check USED first → LINK_ALREADY_USED
   * 2. Check EXPIRED → LINK_EXPIRED
   */
  async acceptTransfer(token: string, recipientId: string): Promise<Ticket> {
    const link = await this.linkRepo.findOne({ where: { token } });

    if (!link) {
      throw new AppError('Invalid sharing link', ErrorCodes.NOT_FOUND, 404);
    }

    // Priority check: USED before EXPIRED (Req 10.5)
    if (link.status === SharingLinkStatus.USED) {
      throw new LinkAlreadyUsedError();
    }

    if (link.status === SharingLinkStatus.EXPIRED || link.expiresAt <= new Date()) {
      // Mark as expired if it was still active but time passed
      if (link.status === SharingLinkStatus.ACTIVE) {
        link.status = SharingLinkStatus.EXPIRED;
        await this.linkRepo.save(link);
      }
      throw new LinkExpiredError();
    }

    // Prevent self-transfer
    if (link.creatorId === recipientId) {
      throw new AppError('Cannot transfer ticket to yourself', ErrorCodes.BAD_REQUEST, 400);
    }

    // Find the original ticket
    const originalTicket = await this.ticketRepo.findOne({ where: { id: link.ticketId } });
    if (!originalTicket) {
      throw new AppError('Ticket no longer exists', ErrorCodes.NOT_FOUND, 404);
    }

    if (originalTicket.status !== TicketStatus.ACTIVE) {
      throw new AppError('Ticket is no longer transferable', ErrorCodes.BAD_REQUEST, 400);
    }

    // ─── Perform Transfer ─────────────────────────────────────────────────

    // 1. Invalidate original ticket (Req 10.2)
    originalTicket.status = TicketStatus.INVALIDATED;
    await this.ticketRepo.save(originalTicket);

    // 2. Generate new ticket for recipient with fresh QR (Req 10.3)
    const { v4: uuidv4 } = await import('uuid');
    const newTicketId = uuidv4();
    const issuedAt = Math.floor(Date.now() / 1000);

    const payload: TicketPayload = {
      ticketId: newTicketId,
      eventId: originalTicket.eventId,
      seatIdentifier: originalTicket.seatIdentifier,
      issuedAt,
    };

    const newSignature = this.ticketSignerService.sign(payload);
    const qrPayloadString = this.ticketSignerService.encodeQrPayload(payload, newSignature);
    const { dataUrl, format } = await this.qrGenerator.generate(qrPayloadString);

    const newTicket = this.ticketRepo.create({
      id: newTicketId,
      eventId: originalTicket.eventId,
      reservationId: originalTicket.reservationId,
      ownerId: recipientId,
      seatIdentifier: originalTicket.seatIdentifier,
      ticketCode: newTicketId,
      qrPayload: qrPayloadString,
      qrImageUrl: dataUrl,
      qrImageFormat: format,
      hmacSignature: newSignature,
      status: TicketStatus.ACTIVE,
    });

    const savedTicket = await this.ticketRepo.save(newTicket);

    // 3. Mark sharing link as used
    link.status = SharingLinkStatus.USED;
    link.usedAt = new Date();
    link.recipientId = recipientId;
    await this.linkRepo.save(link);

    this.logger.log(
      `Ticket ${originalTicket.id} transferred to user ${recipientId} via link ${link.id}`,
    );

    return savedTicket;
  }
}
