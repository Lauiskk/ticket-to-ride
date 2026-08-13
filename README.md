# Ticket to Ride

Plataforma de eventos e ingressos. O organizador monta um evento a partir do
catálogo do Ticketmaster/TMDb, o cliente escolhe o lugar e paga, recebe um
ingresso com QR assinado, e a portaria valida na entrada.

**Aplicação publicada:** https://ticket-to-ride-psi.vercel.app
**API:** https://ticket-to-ride-production-ebbe.up.railway.app/health

| Papel | Entrar com | Senha |
|---|---|---|
| Organizador | `organizer@ticket.dev` | `Organizer123!` |
| Cliente | `client1@ticket.dev` | `Client123!` |
| Cliente (para testar transferência) | `client2@ticket.dev` | `Client123!` |
| Portaria | `gate@ticket.dev` | `Gate123!` |

Cartão de teste da Stripe: `4242 4242 4242 4242`, validade futura, qualquer CVC.
Para ver a recusa: `4000 0000 0000 0002`.

> **Atalho para avaliar em 5 minutos.** Entre como cliente e compre um lugar em
> **"Sessão Cult — Cidade de Deus (ACONTECENDO AGORA)"**. Esse evento existe no
> seed justamente para isso: ele já está com a entrada aberta, então dá para
> comprar, abrir "Meus ingressos", copiar o código e validar na portaria sem
> esperar data nenhuma. Depois entre como `gate@ticket.dev` e leia o mesmo
> ingresso duas vezes — a segunda leitura recusa.

---

## Sumário

