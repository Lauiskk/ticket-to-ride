import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { AppError, ErrorCodes } from '../errors';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';
import { CSRF_COOKIE } from '../config/session-cookie';

/** Métodos que não mudam estado — não precisam provar intenção. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Dupla submissão de token CSRF (SPEC_CP20 RF-5).
 *
 * Enquanto a sessão era um header `Authorization`, CSRF não existia como
 * problema: nenhum site consegue fazer o navegador da vítima montar aquele
 * header. Com cookie, o navegador anexa a credencial **sozinho**, inclusive
 * numa requisição partida de outra origem — e como o cookie precisa sair com
 * `sameSite: 'none'` para atravessar de vercel.app para railway.app, a proteção
 * que o SameSite dava de graça vai junto. Este guard fica no lugar dela.
 *
 * O mecanismo: o mesmo valor aleatório vai num cookie legível e é copiado pelo
 * SPA para o header `X-CSRF-Token`. Um site atacante consegue *disparar* a
 * requisição com o cookie anexado, mas não consegue **ler** o cookie de outra
 * origem para preencher o header. O segredo do valor não é a defesa; a origem
 * de quem consegue lê-lo é.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method?.toUpperCase())) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const cookieToken = request.cookies?.[CSRF_COOKIE];
    const headerToken = request.headers['x-csrf-token'];
    const header = Array.isArray(headerToken) ? headerToken[0] : headerToken;

    if (!cookieToken || !header || !equals(cookieToken, header)) {
      throw new AppError(
        'Requisição sem confirmação de origem. Recarregue a página e tente de novo.',
        ErrorCodes.CSRF_TOKEN_INVALID,
        403,
      );
    }

    return true;
  }
}

/**
 * Comparação de tempo constante.
 *
 * `timingSafeEqual` exige buffers do mesmo tamanho, e o próprio lançamento por
 * tamanho diferente já é um canal — então o tamanho é conferido antes, sem
 * comparar conteúdo.
 */
function equals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
