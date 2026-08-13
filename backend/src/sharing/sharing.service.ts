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
import { resolveFrontendUrl } from '../shared/config/frontend-url';

/**
 * O que o destinatário vê antes de decidir (SPEC_CP22 RF-2).
 *
 * Evento, data, local e assento. Nada de quem comprou: um link que vaza revela
 * um lugar num show, não uma pessoa.
 */
export interface SharePreview {
  status: 'active' | 'used' | 'expired' | 'not_transferable';
  seatIdentifier: string;
  expiresAt: Date;
  event: {
    title: string;
    date: Date;
    venueName: string;
    venueCity: string | null;
  } | null;
}

/**
 * Compartilhamento de ingresso por link, com validade de 48 horas. Aceitar
 * invalida o original e emite outro, com QR novo. Link em aberto não trava o
 * ingresso: quem enviou ainda pode entrar com ele até alguém aceitar.
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

  /** Gera o link de um ingresso do próprio usuário. */
  async generateLink(ticketId: string, userId: string): Promise<{
    token: string;
    shareUrl: string;
    expiresAt: Date;
  }> {
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

    // Um link novo aposenta os anteriores do mesmo ingresso
    await this.linkRepo.update(
      { ticketId, status: SharingLinkStatus.ACTIVE },
      { status: SharingLinkStatus.EXPIRED },
    );

    const token = randomBytes(32).toString('hex');
    const signature = createHmac('sha256', this.secret)
      .update(`${ticketId}:${token}`)
      .digest('hex');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.sharingTtlHours);

    const link = this.linkRepo.create({
      ticketId,
      creatorId: userId,
      token,
      transferTokenSignature: signature,
      status: SharingLinkStatus.ACTIVE,
      expiresAt,
    });

    await this.linkRepo.save(link);

    // O endereço do site, nunca `cors.origin`: essa virou lista com curinga
    // quando o deploy ganhou domínio de preview, e montar o link com ela
    // produzia um endereço que não abre em lugar nenhum. Mesmo defeito que
    // quebrou o retorno do OAuth.
    const baseUrl = resolveFrontendUrl(
      this.configService.get<string>('frontendUrl'),
      this.configService.get<string>('cors.origin'),
    );
    const shareUrl = `${baseUrl}/share/${token}`;

    return { token, shareUrl, expiresAt };
  }

  /**
   * O que o link oferece, sem consumi-lo. Existia só o `accept`: abrir o link
   * era a decisão, sem ver de que evento é. Leitura não pode ter efeito
   * colateral, muito menos um irreversível.
   */
  async preview(token: string): Promise<SharePreview> {
    const link = await this.linkRepo.findOne({ where: { token } });
    if (!link) {
      throw new AppError('Invalid sharing link', ErrorCodes.NOT_FOUND, 404);
    }

    const ticket = await this.ticketRepo.findOne({
      where: { id: link.ticketId },
      relations: ['event'],
    });

    const status = SharingService.previewStatus(link, ticket);

    return {
      status,
      seatIdentifier: ticket?.seatIdentifier ?? '',
      expiresAt: link.expiresAt,
      event: ticket?.event
        ? {
            title: ticket.event.title,
            date: ticket.event.date,
            venueName: ticket.event.venueName,
            venueCity: ticket.event.venueCity ?? null,
          }
        : null,
    };
  }

  /**
   * Mesma prioridade do `acceptTransfer`: usado vence expirado. Discordando, a
   * prévia prometeria o que a transferência recusa.
   */
  private static previewStatus(
    link: SharingLink,
    ticket: Ticket | null,
  ): SharePreview['status'] {
    if (link.status === SharingLinkStatus.USED) return 'used';
    if (link.status === SharingLinkStatus.EXPIRED || link.expiresAt <= new Date()) {
      return 'expired';
    }
    // O ingresso pode ter sido validado na portaria depois de o link sair
    if (!ticket || ticket.status !== TicketStatus.ACTIVE) return 'not_transferable';
    return 'active';
  }

  /** Aceita o link e transfere a posse do ingresso. */
  async acceptTransfer(token: string, recipientId: string): Promise<Ticket> {
    const link = await this.linkRepo.findOne({ where: { token } });

    if (!link) {
      throw new AppError('Invalid sharing link', ErrorCodes.NOT_FOUND, 404);
    }

    if (link.status === SharingLinkStatus.USED) {
      throw new LinkAlreadyUsedError();
    }

    if (link.status === SharingLinkStatus.EXPIRED || link.expiresAt <= new Date()) {
      if (link.status === SharingLinkStatus.ACTIVE) {
        link.status = SharingLinkStatus.EXPIRED;
        await this.linkRepo.save(link);
      }
      throw new LinkExpiredError();
    }

    if (link.creatorId === recipientId) {
      throw new AppError('Cannot transfer ticket to yourself', ErrorCodes.BAD_REQUEST, 400);
    }

    const originalTicket = await this.ticketRepo.findOne({ where: { id: link.ticketId } });
    if (!originalTicket) {
      throw new AppError('Ticket no longer exists', ErrorCodes.NOT_FOUND, 404);
    }

    if (originalTicket.status !== TicketStatus.ACTIVE) {
      throw new AppError('Ticket is no longer transferable', ErrorCodes.BAD_REQUEST, 400);
    }

    originalTicket.status = TicketStatus.INVALIDATED;
    await this.ticketRepo.save(originalTicket);

    // QR novo: o antigo já circulou por aí
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
