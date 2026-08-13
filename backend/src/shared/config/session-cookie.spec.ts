import { sessionCookieOptions, SESSION_COOKIE, CSRF_COOKIE } from './session-cookie';

/**
 * O cookie que carrega a sessão (SPEC_CP20 AC-1, AC-2).
 *
 * O detalhe que decide tudo: Vercel e Railway são domínios diferentes, então a
 * requisição é cross-site. Nesse regime o navegador **não envia** cookie
 * `sameSite: 'lax'` — que é como este cookie sempre saiu. Ele existia em
 * produção e nunca foi usado; quem sustentava a sessão era o header Bearer.
 * Trocar o consumidor sem trocar o `sameSite` derruba o login inteiro.
 */
describe('sessionCookieOptions', () => {
  it('AC-1: em produção atravessa cross-site — none + secure', () => {
    const opts = sessionCookieOptions('production');

    expect(opts.sameSite).toBe('none');
    expect(opts.secure).toBe(true);
    expect(opts.httpOnly).toBe(true);
  });

  it('AC-2: em desenvolvimento não pede secure — localhost não é HTTPS', () => {
    const opts = sessionCookieOptions('development');

    expect(opts.sameSite).toBe('lax');
    expect(opts.secure).toBe(false);
    expect(opts.httpOnly).toBe(true);
  });

  it('trata ambiente desconhecido como produção — errar para o lado seguro', () => {
    expect(sessionCookieOptions(undefined).secure).toBe(true);
    expect(sessionCookieOptions('').secure).toBe(true);
  });

  it('o cookie de sessão nunca é legível por JavaScript', () => {
    for (const env of ['production', 'development', 'test']) {
      expect(sessionCookieOptions(env).httpOnly).toBe(true);
    }
  });

  it('o par CSRF precisa ser legível — a defesa não está no segredo dele', () => {
    const opts = sessionCookieOptions('production', { readableByJs: true });

    expect(opts.httpOnly).toBe(false);
    // ...mas ainda tem que viajar cross-site junto com a sessão
    expect(opts.sameSite).toBe('none');
    expect(opts.secure).toBe(true);
  });

  it('os dois cookies têm nomes distintos e estáveis', () => {
    expect(SESSION_COOKIE).toBe('access_token');
    expect(CSRF_COOKIE).toBe('csrf_token');
  });
});
