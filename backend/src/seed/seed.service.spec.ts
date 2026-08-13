import { SeedService } from './seed.service';
import { Repository } from 'typeorm';
import { User, UserRole } from '../user/entities/user.entity';
import { Event } from '../event/entities/event.entity';
import { Seat } from '../event/entities/seat.entity';

/**
 * Property test for seed idempotency (Property 32).
 *
 * Property 32: Seed Idempotency
 * For any database state, running the seed operation and then running it again
 * SHALL produce the identical database state — no duplicated records, no errors,
 * same row count for all seeded entities.
 *
 * NOTE: This is a unit test that mocks the repository layer since we can't
 * spin up a real PostgreSQL in CI without docker. Integration tests with
 * a real DB are covered separately.
 */

/**
 * Kept in sync with `eventDefinitions` in seed.service.ts. If you add an event
 * to the seed, update these two numbers — the assertions below are what stops
 * the seed from silently shrinking back to a single demo event.
 */
const SEEDED_EVENT_COUNT = 16;
const SEEDED_SEAT_COUNT = 6015;

describe('SeedService', () => {
  let seedService: SeedService;
  let userRepo: jest.Mocked<Repository<User>>;
  let eventRepo: jest.Mocked<Repository<Event>>;
  let seatRepo: jest.Mocked<Repository<Seat>>;
  let catalogService: any;

  beforeEach(() => {
    userRepo = {
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<User>>;

    eventRepo = {
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<Event>>;

    seatRepo = {
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<Seat>>;

    catalogService = {
      searchTicketmaster: jest.fn().mockRejectedValue(new Error('offline')),
      nowPlaying: jest.fn().mockRejectedValue(new Error('offline')),
    } as any;

    seedService = new SeedService(userRepo, eventRepo, seatRepo, catalogService);
  });

  describe('Property 32: Seed Idempotency', () => {
    it('skips seeding when users already exist (count > 0)', async () => {
      // Simulate database already has users
      userRepo.count.mockResolvedValue(4);

      await seedService.run();

      // Should NOT create any users, events, or seats
      expect(userRepo.create).not.toHaveBeenCalled();
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(eventRepo.create).not.toHaveBeenCalled();
      expect(eventRepo.save).not.toHaveBeenCalled();
      expect(seatRepo.save).not.toHaveBeenCalled();
    });

    it('seeds when database is empty (count === 0)', async () => {
      // Simulate empty database
      userRepo.count.mockResolvedValue(0);
      userRepo.create.mockImplementation((data) => ({ id: 'uuid', ...data }) as User);
      userRepo.save.mockImplementation(async (user) => ({ id: 'uuid-1', ...user }) as User);
      eventRepo.create.mockImplementation((data) => ({ id: 'event-1', ...data }) as Event);
      eventRepo.save.mockImplementation(async (event) => ({ id: 'event-1', ...event }) as Event);
      seatRepo.save.mockResolvedValue([] as any);

      await seedService.run();

      // Should create 4 users: organizer, 2 clients, gate
      expect(userRepo.save).toHaveBeenCalledTimes(4);

      // One save per seeded event
      expect(eventRepo.save).toHaveBeenCalledTimes(SEEDED_EVENT_COUNT);

      // Seats are written in batches of 500, so the call count tracks batches,
      // not events — assert on the seats actually produced instead.
      const totalSeats = seatRepo.save.mock.calls.reduce(
        (sum, call) => sum + (call[0] as Partial<Seat>[]).length,
        0,
      );
      expect(totalSeats).toBe(SEEDED_SEAT_COUNT);
    });

    it('running seed twice produces same result (idempotent)', async () => {
      // First run: empty DB
      userRepo.count.mockResolvedValueOnce(0);
      userRepo.create.mockImplementation((data) => ({ id: 'uuid', ...data }) as User);
      userRepo.save.mockImplementation(async (user) => ({ id: 'uuid-1', ...user }) as User);
      eventRepo.create.mockImplementation((data) => ({ id: 'event-1', ...data }) as Event);
      eventRepo.save.mockImplementation(async (event) => ({ id: 'event-1', ...event }) as Event);
      seatRepo.save.mockResolvedValue([] as any);

      await seedService.run();

      const firstRunUserSaves = userRepo.save.mock.calls.length;
      const firstRunEventSaves = eventRepo.save.mock.calls.length;
      const firstRunSeatSaves = seatRepo.save.mock.calls.length;

      // Second run: DB now has users (count > 0)
      userRepo.count.mockResolvedValueOnce(4);

      // Reset call tracking but keep mock implementations
      userRepo.save.mockClear();
      eventRepo.save.mockClear();
      seatRepo.save.mockClear();

      await seedService.run();

      // Second run should not create anything
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(eventRepo.save).not.toHaveBeenCalled();
      expect(seatRepo.save).not.toHaveBeenCalled();

      // First run created the expected counts
      expect(firstRunUserSaves).toBe(4);
      expect(firstRunEventSaves).toBe(SEEDED_EVENT_COUNT);
      expect(firstRunSeatSaves).toBeGreaterThan(0);
    });

    it('creates users with correct roles', async () => {
      userRepo.count.mockResolvedValue(0);
      const createdUsers: Partial<User>[] = [];
      userRepo.create.mockImplementation((data) => {
        createdUsers.push(data as Partial<User>);
        return { id: 'uuid', ...data } as User;
      });
      userRepo.save.mockImplementation(async (user) => ({ id: 'uuid-1', ...user }) as User);
      eventRepo.create.mockImplementation((data) => ({ id: 'event-1', ...data }) as Event);
      eventRepo.save.mockImplementation(async (event) => ({ id: 'event-1', ...event }) as Event);
      seatRepo.save.mockResolvedValue([] as any);

      await seedService.run();

      // Verify roles
      const roles = createdUsers.map((u) => u.role);
      expect(roles).toContain(UserRole.ORGANIZER);
      expect(roles).toContain(UserRole.CLIENT);
      expect(roles).toContain(UserRole.GATE);
      expect(roles.filter((r) => r === UserRole.CLIENT).length).toBe(2);
    });

    it('cria usuários com senha hasheada, nunca em texto puro', async () => {
      userRepo.count.mockResolvedValue(0);
      const savedUsers: User[] = [];
      userRepo.create.mockImplementation((data) => ({ id: 'uuid', ...data }) as User);
      userRepo.save.mockImplementation(async (user) => {
        savedUsers.push(user as User);
        return user as User;
      });
      eventRepo.create.mockImplementation((data) => ({ id: 'event-1', ...data }) as Event);
      eventRepo.save.mockImplementation(async (event) => ({ id: 'event-1', ...event }) as Event);
      seatRepo.save.mockResolvedValue([] as any);

      await seedService.run();

      for (const user of savedUsers) {
        expect(user.passwordHash).toBeDefined();
        expect(user.passwordHash).not.toBe('Organizer123!');
        expect(user.passwordHash).not.toBe('Client123!');
        expect(user.passwordHash).not.toBe('Gate123!');
        // bcrypt começa com $2a$ ou $2b$
        expect(user.passwordHash).toMatch(/^\$2[ab]\$/);
      }
    });
  });

  describe('AC-5: evento ao vivo para a portaria', () => {
    it('semeia exatamente 1 evento com a janela de entrada aberta agora', async () => {
      const savedEvents: Event[] = [];
      userRepo.count.mockResolvedValue(0);
      userRepo.create.mockImplementation((data) => ({ id: 'uuid', ...data }) as User);
      userRepo.save.mockImplementation(async (user) => ({ id: 'uuid-1', ...user }) as User);
      eventRepo.create.mockImplementation((data) => ({ id: 'event-1', ...data }) as Event);
      eventRepo.save.mockImplementation(async (event) => {
        savedEvents.push(event as Event);
        return { id: 'event-1', ...event } as Event;
      });
      seatRepo.save.mockResolvedValue([] as any);

      await seedService.run();

      // Entry window mirrors GateService: -1h to +7h around the start time
      const now = Date.now();
      const openForEntry = savedEvents.filter((e) => {
        const start = new Date(e.date).getTime();
        return now >= start - 60 * 60 * 1000 && now <= start + 7 * 60 * 60 * 1000;
      });

      expect(openForEntry).toHaveLength(1);
      expect(openForEntry[0].title).toMatch(/ACONTECENDO AGORA/);
    });
  });

  describe('eventos vindos das APIs externas', () => {
    const catalogItem = (over: Record<string, unknown> = {}) => ({
      externalId: 'tm-1',
      source: 'ticketmaster',
      name: 'Show Real',
      image: 'https://s1.ticketm.net/poster.jpg',
      category: 'Rock',
      description: 'Descrição vinda da API',
      date: new Date(Date.now() + 30 * 864e5).toISOString(),
      venue: 'Qualistage',
      venueCity: 'Rio de Janeiro',
      venueAddress: 'Av. Ayrton Senna, 3000',
      venueLat: -22.98,
      venueLng: -43.36,
      ...over,
    });

    const setupRepos = (saved: Event[]) => {
      userRepo.count.mockResolvedValue(0);
      userRepo.create.mockImplementation((data) => ({ id: 'uuid', ...data }) as User);
      userRepo.save.mockImplementation(async (u) => ({ id: 'uuid-1', ...u }) as User);
      eventRepo.create.mockImplementation((data) => ({ id: 'event-1', ...data }) as Event);
      eventRepo.save.mockImplementation(async (e) => {
        saved.push(e as Event);
        return { id: 'event-1', ...e } as Event;
      });
      seatRepo.save.mockResolvedValue([] as any);
    };

    it('usa o catálogo quando as APIs respondem, com imagem e local reais', async () => {
      const saved: Event[] = [];
      setupRepos(saved);
      catalogService.searchTicketmaster.mockResolvedValue({ items: [catalogItem()], total: 1 });
      catalogService.nowPlaying.mockResolvedValue({
        items: [catalogItem({ externalId: 'tmdb-1', source: 'tmdb', name: 'Filme Real', venue: null, venueCity: null, venueLat: null, venueLng: null })],
        total: 1,
      });

      await seedService.run();

      // 1 ao vivo (estático) + 1 show + 1 filme
      expect(saved).toHaveLength(3);

      const show = saved.find((e) => e.externalSource === 'ticketmaster')!;
      expect(show.title).toBe('Show Real');
      expect(show.imageUrl).toBe('https://s1.ticketm.net/poster.jpg');
      expect(show.venueName).toBe('Qualistage');
      expect(show.venueCity).toBe('Rio de Janeiro');
      expect(show.venueLat).toBeCloseTo(-22.98);

      const filme = saved.find((e) => e.externalSource === 'tmdb')!;
      expect(filme.title).toContain('Filme Real');
      expect(filme.imageUrl).toBeTruthy();
    });

    it('o evento ao vivo continua existindo mesmo com catálogo online', async () => {
      const saved: Event[] = [];
      setupRepos(saved);
      catalogService.searchTicketmaster.mockResolvedValue({ items: [catalogItem()], total: 1 });
      catalogService.nowPlaying.mockResolvedValue({ items: [], total: 0 });

      await seedService.run();

      const now = Date.now();
      const abertos = saved.filter((e) => {
        const start = new Date(e.date).getTime();
        return now >= start - 3600e3 && now <= start + 7 * 3600e3;
      });
      expect(abertos).toHaveLength(1);
      expect(abertos[0].title).toMatch(/ACONTECENDO AGORA/);
    });

    it('nunca deixa a API definir preço nem capacidade', async () => {
      const saved: Event[] = [];
      setupRepos(saved);
      catalogService.searchTicketmaster.mockResolvedValue({
        items: [catalogItem({ price: 9999, capacity: 1 } as any)],
        total: 1,
      });
      catalogService.nowPlaying.mockResolvedValue({ items: [], total: 0 });

      await seedService.run();

      const show = saved.find((e) => e.externalSource === 'ticketmaster')!;
      expect(show.price).not.toBe(9999);
      expect(show.capacity).toBeGreaterThan(1);
      // Capacidade bate com o mapa de assentos gerado
      const secoes = (show.seatMapConfig as any).sections;
      const total = secoes.reduce((s: number, x: any) => s + x.rows * x.seatsPerRow, 0);
      expect(show.capacity).toBe(total);
    });

    it('cai para a lista estática quando as duas APIs falham', async () => {
      const saved: Event[] = [];
      setupRepos(saved);
      catalogService.searchTicketmaster.mockRejectedValue(new Error('offline'));
      catalogService.nowPlaying.mockRejectedValue(new Error('offline'));

      await seedService.run();

      expect(saved).toHaveLength(SEEDED_EVENT_COUNT);
      expect(saved.every((e) => e.externalSource === 'seed')).toBe(true);
    });
  });
});
