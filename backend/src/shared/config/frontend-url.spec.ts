import { resolveFrontendUrl } from './frontend-url';

/**
 * The OAuth callback redirect (SPEC_CP15 B11).
 *
 * It used to read `CORS_ORIGIN` directly. Once that became a list with
 * wildcards, the redirect target became the whole string and Google login
 * dead-ended.
 */
describe('resolveFrontendUrl', () => {
  it('prefere FRONTEND_URL quando definida', () => {
    expect(resolveFrontendUrl('https://meusite.com', 'http://localhost:5173')).toBe(
      'https://meusite.com',
    );
  });

  it('usa a primeira origem concreta do CORS_ORIGIN', () => {
    expect(
      resolveFrontendUrl(
        undefined,
        'https://ticket-to-ride-psi.vercel.app,https://ticket-to-ride-*.vercel.app,http://localhost:5173',
      ),
    ).toBe('https://ticket-to-ride-psi.vercel.app');
  });

  it('nunca redireciona para um curinga — não é um endereço', () => {
    expect(
      resolveFrontendUrl(undefined, 'https://ticket-to-ride-*.vercel.app,https://real.app'),
    ).toBe('https://real.app');
  });

  it('remove a barra final para não gerar //login', () => {
    expect(resolveFrontendUrl('https://meusite.com/')).toBe('https://meusite.com');
  });

  it('cai no localhost quando não há nada configurado', () => {
    expect(resolveFrontendUrl()).toBe('http://localhost:5173');
    expect(resolveFrontendUrl('', '')).toBe('http://localhost:5173');
  });

  it('só um curinga configurado ainda dá um destino navegável', () => {
    expect(resolveFrontendUrl(undefined, 'https://*.vercel.app')).toBe('http://localhost:5173');
  });
});
