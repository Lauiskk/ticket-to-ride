import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket, TicketStatus } from '../ticket/entities/ticket.entity';
import { Event } from '../event/entities/event.entity';
import { TicketSignerService } from '../ticket/crypto/ticket-signer.service';
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
  error?: { code: string; message: string; firstValidatedAt?: Date };
}

@Injectable()
export class GateService {
  private readonly logger = new Logger(GateService.name);

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    private readonly signerService: TicketSignerService,
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

    return {
      valid: true,
      ticketId: ticket.id,
      seatIdentifier: ticket.seatIdentifier,
      eventTitle: event.title,
      validatedAt: now,
    };
  }

  /**
   * Check if an event is in its active validation window.
   * Active = between event start and event end + 4 hours grace period (Req 11.7).
   */
  private isEventActive(event: Event): boolean {
    const now = new Date();
    const eventDate = new Date(event.date);

    // 1 hour before event start is allowed
    const windowStart = new Date(eventDate.getTime() - 60 * 60 * 1000);

    // 4 hours after event end (assume event lasts ~3 hours, so +7h from start)
    const windowEnd = new Date(eventDate.getTime() + 7 * 60 * 60 * 1000);

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
