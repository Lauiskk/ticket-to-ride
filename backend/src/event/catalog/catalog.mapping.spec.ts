import { TicketmasterClient } from './ticketmaster.client';
import { TmdbClient } from './tmdb.client';

/**
 * Tests for SPEC_CP13 — mapeamento das APIs externas.
 * Referência dos formatos: SDD/08-anexos/API_TICKETMASTER_TMDB.md
 *
 * Os payloads abaixo são recortes de RESPOSTAS REAIS das duas APIs (2026-08-11),
 * incluindo as armadilhas observadas: lat/lng como string, `city` ausente,
 * `priceRanges` ausente, imagens fora de ordem.
 */

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as any;

describe('TicketmasterClient (SPEC_CP13)', () => {
  let client: TicketmasterClient;
  let lastUrl: string;

  /** Real response shape, trimmed to the fields we map. */
  const tmResponse = {
    page: { totalElements: 142 },
    _embedded: {
      events: [
        {
          id: 'ZFIMVHtnMZ17kbx_',
          name: 'Sticky Fingers - Rio de Janeiro',
          info: 'Show de rock australiano',
          dates: { start: { dateTime: '2026-08-12T00:00:00Z', localDate: '2026-08-11' } },
          classifications: [{ segment: { name: 'Music' }, genre: { name: 'Rock' } }],
          images: [
            { ratio: '16_9', width: 100, height: 56, url: 'http://img/tiny.jpg' },
            { ratio: '3_2', width: 4000, height: 2667, url: 'http://img/wrong-ratio.jpg' },
            { ratio: '16_9', width: 2048, height: 1152, url: 'http://img/best.jpg' },
          ],
          _embedded: {
            venues: [
              {
                name: 'Qualistage',
                city: { name: 'Rio de Janeiro' },
                address: { line1: 'Av. Ayrton Senna, 3000' },
                // API devolve STRING, não número
                location: { latitude: '-22.98135949', longitude: '-43.36089723' },
              },
            ],
          },
        },
      ],
    },
  };

  beforeEach(() => {
    client = new TicketmasterClient(config({ 'externalApis.ticketmasterApiKey': 'fake-key' }));
    lastUrl = '';
    global.fetch = jest.fn(async (url: string) => {
      lastUrl = String(url);
      return { ok: true, json: async () => tmResponse } as any;
    }) as any;
  });

  it('busca no Brasil por padrão — sem isso a resposta vem enviesada para os EUA', async () => {
    await client.search({ query: 'rock' });
    expect(lastUrl).toContain('countryCode=BR');
  });

  it('repassa cidade, classificação, data inicial e ordenação', async () => {
    await client.search({
      query: 'rock',
      city: 'Recife',
      classificationName: 'Music',
      startDateTime: '2026-09-01T00:00:00Z',
    });

    expect(lastUrl).toContain('city=Recife');
    expect(lastUrl).toContain('classificationName=Music');
    expect(lastUrl).toContain('startDateTime=2026-09-01T00%3A00%3A00Z');
    expect(lastUrl).toContain('sort=date%2Casc');
  });

  it('nunca envia milissegundos em startDateTime — a API rejeita', async () => {
    await client.search({ query: 'x', startDateTime: '2026-09-01T00:00:00.000Z' });
    expect(lastUrl).not.toContain('.000Z');
  });

  it('mapeia o local completo para o organizador não redigitar', async () => {
    const { items } = await client.search({ query: 'rock' });
    const item = items[0];

    expect(item.venue).toBe('Qualistage');
    expect(item.venueCity).toBe('Rio de Janeiro');
    expect(item.venueAddress).toBe('Av. Ayrton Senna, 3000');
    // Convertido de string para número
    expect(item.venueLat).toBeCloseTo(-22.98135949);
    expect(item.venueLng).toBeCloseTo(-43.36089723);
  });

  it('ignora miniaturas e ratios errados ao escolher a imagem', async () => {
    const { items } = await client.search({ query: 'rock' });
    // 100px é miniatura; 3_2 é ratio errado; sobra a 16_9 de 2048
    expect(items[0].image).toBe('http://img/best.jpg');
  });

  it('escolhe a menor imagem nítida, não a maior — cards não precisam de 2462px', async () => {
    // Conjunto real de um evento do Ticketmaster: 11 variações
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        page: { totalElements: 1 },
        _embedded: {
          events: [
            {
              id: 'x',
              name: 'Evento',
              dates: {},
              images: [
                { ratio: '16_9', width: 100, url: 'http://img/100.jpg' },
                { ratio: '16_9', width: 2462, url: 'http://img/source.jpg' },
                { ratio: '16_9', width: 640, url: 'http://img/640.jpg' },
                { ratio: '16_9', width: 1136, url: 'http://img/1136.jpg' },
              ],
            },
          ],
        },
      }),
    })) as any;

    const { items } = await client.search({ query: 'x' });
    expect(items[0].image).toBe('http://img/640.jpg');
  });

  it('cai para a maior disponível quando nenhuma atinge a largura mínima', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        page: { totalElements: 1 },
        _embedded: {
          events: [
            {
              id: 'x',
              name: 'Evento',
              dates: {},
              images: [
                { ratio: '16_9', width: 100, url: 'http://img/100.jpg' },
                { ratio: '16_9', width: 205, url: 'http://img/205.jpg' },
              ],
            },
          ],
        },
      }),
    })) as any;

    const { items } = await client.search({ query: 'x' });
    expect(items[0].image).toBe('http://img/205.jpg');
  });

  it('prefere o gênero à segmentação genérica na categoria', async () => {
    const { items } = await client.search({ query: 'rock' });
    expect(items[0].category).toBe('Rock');
  });

  it('sobrevive a resposta sem _embedded (nenhum resultado)', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ page: {} }) })) as any;
    const result = await client.search({ query: 'zzzz' });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('sobrevive a evento sem venue e sem cidade', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        page: { totalElements: 1 },
        _embedded: {
          events: [{ id: 'x', name: 'Sem local', dates: {}, images: [] }],
        },
      }),
    })) as any;

    const { items } = await client.search({ query: 'x' });
    expect(items[0].venue).toBeNull();
    expect(items[0].venueLat).toBeNull();
    expect(items[0].image).toBeNull();
  });
});

