import { randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';

/** Cookie httpOnly que carrega o JWT. O navegador manda; o JavaScript não lê. */
export const SESSION_COOKIE = 'access_token';

/** Par legível do token CSRF — copiado pelo SPA para o header `X-CSRF-Token`. */
export const CSRF_COOKIE = 'csrf_token';

/** 15 minutos, igual à validade do próprio JWT. */
const MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Como o cookie de sessão sai em cada ambiente.
 *
 * Site em `vercel.app` e API em `up.railway.app` são domínios diferentes: a
 * requisição é cross-site, e nesse regime o navegador não envia cookie `lax`.
 * `none` exige `secure`, e com isso a proteção contra CSRF deixa de vir de
 * graça do SameSite e passa a ser explícita — ver `CsrfGuard`. Em
 * desenvolvimento é o contrário: `secure` faria o navegador descartar o cookie
 * em `http://localhost`.
 */
export function sessionCookieOptions(
  nodeEnv: string | undefined,
  { readableByJs = false }: { readableByJs?: boolean } = {},
): CookieOptions {
  // Ambiente desconhecido conta como produção: errar para o lado que aperta
  const isDevelopment = nodeEnv === 'development' || nodeEnv === 'test';

  return {
    httpOnly: !readableByJs,
    secure: !isDevelopment,
    sameSite: isDevelopment ? 'lax' : 'none',
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

/**
 * Emite os dois cookies da sessão e devolve o token de CSRF.
 *
 * O retorno é o conserto do B20: o cookie legível pertence ao domínio da API, e
 * `document.cookie` do site nunca enxerga cookie do outro domínio — o navegador
 * mandava, o JavaScript não lia, e toda mutação em produção respondia 403. A
 * dupla submissão segue íntegra: de outra origem não se lê o corpo nem o cookie.
 */
export function issueSessionCookies(
  res: Response,
  token: string,
  nodeEnv: string | undefined,
): string {
  const csrfToken = randomBytes(32).toString('hex');

  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(nodeEnv));
  res.cookie(CSRF_COOKIE, csrfToken, sessionCookieOptions(nodeEnv, { readableByJs: true }));

  return csrfToken;
}
