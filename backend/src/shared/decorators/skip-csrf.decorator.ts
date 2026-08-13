import { SetMetadata } from '@nestjs/common';

export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * Dispensa uma rota do par cookie/header de CSRF (SPEC_CP20 AC-7, AC-8).
 *
 * Só cabe onde não existe sessão para ser abusada — login e registro acontecem
 * *antes* de haver cookie — ou onde a credencial é outra: o webhook da Stripe
 * se autentica pela assinatura do próprio corpo, e quem o chama não é navegador
 * nenhum.
 *
 * Toda rota marcada aqui é uma exceção que precisa se justificar sozinha.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
