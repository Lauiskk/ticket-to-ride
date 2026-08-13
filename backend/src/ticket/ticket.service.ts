import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Ticket, TicketStatus } from './entities/ticket.entity';
import { Reservation } from '../reservation/entities/reservation.entity';
import { TicketSignerService, TicketPayload } from './crypto/ticket-signer.service';
import { QrGeneratorService } from './qr/qr-generator.service';
import { AppError, ErrorCodes } from '../shared/errors';
import { TicketResponseDto } from './dto/ticket-response.dto';

/**
 * Emissão e leitura de ingressos. O QR leva assinatura HMAC e nenhum dado
 * pessoal: quem lê o código na fila não descobre quem é o dono.
 */
@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    private readonly signerService: TicketSignerService,
    private readonly qrGenerator: QrGeneratorService,
  ) {}

  /** Emite os ingressos de uma reserva paga. Até 3 tentativas (1s, 2s, 4s). */
  async generateForReservation(reservationId: string): Promise<Ticket[]> {
    const reservation = await this.reservationRepo.findOne({
      where: { id: reservationId },
      relations: ['seats'],
    });

    if (!reservation || !reservation.seats) {
      throw new AppError('Reservation not found', ErrorCodes.NOT_FOUND, 404);
    }

    const tickets: Ticket[] = [];
    const claims = reservation.halfPriceClaims ?? {};

    for (const seat of reservation.seats) {
      // A meia-entrada é decidida por assento, no checkout
      const claim = claims[seat.id];

      const ticket = await this.generateWithRetry(
        reservation.eventId,
        reservationId,
        reservation.userId,
        `${seat.section}-${seat.row || 'GA'}-${seat.number}`,
        claim,
      );
      tickets.push(ticket);
    }

    return tickets;
  }

  async getTicket(ticketId: string, userId: string): Promise<TicketResponseDto> {
    const ticket = await this.ticketRepo.findOne({
      where: { id: ticketId },
      relations: ['event'],
    });

    if (!ticket) {
      throw new AppError('Ticket not found', ErrorCodes.NOT_FOUND, 404);
    }

    // Owner-only access (Req 9.6) + anti-enumeration
    if (ticket.ownerId !== userId) {
      throw new AppError('Ticket not found', ErrorCodes.NOT_FOUND, 404);
    }

    return TicketResponseDto.fromEntity(ticket);
  }

  /**
   * Number of tickets already generated for a reservation.
   * Used by the payment flow to report how many tickets a confirmation produced,
   * including on idempotent re-confirmations (SPEC_CP10 AC-6).
   */
  async countForReservation(reservationId: string): Promise<number> {
    return this.ticketRepo.count({ where: { reservationId } });
  }

  async getMyTickets(userId: string): Promise<TicketResponseDto[]> {
    // The event comes along so the list can lead with the show's name instead
    // of a seat code the buyer cannot place.
    const tickets = await this.ticketRepo.find({
      where: { ownerId: userId },
      relations: ['event'],
      order: { createdAt: 'DESC' },
    });

    return tickets.map((t) => TicketResponseDto.fromEntity(t));
  }

  private async generateWithRetry(
    eventId: string,
    reservationId: string,
    ownerId: string,
    seatIdentifier: string,
    halfPriceClaim?: { category: string; document: string },
  ): Promise<Ticket> {
    const maxRetries = 3;
    const backoffMs = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.generateSingleTicket(
          eventId,
          reservationId,
          ownerId,
          seatIdentifier,
          halfPriceClaim,
        );
      } catch (error) {
        if (attempt < maxRetries) {
          this.logger.warn(
            `TICKET_GENERATION_RETRY: attempt ${attempt + 1}/${maxRetries} failed for reservation ${reservationId}, seat ${seatIdentifier}`,
          );
          await this.sleep(backoffMs[attempt]);
        } else {
          this.logger.error(
            `TICKET_GENERATION_RETRY: all ${maxRetries} attempts exhausted for reservation ${reservationId}, seat ${seatIdentifier}`,
          );
          throw error;
        }
      }
    }

    // Should not reach here, but TypeScript needs it
    throw new AppError('Ticket generation failed', ErrorCodes.INTERNAL_ERROR, 500);
  }

  private async generateSingleTicket(
    eventId: string,
    reservationId: string,
    ownerId: string,
    seatIdentifier: string,
    halfPriceClaim?: { category: string; document: string },
  ): Promise<Ticket> {
    const ticketId = uuidv4();
    const issuedAt = Math.floor(Date.now() / 1000);

    // Build payload — NO PII (Req 9.4)
    const payload: TicketPayload = {
      ticketId,
      eventId,
      seatIdentifier,
      issuedAt,
    };

    // Sign with HMAC-SHA256 (Req 9.2)
    const signature = this.signerService.sign(payload);

    // Encode QR payload
    const qrPayloadString = this.signerService.encodeQrPayload(payload, signature);

    // Generate QR code image (PNG preferred, JPEG fallback — Req 9.3)
    const { dataUrl, format } = await this.qrGenerator.generate(qrPayloadString);

    // Save ticket
    const ticket = this.ticketRepo.create({
      id: ticketId,
      eventId,
      reservationId,
      ownerId,
      seatIdentifier,
      ticketCode: ticketId, // Use UUID as ticket code
      qrPayload: qrPayloadString,
      qrImageUrl: dataUrl,
      qrImageFormat: format,
      hmacSignature: signature,
      status: TicketStatus.ACTIVE,
      // Half-price stays OUT of the signed payload on purpose: the QR must carry
      // no PII (Req 9.4), and the gate reads these from the database anyway.
      isHalfPrice: !!halfPriceClaim,
      halfPriceCategory: halfPriceClaim?.category ?? null,
      holderDocument: halfPriceClaim?.document ?? null,
    });

    return this.ticketRepo.save(ticket);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
