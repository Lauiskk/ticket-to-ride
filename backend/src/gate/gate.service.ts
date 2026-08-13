import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket, TicketStatus } from '../ticket/entities/ticket.entity';
import { Event, EventStatus } from '../event/entities/event.entity';
import { TicketSignerService } from '../ticket/crypto/ticket-signer.service';
import { ReservationGateway } from '../reservation/reservation.gateway';
import { AppError, ErrorCodes, TicketInvalidError, EventNotActiveError } from '../shared/errors';

/**
 * Validação na entrada. A ordem importa: assinatura, evento certo, janela de
 * entrada, ingresso ainda não usado — e só então a marcação atômica de uso.
 */

export interface ValidationResult {
  valid: boolean;
  ticketId: string;
  seatIdentifier: string;
  eventTitle?: string;
  validatedAt?: Date;
  /** Meia-entrada: o operador precisa conferir o documento. */
  isHalfPrice?: boolean;
  halfPriceCategory?: string | null;
  /** Mascarado de propósito: o bastante para comparar, não para copiar. */
  holderDocumentMasked?: string | null;
  error?: { code: string; message: string; firstValidatedAt?: Date };
}

/**
 * Uma linha da agenda da portaria. Não é o DTO público de propósito: quem está
 * na porta não precisa de preço nem mapa, precisa saber que porta está aberta.
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

  async validateTicket(
    qrPayload: string,
    gateUserId: string,
    gateEventId: string,
  ): Promise<ValidationResult> {
    // Assinatura primeiro: nada é consultado antes de o QR provar que é nosso
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

    if (payload.eventId !== gateEventId) {
      throw new AppError(
        'This ticket is for a different event',
        ErrorCodes.INVALID_TICKET,
        400,
      );
    }

    const event = await this.eventRepo.findOne({ where: { id: gateEventId } });
    if (!event) {
      throw new AppError('Event not found', ErrorCodes.NOT_FOUND, 404);
    }

    // Segunda barreira: o cancelamento já invalida os ingressos, mas isso
    // depende de uma escrita ter dado certo, e um portão não é lugar para
    // depender de uma coisa só. Mensagem própria — dizer "fora do horário" a
    // quem chegou num evento cancelado manda esperar pelo que não vai acontecer.
    if (event.status === EventStatus.CANCELLED) {
      throw new AppError(
        'Este evento foi cancelado. Nenhum ingresso dá entrada.',
        ErrorCodes.EVENT_NOT_ACTIVE,
        400,
      );
    }

    if (!this.isEventActive(event)) {
      // O status do ingresso NÃO muda: chegar cedo não queima a entrada
      throw new EventNotActiveError(event.id);
    }

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

    // Marcação atômica: o mesmo QR lido duas vezes só passa na primeira
    const now = new Date();
    ticket.status = TicketStatus.USED;
    ticket.validatedAt = now;
    ticket.validatedByGateId = gateUserId;
    await this.ticketRepo.save(ticket);

    this.logger.log(`Ticket ${ticket.id} validated by gate ${gateUserId}`);

    // Avisa quem está com o ingresso aberto no celular. Falha de transmissão
    // não pode custar a entrada de ninguém: o ingresso já foi consumido no
    // banco, e uma fila na porta não para porque um WebSocket parou.
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
   * Mostra o bastante do documento para comparar com o cartão na mão, e nada
   * além. Tela de portão é lida por cima do ombro, às vezes fotografada.
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

  /**
   * A agenda da portaria, ordenada por urgência e não por data: o que está com
   * a entrada aberta agora vai para o topo.
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

  private entryWindow(event: Event): { windowStart: Date; windowEnd: Date } {
    const eventDate = new Date(event.date);
    return {
      windowStart: new Date(eventDate.getTime() - ENTRY_OPENS_BEFORE_MS),
      windowEnd: new Date(eventDate.getTime() + ENTRY_CLOSES_AFTER_MS),
    };
  }

  private isEventActive(event: Event): boolean {
    const now = new Date();
    const { windowStart, windowEnd } = this.entryWindow(event);
    return now >= windowStart && now <= windowEnd;
  }

  private logInvalidAttempt(gateUserId: string, payload: string): void {
    // Só o hash vai para o log: o conteúdo do QR é entrada de terceiro
    const { createHash } = require('crypto');
    const payloadHash = createHash('sha256').update(payload).digest('hex').slice(0, 16);
    this.logger.warn(
      `INVALID_TICKET: gate=${gateUserId}, payload_hash=${payloadHash}`,
    );
  }
}