- [O que está implementado](#o-que-está-implementado)
- [Como rodar](#como-rodar)
- [Banco de dados](#banco-de-dados)
- [Dados semeados](#dados-semeados)
- [Arquitetura](#arquitetura)
- [API](#api)
- [Testes](#testes)
- [Segurança](#segurança)
- [Uso de IA](#uso-de-ia)
- [Deploy](#deploy)
- [O que não está como deveria](#o-que-não-está-como-deveria)
- [Estrutura do repositório](#estrutura-do-repositório)

---

## O que está implementado

### Obrigatórios do enunciado

| Requisito | Onde |
|---|---|
| Navegação e busca de eventos publicados, com data, local e preço | `/events` — busca por texto, cidade, faixa de preço, período, ordenação e proximidade |
| Criação e gestão de eventos pelo organizador | `/organizer` — assistente em 4 passos, a partir do catálogo externo |
| Reserva com **mapa de assentos** | Eventos numerados: cinema/teatro, assento a assento |
| Reserva por **quantidade** | Eventos de pista: seletor de quantidade por setor |
| Pagamento simulado, com confirmação **e recusa** | Stripe em modo de teste; sem chave configurada, cai num modo simulado que fecha o mesmo fluxo |
| "Meus ingressos" com QR | `/my-tickets`, e o ingresso em tela cheia em `/my-tickets/:id` |
| Tela de portaria com retorno claro | Válido · já utilizado · evento errado · fora do horário · evento cancelado |
| Leitura do QR pela câmera, com digitação manual | `/gate` — câmera via `html5-qrcode`, campo de texto ao lado |
| Catálogo externo | Ticketmaster Discovery **e** TMDb, com cache de 1 h no Redis |
| Três papéis distintos | Organizador, Cliente, Portaria — separados por guard e por interface |
| Persistência de eventos, reservas e ingressos | PostgreSQL 16 via TypeORM |
| Mesmo lugar não vendido duas vezes | `SELECT … FOR UPDATE NOWAIT` dentro de transação |
| QR que não pode ser forjado | Payload assinado com HMAC-SHA256, conferido antes de qualquer consulta |
| Compartilhar ingresso por link gerado pela aplicação | `/share/:token` — o destinatário vê o que está recebendo antes de aceitar |
| Mesmo ingresso não validado duas vezes | Marcação atômica; a segunda leitura recusa com a hora da primeira |

O enunciado pedia mapa de assentos **ou** quantidade. Os dois estão feitos.

### Opcionais pontuados

Busca e filtro · painel do organizador · **cancelamento com devolução ao
estoque e estorno** · mapa de assentos em tempo real (WebSocket) · Docker
Compose · testes (163) · aplicação publicada.

---

## Como rodar

Pré-requisitos: **Node.js 20+** e **Docker**. Sem Docker também dá — ver
[Banco de dados](#banco-de-dados).

```bash
git clone https://github.com/Lauiskk/ticket-to-ride.git
cd "ticket-to-ride"
```

### 1. Variáveis de ambiente

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

O `backend/.env.example` traz valores locais que já funcionam para
`DATABASE_URL` e `REDIS_URL`. Você precisa preencher:

| Variável | Obrigatória? | Onde conseguir |
|---|---|---|
| `JWT_SECRET` | sim | qualquer string de 32+ caracteres |
| `TICKET_SIGNING_SECRET` | sim | idem — é o que assina o QR |
| `TICKETMASTER_API_KEY` | sim | https://developer.ticketmaster.com |
| `TMDB_API_KEY` | não | https://developer.themoviedb.org |
| `STRIPE_SECRET_KEY` | não | sem ela o checkout entra em modo simulado |
| `STRIPE_WEBHOOK_SECRET` | não | só necessário com a Stripe ligada |

Para gerar os dois segredos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

A API **não sobe** se faltar uma variável obrigatória: ela falha no boot dizendo
qual, em vez de quebrar mais adiante com um erro que não aponta para nada.

### 2. Subir tudo

```bash
docker compose up -d
```

Isso levanta PostgreSQL 16, Redis 7 e a API em modo watch, na porta 3000.
Confira com:

```bash
curl http://localhost:3000/health
```

### 3. Popular o banco

```bash
cd backend && npm install && npm run seed
```

O seed é idempotente: rodar de novo não duplica nada, sai na hora se já houver
usuário.

### 4. Subir o site

```bash
cd frontend && npm install && npm run dev
```

http://localhost:5173. O Vite faz proxy de `/api` para a API, então em
desenvolvimento tudo é mesma origem e você não precisa mexer em CORS.

> **Se algo parecer não ter surtido efeito**, reconstrua o contêiner da API:
> `docker compose up -d --build api`. Bind mount do Windows não propaga evento
> de arquivo de forma confiável, e o watcher já ficou horas servindo código
> antigo sem avisar — o pior tipo de falha, a que parece sucesso.

---

## Banco de dados

**PostgreSQL 16.** O projeto usa `SELECT … FOR UPDATE NOWAIT` para o bloqueio de
assentos, `JSONB` para as declarações de meia-entrada e a configuração do mapa, e
trigonometria em SQL para ordenar por proximidade.

### Com Docker (recomendado)

Nada a fazer: o `docker-compose.yml` sobe `postgres:16-alpine` já com o banco
`ticket_to_ride` criado, usuário `postgres`, senha `postgres`, na porta 5432,
com volume nomeado para os dados sobreviverem a um `down`.

### Sem Docker

1. Instale PostgreSQL 16 e Redis 7.
2. Crie o banco:
   ```sql
   CREATE DATABASE ticket_to_ride;
   ```
3. Aponte o `backend/.env` para ele:
   ```
   DATABASE_URL=postgres://usuario:senha@localhost:5432/ticket_to_ride
   REDIS_URL=redis://localhost:6379
   ```
4. Suba a API: `cd backend && npm run start:dev`

### Como o schema é criado

Pelo `synchronize` do TypeORM, no boot, a partir das entidades. **Não há
migrations** — é uma limitação assumida e está explicada em
[O que não está como deveria](#o-que-não-está-como-deveria).

Na prática, você não roda comando de migração nenhum: suba a API e as tabelas
aparecem. Oito entidades: `users`, `events`, `seats`, `reservations`,
`reservation_seats`, `payments`, `tickets`, `sharing_links`.

### Redis

Usado para três coisas, todas com degradação graciosa: lista de tokens
revogados, contagem de falhas de login e cache do catálogo externo. **Se o Redis
cair, a aplicação continua de pé** — o que se perde é revogação imediata de
token e a proteção contra força bruta, e os dois casos vão para o log.

---

## Dados semeados

`npm run seed` cria os quatro usuários da tabela do topo e **16 eventos
publicados** montados a partir de dados reais do Ticketmaster e do TMDb
(o número final varia com o que as APIs devolvem no momento), somando cerca de
6.000 assentos entre numerados e pista.

Um deles, **"Sessão Cult — Cidade de Deus (ACONTECENDO AGORA)"**, tem data no
passado recente e a janela de entrada aberta: é por ele que dá para testar a
portaria sem esperar a data de nenhum evento chegar.

---

## Arquitetura

```
React + Vite  ──HTTP──►  NestJS  ──►  PostgreSQL 16   (eventos, reservas, ingressos)
   (Vercel)   ◄─WS────  (Railway)  ──►  Redis 7        (blacklist, rate limit, cache)
                                    ──►  Stripe (test)  (cobrança e estorno)
                                    ──►  Ticketmaster / TMDb (catálogo)
```

Um módulo NestJS por assunto do domínio, cada um com controller, service, DTOs e
entidades:

| Módulo | Responsabilidade |
|---|---|
| `auth` | Sessão, papéis, 2FA, OAuth, limite de tentativas de login |
| `event` | CRUD do organizador, vitrine pública, métricas de bilheteria |
| `event/catalog` | Ticketmaster e TMDb, com cache e degradação |
| `reservation` | Bloqueio de assentos, expiração, WebSocket do mapa |
| `payment` | Stripe, webhook, reconciliação, estorno |
| `ticket` | Emissão, assinatura HMAC, geração do QR |
| `gate` | Validação na entrada e agenda da portaria |
| `sharing` | Link de transferência e troca de dono |
| `shared` | Erros, filtro global, guards, interceptors, config |

Toda entrada passa por um DTO validado por um `ValidationPipe` global com
`whitelist` e `forbidNonWhitelisted`; toda saída passa por um DTO de resposta,
que é a lista fechada do que pode sair.

---

## API

Autenticação por cookie `httpOnly`; o header `Authorization: Bearer` também é
aceito, o que mantém `curl` e testes de fluxo funcionando sem navegador.
Mutações exigem o header `X-CSRF-Token`.

| Método | Rota | Quem pode | O que faz |
|---|---|---|---|
| `POST` | `/auth/register` | público | Cria conta |
| `POST` | `/auth/login` | público | Entra |
| `GET` | `/auth/me` | sessão | Quem está logado |
| `POST` | `/auth/logout` | sessão | Revoga o token |
| `POST` | `/auth/refresh` | sessão | Renova a sessão |
| `POST` | `/auth/2fa/enable` · `/auth/2fa/verify` | sessão | TOTP |
| `GET` | `/auth/google` · `/auth/google/callback` | público | OAuth |
| `GET` | `/catalog/search` · `/catalog/classifications` | organizador | Ticketmaster + TMDb |
| `GET` | `/events` | público | Vitrine, com filtros e paginação |
| `GET` | `/events/:id` | público | Detalhe |
| `POST` | `/events` | organizador | Cria (rascunho) |
| `PATCH` | `/events/:id/publish` | organizador | Publica |
| `PATCH` | `/events/:id/cancel` | organizador | Cancela, devolve e estorna |
| `GET` | `/events/my/list` | organizador | Meus eventos |
| `GET` | `/events/:id/metrics` | organizador (dono) | Bilheteria |
| `POST` | `/reservations` | cliente | Reserva com bloqueio |
| `POST` | `/reservations/:id/cancel` | cliente | Desiste e devolve os lugares |
| `GET` | `/reservations/my` | cliente | Minhas reservas |
| `GET` | `/reservations/seats/:eventId` | público | Assentos e status |
| `POST` | `/payments/:reservationId` | cliente | Abre a cobrança |
| `GET` | `/payments/:reservationId/status` | cliente | Estado + reconciliação |
| `POST` | `/payments/:reservationId/confirm` | cliente | Só no modo simulado |
| `POST` | `/payments/webhook` | Stripe | Assinatura verificada |
| `GET` | `/tickets` · `/tickets/:id` | cliente (dono) | Meus ingressos |
| `POST` | `/sharing/tickets/:ticketId/share` | cliente (dono) | Gera o link |
| `GET` | `/sharing/:token` | público | Prévia, sem consumir |
| `POST` | `/sharing/:token/accept` | cliente | Aceita a transferência |
| `GET` | `/gate/events` | portaria | Agenda da portaria |
| `POST` | `/gate/validate` | portaria | Valida o QR |
| `GET` | `/health` | público | Estado do banco e do Redis |

---

## Testes

```bash
cd backend && npm test          # 163 testes, 19 suítes
cd backend && npm run test:cov  # com cobertura
cd frontend && npx tsc -b       # typecheck do site
```

São dois tipos. **Testes de unidade** cobrem os serviços com cenário montado —
webhook repetido não emite ingresso duas vezes, cancelar duas vezes não estorna
duas vezes, link usado vence link expirado. E **property tests** com
`fast-check`, que geram entrada aleatória para checar invariantes: resposta de
erro nunca carrega metadados de paginação, `hash` + `verify` fecha para qualquer
string, a matriz de papéis não tem buraco.

---

## Segurança

| Ameaça | O que existe |
|---|---|
| Entrar sem pagar | QR assinado com HMAC-SHA256, conferido **antes** de qualquer consulta ao banco; validação marca `used`; evento cancelado não abre o portão |
| Mesmo lugar vendido duas vezes | `SELECT … FOR UPDATE NOWAIT` em transação, com disputa real distinguida de falha de infraestrutura |
| Roubo de sessão | JWT em cookie `httpOnly` de 15 min, CSRF de dupla submissão, corpo só JSON, CORS com lista fechada |
| Força bruta no login | 5 falhas em 15 min por IP → 30 min de bloqueio, com o IP do cliente de verdade |
| Injeção | SQL sempre parametrizado (as duas queries cruas usam `$1..$n`); DTOs com `whitelist` + `forbidNonWhitelisted`; sem `eval`, `child_process` ou `dangerouslySetInnerHTML` |
| Enumeração de recursos | Recurso de outra pessoa responde **404**, nunca 403 — um 403 confirmaria que existe |
| Vazamento de dados | Métricas só agregadas; documento mascarado na portaria; sala do WebSocket só com ids; senha e segredo de 2FA nunca saem em resposta |
| Abuso e cota externa | Limite por rota em cadastro, reserva, pagamento, portaria e catálogo (protege a cota de 5.000 req/dia do Ticketmaster) |

Senha com **bcrypt, 12 rounds**. O modelo de ameaças completo, com o antes e
depois de cada item, está em
[`SDD/05-seguranca/MODELO_DE_AMEACAS.md`](SDD/05-seguranca/MODELO_DE_AMEACAS.md).

---

## Uso de IA

O relato está em **[`docs/IA.md`](docs/IA.md)**: quais ferramentas, em que
partes, **o que fiz sem IA**, e os casos em que a validação real reprovou o que a
ferramenta tinha proposto.

Resumo: o Claude Code escreveu a maior parte das linhas, sempre sob o fluxo
*spec → teste vermelho → implementação → validação real*, descrito em
[`AGENTS.md`](AGENTS.md) e [`CLAUDE.md`](CLAUDE.md). Os artefatos do caminho
estão versionados junto, como o enunciado pede: 12 specs com critérios de
aceitação e evidência do que foi medido em [`docs/plan/`](docs/plan/), a
documentação de sistema em [`SDD/`](SDD/), e a configuração do agente em
`.claude/`.

O histórico do git acompanha o processo commit a commit, incluindo os `fix:` que
desfazem decisões anteriores.

---

## Deploy

API no **Railway**, site na **Vercel**, ambos por push na `main`.

O que precisa estar configurado no Railway, além dos segredos do `.env`:

| Variável | Por quê |
|---|---|
| `CORS_ORIGIN` | A URL da Vercel. Aceita lista separada por vírgula, para os domínios de preview |
| `PORT=3000` | O Railway injeta 8080 por padrão, mas o domínio foi criado apontando para 3000 |
| `DB_SYNCHRONIZE=true` | Cria o schema no boot — não há migrations |
| `RUN_SEED_ON_BOOT=true` | A imagem de produção só tem `dist/`, então `npm run seed` (ts-node sobre `src/`) não existe lá |
| `GOOGLE_CALLBACK_URL` | O endereço precisa estar **também** registrado no Google Cloud Console, idêntico |

Na Vercel, *Root Directory* = `frontend`. A única variável a criar lá é
`VITE_STRIPE_PUBLISHABLE_KEY`. **Não crie `VITE_API_URL` no painel** — as
variáveis do painel sobrescrevem o `.env.production` do repositório, e no
primeiro deploy ela foi criada com o valor `teste`: todas as chamadas viraram
`https://<site>/teste/events`, que o rewrite de SPA respondia com o `index.html`,
HTTP 200. A tela ficava vazia sem nenhum erro visível.

---

## O que não está como deveria

O enunciado pede que o que não funciona como esperado esteja escrito. Está aqui.

### Limitações assumidas

| Item | Situação | O que seria o certo |
|---|---|---|
| **Migrations** | Não existem. O schema nasce do `synchronize` do TypeORM no boot | Para um projeto deste tamanho — oito tabelas, uma pessoa, banco que nasce vazio a cada ambiente — migrations seriam cerimônia: eu escreveria arquivo de migração para um histórico que não existe. Num banco com dados de gente de verdade, a conta muda: `synchronize` pode perder coluna ao alterar uma entidade, e aí migrations versionadas passam a ser obrigatórias |
| **Sessão de 15 minutos** | `POST /auth/refresh` exige um token ainda válido, então depois de expirado não há renovação. Quem deixa a aba aberta e volta meia hora depois cai no login | Cookie de refresh próprio, com rotação. Não fiz a dias da entrega porque mexer em autenticação no fim é onde se quebra o que já funciona |
| **Postgres sem volume no Railway** | Um redeploy do banco zera os dados. O seed se recria sozinho, mas ingressos comprados somem | Anexar volume ao serviço, ou usar Postgres gerenciado |
| **QR guardado como base64 no banco** | Infla a linha do ingresso | Guardar em bucket e salvar a URL |
| **Dependências** | 3 avisos `high` em pacotes de produção, nenhum alcançável por esta superfície | Migrar para o Nest 11. Justificativa item a item em [`SDD/05-seguranca/DEPENDENCIAS.md`](SDD/05-seguranca/DEPENDENCIAS.md) |
| **2FA/OAuth** | Só TOTP e só Google | SMS e magic link exigem provedor de envio; Apple exige conta paga |

### Verificado funcionando

Pagamento na Stripe (`4242…` aprova, `4000…0002` recusa) com webhook emitindo o
ingresso · assentos atualizando ao vivo · portaria devolvendo válido / já
utilizado / evento errado / fora do horário / evento cancelado · meia-entrada
com cota transacional e documento mascarado · catálogo trazendo shows e filmes
reais · compartilhamento entre duas contas, com o ingresso de quem enviou
invalidado · cancelamento devolvendo 6 de 6 assentos, invalidando ingressos e
estornando na Stripe · sessão em cookie com `localStorage` vazio · mutação sem
token de CSRF recusada com 403 · 6º cadastro no mesmo minuto recusado com 429.

Cada uma dessas linhas tem a medição correspondente na spec do checkpoint
correspondente, em [`docs/plan/`](docs/plan/).

---

## Estrutura do repositório

```
.
├── docker-compose.yml        Postgres + Redis + API
├── AGENTS.md, CLAUDE.md      Regras e contrato de trabalho seguidos no projeto
├── .claude/                  Configuração do agente, versionada
├── docs/
│   ├── IA.md                 Uso de IA: ferramentas, onde, e o que foi sem IA
│   ├── plan/                 12 specs, com critérios de aceitação e evidência
│   └── templates/
├── SDD/                      Documentação de sistema (05-seguranca traz o modelo de ameaças)
├── backend/
│   ├── Dockerfile            Multi-stage: base (dev) e produção
│   └── src/
│       ├── main.ts           Bootstrap: helmet, CORS, cookie-parser, corpo cru da Stripe
│       ├── app.module.ts     Módulos e guards globais
│       ├── shared/           Erros, filtro, guards, interceptors, decorators, config
│       ├── auth/  event/  reservation/  payment/  ticket/  gate/  sharing/
│       ├── user/  audit/
│       └── seed/             4 usuários, 16 eventos, ~6.000 assentos
└── frontend/
    ├── vercel.json           Build e rewrite de SPA
    └── src/
        ├── pages/            Vitrine, evento, checkout, ingressos, portaria, organizador
        ├── components/       Mapa de assentos, modal de pagamento, assistente de evento
        ├── context/          Sessão e avisos
        ├── hooks/            WebSocket de assentos e de ingressos
        └── lib/              Cliente HTTP, higienização, rotas por papel
```
