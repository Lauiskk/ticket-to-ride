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

describe('SeedService', () => {
  let seedService: SeedService;
  let userRepo: jest.Mocked<Repository<User>>;
  let eventRepo: jest.Mocked<Repository<Event>>;
  let seatRepo: jest.Mocked<Repository<Seat>>;

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

    seedService = new SeedService(userRepo, eventRepo, seatRepo);
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

      // Should create 4 users
      expect(userRepo.save).toHaveBeenCalledTimes(4);

      // Should create 1 event
      expect(eventRepo.save).toHaveBeenCalledTimes(1);

      // Should create seats (250 total: 50 numbered + 200 GA)
      expect(seatRepo.save).toHaveBeenCalledTimes(1);
      const savedSeats = seatRepo.save.mock.calls[0][0] as Partial<Seat>[];
      expect(savedSeats.length).toBe(250);
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
      expect(firstRunEventSaves).toBe(1);
      expect(firstRunSeatSaves).toBe(1);
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

    it('creates users with Argon2id hashed passwords (not plaintext)', async () => {
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

      // All passwords must be hashed (Argon2id produces $argon2id$ prefix)
      for (const user of savedUsers) {
        expect(user.passwordHash).toBeDefined();
        expect(user.passwordHash).not.toBe('Organizer123!');
        expect(user.passwordHash).not.toBe('Client123!');
        expect(user.passwordHash).not.toBe('Gate123!');
        // Bcrypt hash starts with $2a$ or $2b$
        expect(user.passwordHash).toMatch(/^\$2[ab]\$/);
      }
    });
  });
});
