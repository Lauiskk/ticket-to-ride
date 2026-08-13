import { AuthService } from './auth.service';

/**
 * De quem é a tentativa de login (SPEC_CP21).
 *
 * O limitador conta falhas por IP. Se esse IP for o do proxy, ele conta todo
 * mundo como a mesma pessoa: cinco erros de qualquer visitante trancam a porta
 * para **todos** por meia hora, e o atacante real não fica isolado de ninguém.
 * Um controle de segurança que erra assim é pior que não existir — ele vira uma
 * negação de serviço que qualquer um dispara de graça.
 *
 * Com `trust proxy` configurado no Express, `req.ip` já é o endereço do cliente
 * de verdade. A leitura manual de `x-forwarded-for` fica só como rede de
 * segurança para quem chama a API sem passar por proxy nenhum.
 */
describe('AuthService.extractClientIp (SPEC_CP21)', () => {
  it('usa req.ip, que o Express calcula respeitando trust proxy', () => {
    const ip = AuthService.extractClientIp({
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      ip: '203.0.113.7',
    });

    expect(ip).toBe('203.0.113.7');
  });

  it('sem req.ip, cai para a PRIMEIRA entrada do x-forwarded-for', () => {
    // A primeira é o cliente; as seguintes são os proxies do caminho. Pegar a
    // última devolve o proxy mais próximo — compartilhado por todo mundo.
    const ip = AuthService.extractClientIp({
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' },
    });

    expect(ip).toBe('203.0.113.7');
  });

  it('aceita o header repetido em forma de lista', () => {
    const ip = AuthService.extractClientIp({
      headers: { 'x-forwarded-for': ['198.51.100.4, 10.0.0.1', '10.0.0.9'] },
    });

    expect(ip).toBe('198.51.100.4');
  });

  it('sem nada identificável devolve um marcador, nunca vazio', () => {
    expect(AuthService.extractClientIp({ headers: {} })).toBe('0.0.0.0');
    expect(AuthService.extractClientIp({ headers: { 'x-forwarded-for': '  ' } })).toBe('0.0.0.0');
  });

  it('ignora espaços em volta do endereço', () => {
    expect(
      AuthService.extractClientIp({ headers: { 'x-forwarded-for': '  203.0.113.9 , 10.0.0.1' } }),
    ).toBe('203.0.113.9');
  });
});
