# SPEC — CP20: A sessão sai do JavaScript

## Contexto

O token de acesso vive no `localStorage` e viaja como `Authorization: Bearer`. Qualquer script
que consiga rodar na página — uma dependência comprometida, um XSS que ninguém viu — lê
`localStorage.getItem('ttr_token')` e leva a sessão inteira. É a diferença entre um XSS que
estraga uma tela e um XSS que vira conta.

O curioso é que **a metade difícil já estava pronta**: `AuthController.setTokenCookie` emite um
cookie `httpOnly` em login, registro, refresh e 2FA, e o `JwtStrategy` já tenta o cookie
**antes** do header. O SPA é que nunca usou.

E há um motivo para ninguém ter percebido: o cookie sai com `sameSite: 'lax'`. Vercel e Railway
são domínios diferentes — a requisição é **cross-site**, e nesse regime o navegador simplesmente
não envia um cookie `lax`. Ou seja, em produção o cookie sempre existiu e **nunca foi usado**;
quem sustentava a sessão era o Bearer. Trocar o consumidor sem trocar o `sameSite` derrubaria o
login inteiro.

Trocar o portador da sessão traz junto um problema que o Bearer não tinha: com cookie, o
navegador anexa credenciais **sozinho**, inclusive em requisição disparada por outro site. Daí
CSRF entrar no escopo desta spec — não é zelo extra, é a consequência direta da mudança.

## Requisitos funcionais

- RF-1: O cookie de sessão é emitido conforme o ambiente: produção → `sameSite: 'none'` +
  `secure: true`; desenvolvimento → `sameSite: 'lax'` e sem `secure` (localhost não é HTTPS).
- RF-2: `GET /auth/me` devolve o usuário autenticado. É o que permite ao SPA descobrir quem está
  logado tendo apenas o cookie — sem cookie válido, 401.
- RF-3: O frontend deixa de guardar token e usuário no `localStorage`. O usuário vive em memória
  no contexto e é recuperado por `/auth/me`.
- RF-4: O callback do Google redireciona **sem token e sem dados do usuário na URL**. A sessão
  vai no cookie; o SPA descobre o resto pelo `/auth/me`.
- RF-5: Toda mutação (`POST`, `PATCH`, `PUT`, `DELETE`) exige o header `X-CSRF-Token` batendo
  com o cookie `csrf_token`. Exceções: login, registro e o webhook da Stripe — que não têm
  sessão para roubar e, no caso do webhook, já têm assinatura própria.
- RF-6: A API aceita **apenas** corpo JSON. Sem `urlencoded`, um `<form>` de outro site não
  consegue formar requisição autenticada válida.

## Requisitos não-funcionais

- RNF-1: O Bearer continua aceito pelo `JwtStrategy` — é o que mantém `curl` e os testes de
  fluxo funcionando sem navegador. O que muda é o SPA parar de usá-lo.

## Considerações de segurança

- `sameSite: 'none'` é obrigatório para o cookie atravessar de `vercel.app` para
  `up.railway.app`, e só é aceito com `secure: true`. Isso significa que **a proteção contra CSRF
  deixa de ser o SameSite** e passa a ser explícita: CORS com lista fechada de origens (já
  existe, `parseCorsOrigins`) + dupla submissão de token + corpo exclusivamente JSON.
- O cookie CSRF é legível por JavaScript **de propósito**: a defesa não está no segredo dele, e
  sim em o atacante não conseguir ler o valor de outra origem para copiar no header.
- Tirar o token da URL do OAuth fecha o vazamento por log de servidor e `Referer` que o CP19 só
  tinha conseguido mitigar (apagando do histórico).
- `httpOnly` não protege contra CSRF nem contra um XSS que faça requisições **em nome** da
  vítima; protege contra o token ser **exfiltrado**. Continua valendo a pena: token roubado
  funciona em qualquer lugar, XSS só funciona enquanto a aba está aberta.

## Critérios de aceitação — testáveis

