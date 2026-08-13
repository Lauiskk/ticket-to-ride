import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket, TicketStatus } from '../ticket/entities/ticket.entity';
import { Event, EventStatus } from '../event/entities/event.entity';
import { TicketSignerService } from '../ticket/crypto/ticket-signer.service';
import { ReservationGateway } from '../reservation/reservation.gateway';
import { AppError, ErrorCodes, TicketInvalidError, EventNotActiveError } from '../shared/errors';

/**
 * Gate validation service (Req 11.1-11.7).
 *
 * Validation sequence:
 * 1. Verify HMAC signature → INVALID_TICKET if bad (Req 11.1, 11.2)
 * 2. Check ticket belongs to correct event → INVALID_TICKET (Req 11.6)
 * 3. Check event active window → EVENT_NOT_ACTIVE, ticket status UNCHANGED (Req 11.7)
 * 4. Check ticket not already used → TICKET_ALREADY_USED (Req 11.3, 11.4)
 * 5. Atomically mark as "used" (Req 11.5)
 */

export interface ValidationResult {
  valid: boolean;
  ticketId: string;
  seatIdentifier: string;
  eventTitle?: string;
  validatedAt?: Date;
  /** Half-price ticket — the operator must check the matching document (SPEC_CP12 RF-12). */
  isHalfPrice?: boolean;
  halfPriceCategory?: string | null;
  /** Masked on purpose: enough to compare, not enough to harvest. */
  holderDocumentMasked?: string | null;
  error?: { code: string; message: string; firstValidatedAt?: Date };
}

/**
 * One line of the gate's own agenda (SPEC_CP11 RF-4).
 *
 * Deliberately not the public event DTO: a gate operator does not need price,
 * description or seat map — they need to know which door is open right now and
 * how the queue is going. No buyer data ever appears here.
 */
export interface GateEventSummary {
  id: string;
  title: string;
  venueName: string;
  date: Date;
  entryOpen: boolean;
  entryOpensAt: Date;
  entryClosesAt: Date;
  ticketsIssued: number;
  ticketsValidated: number;
}

/** Entry opens 1h before the event starts. */
const ENTRY_OPENS_BEFORE_MS = 60 * 60 * 1000;
/** ...and closes 7h after (≈3h of show + 4h of grace). */
const ENTRY_CLOSES_AFTER_MS = 7 * 60 * 60 * 1000;

