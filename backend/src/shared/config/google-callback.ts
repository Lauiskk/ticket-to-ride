/** O caminho que o `AuthController` expõe para o Google voltar. */
const CALLBACK_PATH = '/auth/google/callback';

/**
 * Onde o Google devolve o navegador depois do login.
 *
 * O passport aceita `callbackURL: undefined` calado e monta a URL de
 * autorização **sem** `redirect_uri`. Quem descobre é o usuário, numa tela do
 * Google dizendo "Erro 400: Missing required parameter: redirect_uri" — um erro
 * nosso, com a cara de um erro deles, e nenhuma pista de onde procurar.
 *
 * Então a variável deixa de ser obrigatória: quando falta, o endereço é
 * derivado do domínio público da própria API (o Railway injeta
 * `RAILWAY_PUBLIC_DOMAIN`), e em último caso do localhost de desenvolvimento.
 * O retorno nunca é vazio.
 *
 * Aceita tanto a URL completa do callback quanto só a base da API — os dois
 * são o que uma pessoa naturalmente escreveria nessa variável.
 */
export function resolveGoogleCallbackUrl(env: {
  callbackUrl?: string;
  publicDomain?: string;
  port?: string;
}): string {
  const explicit = env.callbackUrl?.trim();
  if (explicit) return withCallbackPath(explicit);

  const domain = env.publicDomain?.trim();
  if (domain) return withCallbackPath(withScheme(domain));

  return withCallbackPath(`http://localhost:${env.port?.trim() || '3000'}`);
}

function withScheme(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

function withCallbackPath(url: string): string {
  const base = url.replace(/\/+$/, '');
  return base.endsWith(CALLBACK_PATH) ? base : `${base}${CALLBACK_PATH}`;
}