- AC-1: Em produção, o cookie de sessão sai com `sameSite: 'none'`, `secure: true`, `httpOnly`.
- AC-2: Em desenvolvimento, sai com `sameSite: 'lax'` e **sem** `secure` — senão o navegador o
  descarta em `http://localhost`.
- AC-3: `GET /auth/me` sem cookie e sem header → 401.
- AC-4: `GET /auth/me` com sessão válida → id, email, nome e papel. Nunca o hash de senha.
- AC-5: `POST` sem `X-CSRF-Token` → 403 `CSRF_TOKEN_INVALID`.
- AC-6: `POST` com header diferente do cookie → 403.
- AC-7: Login e registro passam **sem** header CSRF (não há sessão anterior de onde tirá-lo).
- AC-8: O webhook da Stripe passa sem header CSRF — a assinatura dele é a credencial.
- AC-9: `GET`, `HEAD` e `OPTIONS` nunca exigem CSRF.
- AC-10: O redirect do callback do Google não contém `token=` nem `user=`.

## Casos de borda

- AC-E1: Cookie CSRF ausente mas header presente → 403 (não dá para comparar com nada).
- AC-E2: Depois do logout, `/auth/me` volta a 401.
- AC-E3: Sessão expirada em aba aberta → a primeira mutação recebe 401 e a interface manda para
  o login, sem loop de refresh.

## Contrato de API

| Endpoint | Método | Muda o quê |
|---|---|---|
| `/auth/me` | GET | **novo** — devolve o usuário da sessão |
| `/auth/google/callback` | GET | passa a redirecionar para `/login?oauth=ok`, sem token na URL |
| qualquer mutação | POST/PATCH/PUT/DELETE | passa a exigir `X-CSRF-Token` |

Cookies: `access_token` (httpOnly, sessão) e `csrf_token` (legível, par do header).

## Validação real

- Navegador: entrar, conferir que `localStorage` fica vazio e que o JWT **não** aparece em
  `document.cookie`; comprar um ingresso; entrar com Google e cair logado sem token na URL;
  repetir uma mutação sem o header e ver a recusa.

## Achado durante a implementação — B19

Tirar o token do `localStorage` criou um efeito colateral que só apareceu no
navegador: com a sessão vindo do servidor, o SPA passou a chamar `/auth/me` ao
abrir **qualquer** página. Para um visitante sem conta isso é 401 — resposta
correta —, mas o cliente HTTP tratava todo 401 como "sessão perdida": tentava
renovar, falhava, e o tratamento do fracasso era **redirecionar para o login**.
Ou seja, quem chegasse na vitrine pública sem conta era expulso dela.

- RF-7: `/auth/me` é chamado com `allowAnonymous`: 401 ali é resposta legítima,
  não sessão expirada, e não dispara renovação nem redirecionamento.

## Status
- [x] Spec escrita
- [x] Testes escritos — vermelhos (13 ACs de cookie e CSRF)
- [x] Implementação concluída — testes verdes (135/135)
- [x] Validação real executada — 2026-08-13

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| `localStorage` depois do login | **vazio** — AC ✔ |
| JWT visível ao JavaScript (`document.cookie`) | **não** (só `csrf_token`) — RF-3 ✔ |
| `GET /auth/me` só com cookie | 200 com id, e-mail, nome e papel; sem hash de senha — AC-4 ✔ |
| `POST` sem `X-CSRF-Token` | **403** `CSRF_TOKEN_INVALID` — AC-5 ✔ |
| `POST` com header diferente do cookie | **403** — AC-6 ✔ |
| `POST` com o par correto | passa o guard e segue para a validação de negócio (400) — sem falso positivo |
| Login pelo formulário | vai para `/events`, barra mostra "Cliente Um \| Sair" |
| Reserva + checkout pela interface | abre o pagamento, sem erro de origem — o header CSRF do cliente funciona no fluxo real |
| Visitante sem conta na vitrine | permanece na vitrine (B19 corrigido) |
