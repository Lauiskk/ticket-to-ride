import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SharingService } from './sharing.service';
import { SharingLink, SharingLinkStatus } from './entities/sharing-link.entity';
import { Ticket, TicketStatus } from '../ticket/entities/ticket.entity';
import { TicketSignerService } from '../ticket/crypto/ticket-signer.service';
import { QrGeneratorService } from '../ticket/qr/qr-generator.service';

/**
 * O link de compartilhamento (SPEC_CP22).
 *
 * Item obrigatório do desafio que hoje não fecha o ciclo: a URL sai malformada
 * em produção e não existe tela do outro lado.
 */

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const OWNER = 'owner-1';

function makeService({
  link,
  ticket,
  corsOrigin,
  frontendUrl,
}: {
  link?: Partial<SharingLink> | null;
  ticket?: Partial<Ticket> | null;
  corsOrigin?: string;
  frontendUrl?: string;
}) {
  const linkRepo = {
    findOne: jest.fn().mockResolvedValue(link ?? null),
    update: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
  } as unknown as jest.Mocked<Repository<SharingLink>>;

  const ticketRepo = {
    findOne: jest.fn().mockResolvedValue(ticket ?? null),
    save: jest.fn(async (x) => x),
    create: jest.fn((x) => x),
  } as unknown as jest.Mocked<Repository<Ticket>>;

  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'sharing.ttlHours') return 48;
      if (key === 'ticket.signingSecret') return 'segredo-de-teste-com-32-caracteres!!';
      if (key === 'cors.origin') return corsOrigin ?? fallback;
      if (key === 'frontendUrl') return frontendUrl;
      return fallback;
    }),
  } as unknown as ConfigService;

  const signer = new TicketSignerService({
    get: jest.fn().mockReturnValue('segredo-de-teste-com-32-caracteres!!'),
  } as any);

  const service = new SharingService(
    linkRepo,
    ticketRepo,
    signer,
    { generate: jest.fn().mockResolvedValue({ dataUrl: 'data:,', format: 'png' }) } as unknown as QrGeneratorService,
    config,
  );

  return { service, linkRepo, ticketRepo };
}

const activeLink = (over: Partial<SharingLink> = {}): Partial<SharingLink> => ({
  id: 'link-1',
  ticketId: TICKET_ID,
  creatorId: OWNER,
  token: 'a'.repeat(64),
  status: SharingLinkStatus.ACTIVE,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  ...over,
});

const activeTicket = (over: Partial<Ticket> = {}): Partial<Ticket> => ({
  id: TICKET_ID,
  ownerId: OWNER,
  status: TicketStatus.ACTIVE,
  seatIdentifier: 'Plateia-3-7',
  event: {
    title: 'Show de Teste',
    date: new Date('2026-09-01T23:00:00Z'),
    venueName: 'Casa de Testes',
    venueCity: 'São Paulo',
  } as any,
  ...over,
});

describe('SharingService — URL do link (AC-1)', () => {
  it('não usa a lista de CORS: nada de vírgula ou curinga no endereço', async () => {
    const { service } = makeService({
      ticket: activeTicket(),
      corsOrigin:
        'https://ticket-to-ride-psi.vercel.app,https://ticket-to-ride-*.vercel.app,http://localhost:5173',
      frontendUrl: 'https://ticket-to-ride-psi.vercel.app',
    });

    const { shareUrl } = await service.generateLink(TICKET_ID, OWNER);

    expect(shareUrl).not.toContain(',');
    expect(shareUrl).not.toContain('*');
    expect(shareUrl.startsWith('https://ticket-to-ride-psi.vercel.app/share/')).toBe(true);
  });

  it('sem FRONTEND_URL, usa a primeira origem concreta da lista', async () => {
    const { service } = makeService({
      ticket: activeTicket(),
      corsOrigin: 'https://real.app,https://preview-*.vercel.app',
    });

    const { shareUrl } = await service.generateLink(TICKET_ID, OWNER);

    expect(shareUrl.startsWith('https://real.app/share/')).toBe(true);
  });
});

describe('SharingService.preview (AC-2 a AC-7)', () => {
  it('AC-2: link ativo devolve evento e assento', async () => {
    const { service } = makeService({ link: activeLink(), ticket: activeTicket() });

    const preview = await service.preview('a'.repeat(64));

    expect(preview.status).toBe('active');
    expect(preview.seatIdentifier).toBe('Plateia-3-7');
    expect(preview.event?.title).toBe('Show de Teste');
    expect(preview.event?.venueCity).toBe('São Paulo');
  });

  it('AC-3: consultar não transfere nem consome o link', async () => {
    const { service, linkRepo, ticketRepo } = makeService({
      link: activeLink(),
      ticket: activeTicket(),
    });

    await service.preview('a'.repeat(64));

    expect(linkRepo.save).not.toHaveBeenCalled();
    expect(ticketRepo.save).not.toHaveBeenCalled();
  });

  it('AC-4: link já usado se identifica como usado', async () => {
    const { service } = makeService({
      link: activeLink({ status: SharingLinkStatus.USED }),
      ticket: activeTicket(),
    });

    expect((await service.preview('a'.repeat(64))).status).toBe('used');
  });

  it('AC-5: link vencido se identifica como expirado', async () => {
    const { service } = makeService({
      link: activeLink({ expiresAt: new Date(Date.now() - 1000) }),
      ticket: activeTicket(),
    });

    expect((await service.preview('a'.repeat(64))).status).toBe('expired');
  });

  it('AC-6: token inexistente responde 404', async () => {
    const { service } = makeService({ link: null });

    await expect(service.preview('nao-existe')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('AC-E1: ingresso já utilizado não é mais transferível', async () => {
    const { service } = makeService({
      link: activeLink(),
      ticket: activeTicket({ status: TicketStatus.USED }),
    });

    expect((await service.preview('a'.repeat(64))).status).toBe('not_transferable');
  });

  it('AC-7: a prévia não carrega dado de pessoa nenhuma', async () => {
    const { service } = makeService({
      link: activeLink(),
      ticket: activeTicket({ holderDocument: '12345678900' } as Partial<Ticket>),
    });

    const serializado = JSON.stringify(await service.preview('a'.repeat(64)));

    expect(serializado).not.toContain('12345678900');
    expect(serializado).not.toContain(OWNER);
    expect(serializado.toLowerCase()).not.toContain('email');
  });
});