describe('TmdbClient (SPEC_CP13)', () => {
  let client: TmdbClient;
  let calls: string[];

  const genreResponse = {
    genres: [
      { id: 878, name: 'Ficção científica' },
      { id: 28, name: 'Ação' },
    ],
  };

  const moviesResponse = {
    page: 1,
    total_results: 135,
    dates: { minimum: '2026-07-01', maximum: '2026-08-12' },
    results: [
      {
        id: 1061474,
        title: 'Homem-Aranha: Um Novo Dia',
        overview: 'Sinopse em português',
        release_date: '2026-07-29',
        genre_ids: [878, 28],
        poster_path: '/poster.jpg',
      },
      { id: 2, title: 'Sem cartaz', overview: '', release_date: '', genre_ids: [], poster_path: null },
    ],
  };

  beforeEach(() => {
    client = new TmdbClient(config({ 'externalApis.tmdbApiKey': 'fake-key' }));
    calls = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(String(url));
      const isGenres = String(url).includes('/genre/movie/list');
      return { ok: true, json: async () => (isGenres ? genreResponse : moviesResponse) } as any;
    }) as any;
  });

  it('lista os filmes em cartaz no Brasil', async () => {
    const result = await client.nowPlaying();

    const moviesCall = calls.find((c) => c.includes('now_playing'))!;
    expect(moviesCall).toContain('region=BR');
    expect(moviesCall).toContain('language=pt-BR');
    expect(result.items.length).toBe(2);
  });

  it('traduz genre_ids em nomes — a UI não pode mostrar [878, 28]', async () => {
    const { items } = await client.nowPlaying();
    expect(items[0].category).toBe('Ficção científica');
  });

  it('monta a URL do cartaz e aceita filme sem cartaz', async () => {
    const { items } = await client.nowPlaying();
    expect(items[0].image).toBe('https://image.tmdb.org/t/p/w500/poster.jpg');
    expect(items[1].image).toBeNull();
  });

  it('não inventa local: filme não tem venue', async () => {
    const { items } = await client.nowPlaying();
    expect(items[0].venue ?? null).toBeNull();
    expect(items[0].venueLat ?? null).toBeNull();
  });

  it('busca por texto continua funcionando', async () => {
    const result = await client.search({ query: 'duna' });
    expect(calls.some((c) => c.includes('/search/movie'))).toBe(true);
    expect(result.items.length).toBe(2);
  });

  it('reaproveita o mapa de gêneros entre chamadas', async () => {
    await client.nowPlaying();
    await client.nowPlaying();
    const genreCalls = calls.filter((c) => c.includes('/genre/movie/list'));
    expect(genreCalls.length).toBe(1);
  });
});