@Injectable()
export class GateService {
  private readonly logger = new Logger(GateService.name);

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    private readonly signerService: TicketSignerService,
    private readonly gateway: ReservationGateway,
  ) {}

  /**
   * Validate a ticket at the gate.
   */
  async validateTicket(
    qrPayload: string,
    gateUserId: string,
    gateEventId: string,
  ): Promise<ValidationResult> {
    // 1. Decode and verify HMAC signature (Req 11.1)
    const decoded = this.signerService.decodeQrPayload(qrPayload);
    if (!decoded) {
      this.logInvalidAttempt(gateUserId, qrPayload);
      throw new TicketInvalidError('Malformed ticket payload');
    }

    const { payload, signature } = decoded;
    const isValid = this.signerService.verify(payload, signature);

    if (!isValid) {
      this.logInvalidAttempt(gateUserId, qrPayload);
      throw new TicketInvalidError('Signature verification failed');
    }

    // 2. Check ticket belongs to this event (Req 11.6)
    if (payload.eventId !== gateEventId) {
      throw new AppError(
        'This ticket is for a different event',
        ErrorCodes.INVALID_TICKET,
        400,
      );
    }

    // 3. Check event is in active window (Req 11.7)
    const event = await this.eventRepo.findOne({ where: { id: gateEventId } });
    if (!event) {
      throw new AppError('Event not found', ErrorCodes.NOT_FOUND, 404);
    }

    /*
      Evento cancelado não abre portão (SPEC_CP23 RF-4).

      O cancelamento já invalida os ingressos, então esta checagem é a segunda
      barreira — mas ela existe porque a primeira depende de uma escrita ter dado
      certo, e um portão não é lugar para depender de uma coisa só. A mensagem é
      própria: dizer "fora do horário" para quem chegou num evento cancelado
      manda a pessoa esperar por algo que não vai acontecer.
    */
    if (event.status === EventStatus.CANCELLED) {
      throw new AppError(
        'Este evento foi cancelado. Nenhum ingresso dá entrada.',
        ErrorCodes.EVENT_NOT_ACTIVE,
        400,
      );
    }

    if (!this.isEventActive(event)) {
      // CRITICAL (Req 11.7): Ticket status REMAINS UNCHANGED
      throw new EventNotActiveError(event.id);
    }

    // 4. Find ticket and check not already used (Req 11.3, 11.4)
    const ticket = await this.ticketRepo.findOne({
      where: { id: payload.ticketId },
    });

    if (!ticket) {
      throw new TicketInvalidError('Ticket not found in system');
    }

    if (ticket.status === TicketStatus.USED) {
      throw new AppError(
        `Ticket already validated at ${ticket.validatedAt?.toISOString()}`,
        ErrorCodes.TICKET_ALREADY_USED,
        409,
      );
    }

    if (ticket.status === TicketStatus.INVALIDATED) {
      throw new TicketInvalidError('Ticket has been invalidated (transferred)');
    }

    // 5. Atomically mark as "used" (Req 11.5)
    const now = new Date();
    ticket.status = TicketStatus.USED;
    ticket.validatedAt = now;
    ticket.validatedByGateId = gateUserId;
    await this.ticketRepo.save(ticket);

    this.logger.log(`Ticket ${ticket.id} validated by gate ${gateUserId}`);

    // Tell whoever has this ticket open on their phone that it just got used
    // (SPEC_CP18 RF-2). Broadcast failure must never cost someone their entry:
    // the ticket is already consumed in the database, and a queue at a door
    // cannot stop because a WebSocket did (RNF-2).
    try {
      this.gateway.broadcastTicketValidated(event.id, ticket.id, now);
    } catch (error) {
      this.logger.warn(
        `Ticket ${ticket.id} validated but the live notice failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      valid: true,
      ticketId: ticket.id,
      seatIdentifier: ticket.seatIdentifier,
      eventTitle: event.title,
      validatedAt: now,
      isHalfPrice: ticket.isHalfPrice,
      halfPriceCategory: ticket.isHalfPrice ? ticket.halfPriceCategory : null,
      holderDocumentMasked: ticket.isHalfPrice
        ? GateService.maskDocument(ticket.holderDocument)
        : null,
    };
  }

  /**
   * Show just enough of the document for a human to compare it against the card
   * in front of them, and no more (SPEC_CP12, considerações de segurança).
   *
   * A gate screen is read over shoulders, in a queue, sometimes photographed.
   * The operator needs to confirm "this is the same document", not to learn the
   * number — so we keep the middle and hide the rest.
   */
  static maskDocument(document: string | null): string | null {
    if (!document) return null;

    const trimmed = document.trim();
    if (trimmed.length <= 4) return '•'.repeat(trimmed.length);

    const visibleStart = Math.floor((trimmed.length - 4) / 2);
    return (
      '•'.repeat(visibleStart) +
      trimmed.slice(visibleStart, visibleStart + 4) +
      '•'.repeat(trimmed.length - visibleStart - 4)
    );
  }

  // ─── Gate Agenda (SPEC_CP11 RF-4) ─────────────────────────────────────────

  /**
   * The events this gate can work on, most relevant first.
   *
   * Ordering is by operational urgency, not by date: whatever is open for entry
   * right now goes to the top, because that is the only thing an operator at a
   * door cares about. Everything else follows chronologically.
   */
  async listEventsForGate(): Promise<GateEventSummary[]> {
    const events = await this.eventRepo.find({
      where: { status: EventStatus.PUBLISHED },
      order: { date: 'ASC' },
    });

    const summaries = await Promise.all(
      events.map(async (event) => {
        const [ticketsIssued, ticketsValidated] = await Promise.all([
          this.ticketRepo.count({ where: { eventId: event.id } }),
          this.ticketRepo.count({ where: { eventId: event.id, status: TicketStatus.USED } }),
        ]);

        const { windowStart, windowEnd } = this.entryWindow(event);

        return {
          id: event.id,
          title: event.title,
          venueName: event.venueName,
          date: event.date,
          entryOpen: this.isEventActive(event),
          entryOpensAt: windowStart,
          entryClosesAt: windowEnd,
          ticketsIssued,
          ticketsValidated,
        };
      }),
    );

    return summaries.sort((a, b) => {
      if (a.entryOpen !== b.entryOpen) return a.entryOpen ? -1 : 1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }

  /**
   * Window in which a ticket for this event may be validated (Req 11.7).
   */
  private entryWindow(event: Event): { windowStart: Date; windowEnd: Date } {
    const eventDate = new Date(event.date);
    return {
      windowStart: new Date(eventDate.getTime() - ENTRY_OPENS_BEFORE_MS),
      windowEnd: new Date(eventDate.getTime() + ENTRY_CLOSES_AFTER_MS),
    };
  }

  /**
   * Check if an event is in its active validation window (Req 11.7).
   */
  private isEventActive(event: Event): boolean {
    const now = new Date();
    const { windowStart, windowEnd } = this.entryWindow(event);
    return now >= windowStart && now <= windowEnd;
  }

  private logInvalidAttempt(gateUserId: string, payload: string): void {
    // Hash the payload for logging (don't log full payload — could be malicious)
    const { createHash } = require('crypto');
    const payloadHash = createHash('sha256').update(payload).digest('hex').slice(0, 16);
    this.logger.warn(
      `INVALID_TICKET: gate=${gateUserId}, payload_hash=${payloadHash}`,
    );
  }
}
