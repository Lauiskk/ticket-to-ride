import { Repository } from 'typeorm';
import { GateService } from './gate.service';
import { Ticket, TicketStatus } from '../ticket/entities/ticket.entity';
import { Event, EventStatus } from '../event/entities/event.entity';
import { TicketSignerService } from '../ticket/crypto/ticket-signer.service';
import { AppError } from '../shared/errors';

/**
 * Tests for SPEC_CP11 — portaria isolada e operável.
 * docs/plan/SPEC_CP11_portaria_isolada.md
 */

const GATE_USER = 'gate-user-1';
const LIVE_EVENT_ID = '11111111-1111-4111-8111-111111111111';
const FUTURE_EVENT_ID = '22222222-2222-4222-8222-222222222222';

describe('GateService (SPEC_CP11)', () => {
  let service: GateService;
  let ticketRepo: jest.Mocked<Repository<Ticket>>;
  let eventRepo: jest.Mocked<Repository<Event>>;
  let signer: TicketSignerService;

  /** Event that started 30 minutes ago — inside the entry window. */
  const liveEvent = () =>
    ({
      id: LIVE_EVENT_ID,
      title: 'Sessão ao vivo',
      date: new Date(Date.now() - 30 * 60 * 1000),
      status: EventStatus.PUBLISHED,
    }) as Event;

  /** Event 7 days out — outside the entry window. */
  const futureEvent = () =>
    ({
      id: FUTURE_EVENT_ID,
      title: 'Evento futuro',
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: EventStatus.PUBLISHED,
    }) as Event;

  const signedQr = (ticketId: string, eventId: string) => {
    const payload = {
      ticketId,
      eventId,
      seatIdentifier: 'Plateia-1-1',
      issuedAt: Math.floor(Date.now() / 1000),
    };
    return signer.encodeQrPayload(payload, signer.sign(payload));
  };

  beforeEach(() => {
    signer = new TicketSignerService({
      get: jest.fn().mockReturnValue('test-secret-key-minimum-32-chars-long'),
    } as any);

    ticketRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (t) => t as Ticket),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<Repository<Ticket>>;

    eventRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<Repository<Event>>;

    service = new GateService(ticketRepo, eventRepo, signer);
  });

  // ─── AC-6 ───────────────────────────────────────────────────────────────────

  describe('AC-6: ingresso válido em evento ao vivo libera a entrada', () => {
    it('retorna valid true e marca o ingresso como usado', async () => {
      eventRepo.findOne.mockResolvedValue(liveEvent());
      ticketRepo.findOne.mockResolvedValue({
        id: 'ticket-1',
        seatIdentifier: 'Plateia-1-1',
        status: TicketStatus.ACTIVE,
      } as Ticket);

      const result = await service.validateTicket(
        signedQr('ticket-1', LIVE_EVENT_ID),
        GATE_USER,
        LIVE_EVENT_ID,
      );

      expect(result.valid).toBe(true);
      expect(result.seatIdentifier).toBe('Plateia-1-1');
      expect(ticketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TicketStatus.USED,
          validatedByGateId: GATE_USER,
        }),
      );
    });
  });

  // ─── SPEC_CP12 AC-6 / AC-7 ──────────────────────────────────────────────────

  describe('SPEC_CP12 — meia-entrada na portaria', () => {
    it('AC-6: ingresso de meia traz categoria e documento MASCARADO', async () => {
      eventRepo.findOne.mockResolvedValue(liveEvent());
      ticketRepo.findOne.mockResolvedValue({
        id: 'ticket-1',
        seatIdentifier: 'Plateia-1-1',
        status: TicketStatus.ACTIVE,
        isHalfPrice: true,
        halfPriceCategory: 'student',
        holderDocument: '2024001234',
      } as Ticket);

      const result = await service.validateTicket(
        signedQr('ticket-1', LIVE_EVENT_ID),
        GATE_USER,
        LIVE_EVENT_ID,
      );

      expect(result.isHalfPrice).toBe(true);
      expect(result.halfPriceCategory).toBe('student');
      // Nunca o número inteiro
      expect(result.holderDocumentMasked).not.toBe('2024001234');
      expect(result.holderDocumentMasked).toContain('•');
      // Mas com dígitos suficientes para conferir contra o documento físico
      expect(result.holderDocumentMasked).toMatch(/\d{4}/);
    });

    it('AC-7: ingresso inteiro não expõe nenhum dado de documento', async () => {
      eventRepo.findOne.mockResolvedValue(liveEvent());
      ticketRepo.findOne.mockResolvedValue({
        id: 'ticket-2',
        seatIdentifier: 'Plateia-1-2',
        status: TicketStatus.ACTIVE,
        isHalfPrice: false,
        halfPriceCategory: null,
        holderDocument: null,
      } as Ticket);

      const result = await service.validateTicket(
        signedQr('ticket-2', LIVE_EVENT_ID),
        GATE_USER,
        LIVE_EVENT_ID,
      );

      expect(result.isHalfPrice).toBe(false);
      expect(result.halfPriceCategory).toBeNull();
      expect(result.holderDocumentMasked).toBeNull();
    });

    it('mascara documentos curtos sem vazar nada', () => {
      expect(GateService.maskDocument('123')).toBe('•••');
      expect(GateService.maskDocument(null)).toBeNull();
    });
  });

  // ─── AC-7 ───────────────────────────────────────────────────────────────────

  describe('AC-7: mesmo ingresso duas vezes', () => {
    it('recusa com TICKET_ALREADY_USED e não regrava a validação', async () => {
      eventRepo.findOne.mockResolvedValue(liveEvent());
      ticketRepo.findOne.mockResolvedValue({
        id: 'ticket-1',
        seatIdentifier: 'Plateia-1-1',
        status: TicketStatus.USED,
        validatedAt: new Date('2026-08-11T20:00:00Z'),
      } as Ticket);

      await expect(
        service.validateTicket(signedQr('ticket-1', LIVE_EVENT_ID), GATE_USER, LIVE_EVENT_ID),
      ).rejects.toMatchObject({ code: 'TICKET_ALREADY_USED' });

      expect(ticketRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── AC-8 ───────────────────────────────────────────────────────────────────

  describe('AC-8: ingresso de outro evento', () => {
    it('recusa como INVALID_TICKET sem consumir o ingresso', async () => {
      eventRepo.findOne.mockResolvedValue(liveEvent());

      await expect(
        service.validateTicket(
          signedQr('ticket-1', FUTURE_EVENT_ID), // assinado para outro evento
          GATE_USER,
          LIVE_EVENT_ID,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_TICKET' });

      expect(ticketRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── AC-E1 ──────────────────────────────────────────────────────────────────

  describe('AC-E1: evento fora da janela de entrada', () => {
    it('recusa com EVENT_NOT_ACTIVE e mantém o ingresso ativo', async () => {
      eventRepo.findOne.mockResolvedValue(futureEvent());
      ticketRepo.findOne.mockResolvedValue({
        id: 'ticket-1',
        status: TicketStatus.ACTIVE,
      } as Ticket);

      await expect(
        service.validateTicket(
          signedQr('ticket-1', FUTURE_EVENT_ID),
          GATE_USER,
          FUTURE_EVENT_ID,
        ),
      ).rejects.toMatchObject({ code: 'EVENT_NOT_ACTIVE' });

      // Regra 11.7: status NÃO muda
      expect(ticketRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── AC-E2 ──────────────────────────────────────────────────────────────────

  describe('AC-E2: QR adulterado', () => {
    it('recusa como INVALID_TICKET sem consultar evento nem ingresso', async () => {
      const valid = signedQr('ticket-1', LIVE_EVENT_ID);
      const tampered = valid.replace('Plateia-1-1', 'Plateia-1-2');

      await expect(
        service.validateTicket(tampered, GATE_USER, LIVE_EVENT_ID),
      ).rejects.toBeInstanceOf(AppError);

      expect(ticketRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── AC-9 / AC-E3 ───────────────────────────────────────────────────────────

  describe('AC-9: agenda operacional da portaria', () => {
    it('traz entryOpen e as contagens de ingressos por evento', async () => {
      eventRepo.find.mockResolvedValue([liveEvent(), futureEvent()]);
      ticketRepo.count.mockImplementation(async (options: any) => {
        const where = options?.where ?? {};
        if (where.eventId !== LIVE_EVENT_ID) return 0; // AC-E3: evento sem ingressos
        return where.status === TicketStatus.USED ? 3 : 10;
      });

      const agenda = await service.listEventsForGate();

      const live = agenda.find((e) => e.id === LIVE_EVENT_ID)!;
      expect(live.entryOpen).toBe(true);
      expect(live.ticketsIssued).toBe(10);
      expect(live.ticketsValidated).toBe(3);

      const future = agenda.find((e) => e.id === FUTURE_EVENT_ID)!;
      expect(future.entryOpen).toBe(false);
      expect(future.ticketsIssued).toBe(0);
      expect(future.ticketsValidated).toBe(0);
    });

    it('coloca os eventos abertos para entrada no topo', async () => {
      eventRepo.find.mockResolvedValue([futureEvent(), liveEvent()]);

      const agenda = await service.listEventsForGate();

      expect(agenda[0].id).toBe(LIVE_EVENT_ID);
    });
  });
});
