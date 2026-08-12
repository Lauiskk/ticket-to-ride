import { parseCorsOrigins } from './cors';

/**
 * CORS origin parsing.
 *
 * A single hardcoded origin is what broke the first production deploy: the API
 * answered `access-control-allow-origin: http://localhost:5173` to a browser
 * sitting on ticket-to-ride-psi.vercel.app, so every request was blocked.
 */
describe('parseCorsOrigins', () => {
  const matches = (origins: Array<string | RegExp>, candidate: string): boolean =>
    origins.some((o) => (typeof o === 'string' ? o === candidate : o.test(candidate)));

  it('aceita uma origem única', () => {
    expect(parseCorsOrigins('http://localhost:5173')).toEqual(['http://localhost:5173']);
  });

  it('aceita lista separada por vírgula, ignorando espaços', () => {
    const origins = parseCorsOrigins(
      'http://localhost:5173, https://ticket-to-ride-psi.vercel.app',
    );

    expect(matches(origins, 'http://localhost:5173')).toBe(true);
    expect(matches(origins, 'https://ticket-to-ride-psi.vercel.app')).toBe(true);
    expect(matches(origins, 'https://site-aleatorio.com')).toBe(false);
  });

  it('curinga cobre os previews da Vercel', () => {
    const origins = parseCorsOrigins('https://ticket-to-ride-*.vercel.app');

    expect(matches(origins, 'https://ticket-to-ride-n5kek0p12-lauiskks-projects.vercel.app')).toBe(true);
    expect(matches(origins, 'https://ticket-to-ride-psi.vercel.app')).toBe(true);
  });

  it('curinga não vaza para outro domínio nem para http', () => {
    const origins = parseCorsOrigins('https://ticket-to-ride-*.vercel.app');

    // O ponto é escapado: não pode casar com "vercel-app.attacker.com"
    expect(matches(origins, 'https://ticket-to-ride-x.vercel-app.attacker.com')).toBe(false);
    // Esquema faz parte da comparação
    expect(matches(origins, 'http://ticket-to-ride-x.vercel.app')).toBe(false);
    // Não casa com sufixo colado
    expect(matches(origins, 'https://ticket-to-ride-x.vercel.app.evil.com')).toBe(false);
  });

  it('descarta entradas vazias', () => {
    expect(parseCorsOrigins('http://a.com,,  ,http://b.com')).toHaveLength(2);
  });
});
