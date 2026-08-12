import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from '../user/entities/user.entity';
import { Event, EventStatus, SeatingType } from '../event/entities/event.entity';
import { Seat, SeatStatus } from '../event/entities/seat.entity';

/**
 * Seed service that populates the database with initial development data.
 *
 * Creates:
 * - 1 Organizer (organizer@ticket.dev / Organizer123!)
 * - 2 Clients (client1@ticket.dev / Client123!, client2@ticket.dev / Client123!)
 * - 1 Gate operator (gate@ticket.dev / Gate123!)
 * - 15 Published events across multiple categories and cities
 *
 * Idempotent: skips if users already exist (count > 0).
 * Uses bcryptjs for password hashing.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  /**
   * Seed a freshly deployed environment on boot when `RUN_SEED_ON_BOOT=true`.
   *
   * The production image ships only `dist/`, so `npm run seed` (ts-node over
   * `src/`) does not exist there — without this hook a deployed database stays
   * empty and there is nothing to evaluate. Safe to leave on: `run()` returns
   * early when any user already exists.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.RUN_SEED_ON_BOOT !== 'true') return;

    try {
      await this.run();
    } catch (err) {
      // Never take the API down over seeding — log and serve
      this.logger.error(
        `Boot seed failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    @InjectRepository(Seat)
    private readonly seatRepo: Repository<Seat>,
  ) {}

  async run(): Promise<void> {
    const userCount = await this.userRepo.count();
    if (userCount > 0) {
      this.logger.log('Database already seeded (users exist). Skipping.');
      return;
    }

    this.logger.log('Seeding database...');

    // ─── Create Users ───────────────────────────────────────────────────
    const organizer = await this.createUser(
      'organizer@ticket.dev',
      'Organizer123!',
      'Organizador Demo',
      UserRole.ORGANIZER,
    );

    await this.createUser(
      'client1@ticket.dev',
      'Client123!',
      'Cliente Um',
      UserRole.CLIENT,
    );

    await this.createUser(
      'client2@ticket.dev',
      'Client123!',
      'Cliente Dois',
      UserRole.CLIENT,
    );

    await this.createUser(
      'gate@ticket.dev',
      'Gate123!',
      'Portaria Demo',
      UserRole.GATE,
    );

    this.logger.log('4 users created.');

    // ─── Helper: date offset from now ───────────────────────────────────
    const daysFromNow = (days: number): Date => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d;
    };

    /** Minutes offset from now — for the live event (SPEC_CP11 RF-5). */
    const minutesFromNow = (minutes: number): Date => {
      const d = new Date();
      d.setMinutes(d.getMinutes() + minutes);
      return d;
    };

    // ─── Event Definitions ──────────────────────────────────────────────
    const eventDefinitions = [
      // ── LIVE NOW (1) ──────────────────────────────────────────────────
      // Started 30 min ago, so its entry window (-1h to +7h) is open the
      // moment the seed runs. Without this, every other seeded event is days
      // away and the gate can only ever answer EVENT_NOT_ACTIVE — the whole
      // validation flow would be undemonstrable on the day of the review.
      {
        title: 'Sessão Cult — Cidade de Deus (ACONTECENDO AGORA)',
        description:
          'Sessão em cartaz neste momento, semeada para demonstrar o fluxo completo de portaria: comprar, gerar o QR, validar na entrada e receber "já utilizado" na segunda leitura.',
        date: minutesFromNow(-30),
        venueName: 'Cine Belas Artes',
        venueAddress: 'R. da Consolação, 2423 - Cerqueira César, São Paulo - SP',
        venueLat: -23.5505,
        venueLng: -46.6333,
        venueCity: 'São Paulo',
        capacity: 60,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [{ name: 'Sala 1', rows: 6, seatsPerRow: 10 }],
        },
        price: 30.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },

      // ── CONCERTS / SHOWS (3) ──────────────────────────────────────────
      {
        title: 'Anitta - Baile Funk Experience',
        description:
          'Show exclusivo da Anitta com repertório completo dos maiores hits. Produção internacional com dançarinos e efeitos visuais de última geração.',
        date: daysFromNow(7),
        venueName: 'Allianz Parque',
        venueAddress: 'Av. Francisco Matarazzo, 1705 - Água Branca, São Paulo - SP',
        venueLat: -23.5505,
        venueLng: -46.6333,
        venueCity: 'São Paulo',
        capacity: 500,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [
            { name: 'Pista VIP', rows: 10, seatsPerRow: 20 },
            { name: 'Cadeira Superior', rows: 10, seatsPerRow: 15 },
          ],
        },
        price: 280.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'Jorge & Mateus - Sertanejo na Praia',
        description:
          'Dupla sertaneja mais querida do Brasil em show à beira-mar. Uma noite de modão, sofrência e hits que marcaram gerações.',
        date: daysFromNow(14),
        venueName: 'Marina da Glória',
        venueAddress: 'Av. Infante Dom Henrique, s/n - Glória, Rio de Janeiro - RJ',
        venueLat: -22.9068,
        venueLng: -43.1729,
        venueCity: 'Rio de Janeiro',
        capacity: 300,
        seatingType: SeatingType.GENERAL_ADMISSION,
        seatMapConfig: {
          generalAdmission: { name: 'Área Geral', capacity: 300 },
        },
        price: 180.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'Alceu Valença - Ao Vivo em Recife',
        description:
          'O mestre da MPB pernambucana em noite especial no Marco Zero. Frevo, maracatu e canções que embalam o nordeste há décadas.',
        date: daysFromNow(21),
        venueName: 'Marco Zero',
        venueAddress: 'Praça Rio Branco - Recife Antigo, Recife - PE',
        venueLat: -8.0476,
        venueLng: -34.8770,
        venueCity: 'Recife',
        capacity: 400,
        seatingType: SeatingType.GENERAL_ADMISSION,
        seatMapConfig: {
          generalAdmission: { name: 'Área Livre', capacity: 400 },
        },
        price: 90.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },

      // ── CINEMA / MOVIE SESSIONS (3) ───────────────────────────────────
      {
        title: 'Pré-Estreia: O Último Samurai Brasileiro',
        description:
          'Sessão exclusiva de pré-estreia do filme brasileiro mais aguardado do ano. Presença confirmada do elenco para fotos e autógrafos após a sessão.',
        date: daysFromNow(5),
        venueName: 'Cinemark Eldorado',
        venueAddress: 'Av. Rebouças, 3970 - Pinheiros, São Paulo - SP',
        venueLat: -23.5505,
        venueLng: -46.6333,
        venueCity: 'São Paulo',
        capacity: 200,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [
            { name: 'Sala IMAX', rows: 10, seatsPerRow: 20 },
          ],
        },
        price: 55.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'Maratona Ghibli - Noite Especial',
        description:
          'Maratona com 3 filmes do Studio Ghibli em tela grande: A Viagem de Chihiro, Princesa Mononoke e Meu Amigo Totoro. Inclui pipoca temática.',
        date: daysFromNow(10),
        venueName: 'Cine Roxy',
        venueAddress: 'Av. Nossa Sra. de Copacabana, 945 - Copacabana, Rio de Janeiro - RJ',
        venueLat: -22.9068,
        venueLng: -43.1729,
        venueCity: 'Rio de Janeiro',
        capacity: 150,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [
            { name: 'Sala Principal', rows: 10, seatsPerRow: 15 },
          ],
        },
        price: 45.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'Cinema ao Ar Livre - Clássicos Nacionais',
        description:
          'Sessão gratuita ao ar livre com exibição de Cidade de Deus remasterizado em 4K. Traga sua cadeira ou canga!',
        date: daysFromNow(8),
        venueName: 'Praça da Liberdade',
        venueAddress: 'Praça da Liberdade, s/n - Funcionários, Belo Horizonte - MG',
        venueLat: -19.9167,
        venueLng: -43.9345,
        venueCity: 'Belo Horizonte',
        capacity: 250,
        seatingType: SeatingType.GENERAL_ADMISSION,
        seatMapConfig: {
          generalAdmission: { name: 'Área Livre', capacity: 250 },
        },
        price: 25.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },

      // ── THEATER / COMEDY (3) ──────────────────────────────────────────
      {
        title: 'Fábio Porchat - Stand-Up Inédito',
        description:
          'Novo show solo do Fábio Porchat com piadas 100% inéditas. Duas horas de risadas garantidas sobre a vida adulta no Brasil.',
        date: daysFromNow(12),
        venueName: 'Teatro Positivo',
        venueAddress: 'R. Prof. Pedro Viriato Parigot de Souza, 5300 - Cidade Industrial, Curitiba - PR',
        venueLat: -25.4284,
        venueLng: -49.2733,
        venueCity: 'Curitiba',
        capacity: 300,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [
            { name: 'Plateia', rows: 15, seatsPerRow: 14 },
            { name: 'Balcão', rows: 5, seatsPerRow: 12 },
          ],
        },
        price: 120.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'O Fantasma da Ópera - Musical',
        description:
          'A montagem brasileira do clássico musical da Broadway. Figurinos deslumbrantes, cenografia imersiva e vozes que arrepiam.',
        date: daysFromNow(20),
        venueName: 'Teatro Alfa',
        venueAddress: 'R. Bento Branco de Andrade Filho, 722 - Santo Amaro, São Paulo - SP',
        venueLat: -23.5505,
        venueLng: -46.6333,
        venueCity: 'São Paulo',
        capacity: 350,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [
            { name: 'Plateia Central', rows: 15, seatsPerRow: 16 },
            { name: 'Mezanino', rows: 5, seatsPerRow: 11 },
          ],
        },
        price: 250.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'Whindersson Nunes - Tour Despedida',
        description:
          'Última turnê de stand-up do Whindersson antes de se dedicar ao cinema. Momentos marcantes da carreira em formato de despedida cômica.',
        date: daysFromNow(30),
        venueName: 'Auditório Araújo Vianna',
        venueAddress: 'Av. Osvaldo Aranha, s/n - Bom Fim, Porto Alegre - RS',
        venueLat: -30.0346,
        venueLng: -51.2177,
        venueCity: 'Porto Alegre',
        capacity: 280,
        seatingType: SeatingType.GENERAL_ADMISSION,
        seatMapConfig: {
          generalAdmission: { name: 'Pista', capacity: 280 },
        },
        price: 150.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },

      // ── FESTIVALS (3) ─────────────────────────────────────────────────
      {
        title: 'Lollapalooza Brasil 2025 - Day 1',
        description:
          'Primeiro dia do maior festival de música alternativa do Brasil. Line-up com artistas internacionais e nacionais em 4 palcos simultâneos.',
        date: daysFromNow(45),
        venueName: 'Autódromo de Interlagos',
        venueAddress: 'Av. Sen. Teotônio Vilela, 261 - Interlagos, São Paulo - SP',
        venueLat: -23.5505,
        venueLng: -46.6333,
        venueCity: 'São Paulo',
        capacity: 1000,
        seatingType: SeatingType.GENERAL_ADMISSION,
        seatMapConfig: {
          generalAdmission: { name: 'Pista Geral', capacity: 1000 },
        },
        price: 300.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'Festival de Inverno de BH',
        description:
          'Festival cultural ao ar livre com shows, gastronomia e artesanato local. Edição especial com palco dedicado a MPB e jazz.',
        date: daysFromNow(35),
        venueName: 'Parque Municipal',
        venueAddress: 'Av. Afonso Pena, 1377 - Centro, Belo Horizonte - MG',
        venueLat: -19.9167,
        venueLng: -43.9345,
        venueCity: 'Belo Horizonte',
        capacity: 600,
        seatingType: SeatingType.GENERAL_ADMISSION,
        seatMapConfig: {
          generalAdmission: { name: 'Área do Festival', capacity: 600 },
        },
        price: 75.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'Planeta Atlântida RS',
        description:
          'O maior festival de verão do sul do Brasil. Dois dias de música eletrônica, rock e pop na praia de Atlântida.',
        date: daysFromNow(55),
        venueName: 'Saba - Sociedade Atlântida',
        venueAddress: 'Av. José Bonifácio, s/n - Atlântida, Xangri-lá - RS',
        venueLat: -30.0346,
        venueLng: -51.2177,
        venueCity: 'Porto Alegre',
        capacity: 800,
        seatingType: SeatingType.GENERAL_ADMISSION,
        seatMapConfig: {
          generalAdmission: { name: 'Arena', capacity: 800 },
        },
        price: 220.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },

      // ── OTHER EVENTS (3) ──────────────────────────────────────────────
      {
        title: 'Orquestra Sinfônica de SP - Beethoven',
        description:
          'Programa especial com a 5ª e 9ª sinfonias de Beethoven. Regência do maestro convidado e participação do coral da OSESP.',
        date: daysFromNow(18),
        venueName: 'Sala São Paulo',
        venueAddress: 'Praça Júlio Prestes, 16 - Campos Elíseos, São Paulo - SP',
        venueLat: -23.5505,
        venueLng: -46.6333,
        venueCity: 'São Paulo',
        capacity: 400,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [
            { name: 'Plateia', rows: 20, seatsPerRow: 15 },
            { name: 'Balcão Nobre', rows: 5, seatsPerRow: 10 },
          ],
        },
        price: 200.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'UFC Fight Night - Curitiba',
        description:
          'Card completo com lutadores brasileiros nos combates principais. Evento imperdível para fãs de MMA com 12 lutas confirmadas.',
        date: daysFromNow(40),
        venueName: 'Arena da Baixada',
        venueAddress: 'R. Buenos Aires, 1260 - Água Verde, Curitiba - PR',
        venueLat: -25.4284,
        venueLng: -49.2733,
        venueCity: 'Curitiba',
        capacity: 500,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [
            { name: 'Ringside', rows: 5, seatsPerRow: 20 },
            { name: 'Arquibancada Inferior', rows: 10, seatsPerRow: 20 },
            { name: 'Arquibancada Superior', rows: 10, seatsPerRow: 10 },
          ],
        },
        price: 250.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
      {
        title: 'TEDx Recife - Inovação & Futuro',
        description:
          'Edição 2025 do TEDx Recife com palestrantes nacionais e internacionais. Temas: IA, sustentabilidade, economia criativa e educação.',
        date: daysFromNow(25),
        venueName: 'Centro de Convenções de Pernambuco',
        venueAddress: 'Av. Prof. Andrade Bezerra, s/n - Salgadinho, Olinda - PE',
        venueLat: -8.0476,
        venueLng: -34.8770,
        venueCity: 'Recife',
        capacity: 350,
        seatingType: SeatingType.NUMBERED,
        seatMapConfig: {
          sections: [
            { name: 'Plateia', rows: 15, seatsPerRow: 18 },
            { name: 'Camarote', rows: 4, seatsPerRow: 10 },
          ],
        },
        price: 160.0,
        currency: 'BRL',
        status: EventStatus.PUBLISHED,
      },
    ];

    // ─── Create Events & Seats ──────────────────────────────────────────
    let totalSeatsCreated = 0;

    for (const def of eventDefinitions) {
      const event = this.eventRepo.create({
        organizerId: organizer.id,
        ...def,
        externalSource: 'seed',
      });

      const savedEvent = await this.eventRepo.save(event);
      this.logger.log(`Event "${savedEvent.title}" created.`);

      // ─── Create Seats ───────────────────────────────────────────────
      const seats: Partial<Seat>[] = [];

      if (def.seatingType === SeatingType.NUMBERED && def.seatMapConfig.sections) {
        for (const section of def.seatMapConfig.sections) {
          for (let r = 1; r <= section.rows; r++) {
            for (let s = 1; s <= section.seatsPerRow; s++) {
              seats.push({
                eventId: savedEvent.id,
                section: section.name,
                row: `${r}`,
                number: `${s}`,
                status: SeatStatus.AVAILABLE,
              });
            }
          }
        }
      } else if (def.seatingType === SeatingType.GENERAL_ADMISSION && def.seatMapConfig.generalAdmission) {
        const ga = def.seatMapConfig.generalAdmission;
        for (let i = 1; i <= ga.capacity; i++) {
          seats.push({
            eventId: savedEvent.id,
            section: ga.name,
            row: null,
            number: `${i}`,
            status: SeatStatus.AVAILABLE,
          });
        }
      }

      // Batch insert seats (500 per batch)
      for (let i = 0; i < seats.length; i += 500) {
        const batch = seats.slice(i, i + 500);
        await this.seatRepo.save(batch);
      }

      totalSeatsCreated += seats.length;
      this.logger.log(`  → ${seats.length} seats created for "${savedEvent.title}".`);
    }

    this.logger.log(`Seed completed successfully. ${eventDefinitions.length} events, ${totalSeatsCreated} total seats.`);
  }

  private async createUser(
    email: string,
    password: string,
    name: string,
    role: UserRole,
  ): Promise<User> {
    const passwordHash = await bcrypt.hash(password, 12);

    const user = this.userRepo.create({
      email,
      passwordHash,
      name,
      role,
      totpEnabled: false,
    });

    return this.userRepo.save(user);
  }
}
