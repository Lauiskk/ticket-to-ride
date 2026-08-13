import {
  sessionCookieOptions,
  issueSessionCookies,
  SESSION_COOKIE,
  CSRF_COOKIE,
} from './session-cookie';

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

/**
 * O token de CSRF precisa CHEGAR ao JavaScript do site (SPEC_CP20 B20).
 *
 * Achado testando produção: o cookie legível é do domínio da **API**
 * (`up.railway.app`), e o site roda em `vercel.app`. O navegador manda o cookie
 * junto das requisições credenciadas — por isso a sessão funcionava — mas
 * `document.cookie` no site nunca enxerga um cookie de outro domínio. Resultado:
 * o SPA não conseguia montar o header, e **toda mutação em produção respondia
 * 403**. Local passava porque o Vite faz proxy e tudo vira mesma origem.
 *
 * Correção: o valor também volta no corpo da resposta de autenticação, para o
 * cliente guardar em memória. A dupla submissão continua de pé — quem está em
 * outra origem não lê o corpo (CORS) nem o cookie.
 */
describe('issueSessionCookies (B20)', () => {
  function fakeRes() {
    const cookies: Record<string, { value: string; options: unknown }> = {};
    return {
      cookies,
      cookie: (name: string, value: string, options: unknown) => {
        cookies[name] = { value, options };
      },
    };
  }

  it('devolve o token de CSRF para quem chamou poder mandar no corpo', () => {
    const res = fakeRes();

    const csrf = issueSessionCookies(res as never, 'jwt-de-teste', 'production');

    expect(typeof csrf).toBe('string');
    expect(csrf.length).toBeGreaterThanOrEqual(32);
  });

  it('o valor devolvido é EXATAMENTE o do cookie — senão a comparação nunca bate', () => {
    const res = fakeRes();

    const csrf = issueSessionCookies(res as never, 'jwt-de-teste', 'production');

    expect(res.cookies[CSRF_COOKIE].value).toBe(csrf);
  });

  it('grava a sessão e o par de CSRF juntos', () => {
    const res = fakeRes();

    issueSessionCookies(res as never, 'jwt-de-teste', 'production');

    expect(res.cookies[SESSION_COOKIE].value).toBe('jwt-de-teste');
    expect(res.cookies[CSRF_COOKIE]).toBeDefined();
  });

  it('cada emissão gera um valor novo', () => {
    const a = issueSessionCookies(fakeRes() as never, 'jwt', 'production');
    const b = issueSessionCookies(fakeRes() as never, 'jwt', 'production');

    expect(a).not.toBe(b);
  });
});
