import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';
import { CSRF_COOKIE } from '../config/session-cookie';

/**
 * Dupla submissão de token CSRF (SPEC_CP20 AC-5 a AC-9).
 *
 * Enquanto a sessão era um header Bearer, CSRF não existia: nenhum site
 * conseguia fazer o navegador da vítima montar aquele header. Com cookie, o
 * navegador anexa a credencial sozinho — inclusive numa requisição disparada de
 * outro lugar. E como o cookie precisa sair com `sameSite: 'none'` para
 * atravessar de vercel.app para railway.app, a proteção do próprio SameSite
 * some junto. Este guard é o que fica no lugar dela.
 */

function contextFor(
  method: string,
  { cookie, header, path = '/reservations' }: { cookie?: string; header?: string; path?: string },
): ExecutionContext {
  const request = {
    method,
    path,
    url: path,
    cookies: cookie ? { [CSRF_COOKIE]: cookie } : {},
    headers: header ? { 'x-csrf-token': header } : {},
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('CsrfGuard (SPEC_CP20)', () => {
  let guard: CsrfGuard;

  beforeEach(() => {
    // Sem decorador de dispensa em nenhum alvo, salvo quando o teste disser
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
    guard = new CsrfGuard(reflector);
  });

  it('AC-9: leitura nunca exige token', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(guard.canActivate(contextFor(method, {}))).toBe(true);
    }
  });

  it('AC-5: mutação sem header é recusada', () => {
    expect(() => guard.canActivate(contextFor('POST', { cookie: 'abc123' }))).toThrow(
      expect.objectContaining({ code: 'CSRF_TOKEN_INVALID' }),
    );
  });

  it('AC-6: header diferente do cookie é recusado', () => {
    expect(() =>
      guard.canActivate(contextFor('POST', { cookie: 'abc123', header: 'outro-valor' })),
    ).toThrow(expect.objectContaining({ code: 'CSRF_TOKEN_INVALID' }));
  });

  it('AC-E1: header sem cookie é recusado — não há com o que comparar', () => {
    expect(() => guard.canActivate(contextFor('POST', { header: 'abc123' }))).toThrow(
      expect.objectContaining({ code: 'CSRF_TOKEN_INVALID' }),
    );
  });

  it('par correto passa', () => {
    expect(guard.canActivate(contextFor('POST', { cookie: 'abc123', header: 'abc123' }))).toBe(
      true,
    );
    expect(guard.canActivate(contextFor('PATCH', { cookie: 'abc123', header: 'abc123' }))).toBe(
      true,
    );
  });

  it('AC-7 e AC-8: rotas dispensadas passam sem par nenhum', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const exempt = new CsrfGuard(reflector);

    expect(exempt.canActivate(contextFor('POST', { path: '/auth/login' }))).toBe(true);
    expect(exempt.canActivate(contextFor('POST', { path: '/payments/webhook' }))).toBe(true);
  });

  it('comparação não vaza tamanho por caminho curto — valores diferentes falham igual', () => {
    const curto = contextFor('POST', { cookie: 'a', header: 'abcdefghij' });
    const longo = contextFor('POST', { cookie: 'abcdefghij', header: 'a' });

    expect(() => guard.canActivate(curto)).toThrow();
    expect(() => guard.canActivate(longo)).toThrow();
  });
});
