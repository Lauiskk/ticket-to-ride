import { randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';

/** Cookie httpOnly que carrega o JWT. O navegador manda; o JavaScript não lê. */
export const SESSION_COOKIE = 'access_token';

/** Par legível do token CSRF — copiado pelo SPA para o header `X-CSRF-Token`. */
export const CSRF_COOKIE = 'csrf_token';

/** 15 minutos, igual à validade do próprio JWT. */
const MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Como o cookie de sessão precisa sair em cada ambiente (SPEC_CP20 RF-1).
 *
 * O ponto que decide tudo: o frontend está em `vercel.app` e a API em
 * `up.railway.app`. Domínios diferentes = requisição **cross-site**, e nesse
 * regime o navegador não envia cookie `sameSite: 'lax'`. Este cookie sempre
 * saiu como `lax`, então em produção ele existia e nunca era usado — quem
 * sustentava a sessão era o header `Authorization`. Passar a depender do cookie
 * sem corrigir isto derrubaria o login inteiro.
 *
 * `sameSite: 'none'` exige `secure: true`, o que também significa que a
 * proteção contra CSRF deixa de vir de graça do SameSite e passa a ser
 * explícita — ver `CsrfGuard`.
 *
 * Em desenvolvimento o inverso: `secure` faria o navegador descartar o cookie
 * em `http://localhost`.
 */
export function sessionCookieOptions(
  nodeEnv: string | undefined,
  { readableByJs = false }: { readableByJs?: boolean } = {},
): CookieOptions {
  // Ambiente desconhecido é tratado como produção: errar para o lado que
  // aperta, não para o que afrouxa.
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
 * Emite os dois cookies da sessão e **devolve o token de CSRF**.
 *
 * O retorno não é conveniência: é o conserto do B20. O cookie legível pertence
 * ao domínio da API (`up.railway.app`), e o site roda em `vercel.app` —
 * `document.cookie` de um domínio nunca enxerga cookie do outro. O navegador
 * anexava o cookie corretamente nas requisições (a sessão funcionava), mas o
 * JavaScript do site não conseguia montar o header `X-CSRF-Token`, e **toda
 * mutação em produção respondia 403**.
 *
 * Local não pegava isso: o Vite faz proxy de `/api`, então tudo é mesma origem.
 * Foi preciso abrir o site publicado para o defeito aparecer.
 *
 * Com o valor de volta no corpo da resposta, o cliente guarda em memória. A
 * dupla submissão continua íntegra: de outra origem não se lê o corpo (CORS)
 * nem o cookie.
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
