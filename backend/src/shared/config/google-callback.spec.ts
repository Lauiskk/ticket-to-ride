import { resolveGoogleCallbackUrl } from './google-callback';

/**
 * O endereço para onde o Google devolve o navegador (SPEC_CP19 B17).
 *
 * Em produção `GOOGLE_CALLBACK_URL` simplesmente não existia. O passport
 * repassa `callbackURL: undefined` para o Google sem reclamar, e a pessoa
 * recebe **"Erro 400: Missing required parameter: redirect_uri"** — uma tela do
 * Google acusando um erro que é nosso. Configuração faltando tem que virar
 * padrão razoável ou barulho no boot, nunca uma tela de erro de terceiro.
 */
describe('resolveGoogleCallbackUrl', () => {
  it('usa GOOGLE_CALLBACK_URL quando definida', () => {
    expect(
      resolveGoogleCallbackUrl({
        callbackUrl: 'https://api.exemplo.com/auth/google/callback',
        publicDomain: 'outro.up.railway.app',
      }),
    ).toBe('https://api.exemplo.com/auth/google/callback');
  });

  it('deriva do domínio público quando a variável falta', () => {
    expect(
      resolveGoogleCallbackUrl({ publicDomain: 'ticket-to-ride-production.up.railway.app' }),
    ).toBe('https://ticket-to-ride-production.up.railway.app/auth/google/callback');
  });

  it('não duplica o https:// se o domínio já vier com esquema', () => {
    expect(resolveGoogleCallbackUrl({ publicDomain: 'https://api.exemplo.com' })).toBe(
      'https://api.exemplo.com/auth/google/callback',
    );
  });

  it('cai no localhost, na porta da API, em desenvolvimento', () => {
    expect(resolveGoogleCallbackUrl({ port: '3000' })).toBe(
      'http://localhost:3000/auth/google/callback',
    );
    expect(resolveGoogleCallbackUrl({})).toBe('http://localhost:3000/auth/google/callback');
  });

  it('nunca devolve vazio — é isso que produz "Missing required parameter"', () => {
    for (const env of [{}, { callbackUrl: '' }, { callbackUrl: '   ', publicDomain: '' }]) {
      expect(resolveGoogleCallbackUrl(env)).toMatch(/^https?:\/\/.+\/auth\/google\/callback$/);
    }
  });

  it('remove barras sobrando em vez de gerar //auth/google/callback', () => {
    expect(resolveGoogleCallbackUrl({ callbackUrl: 'https://api.exemplo.com/' })).toBe(
      'https://api.exemplo.com/auth/google/callback',
    );
  });
});
