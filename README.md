# Ticket to Ride — Event Ticketing Platform

Uma plataforma completa de eventos e ingressos onde organizadores publicam eventos, clientes compram ingressos e a portaria valida a entrada via QR Code.

---

## Sumário

- [Arquitetura](#arquitetura)
- [Stack Tecnológico](#stack-tecnológico)
- [Decisões Técnicas](#decisões-técnicas)
- [Como Rodar](#como-rodar)
- [Seed de Dados](#seed-de-dados)
- [Endpoints da API](#endpoints-da-api)
- [Checkpoints](#checkpoints)
- [Testes](#testes)
- [Deploy](#deploy)
- [Tradeoffs e Limitações](#tradeoffs-e-limitações)

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                    React/Vite Frontend                    │
│         (Board game theme, carousels, seat maps)         │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTP + WebSocket
┌─────────────────────────▼───────────────────────────────┐
│                     NestJS API Server                     │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌────────┐  │
│  │   Auth   │ │  Events  │ │ Reservation │ │Payment │  │
│  │  Module  │ │  Module  │ │   Module    │ │ Module │  │
│  └──────────┘ └──────────┘ └─────────────┘ └────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐             │
│  │  Ticket  │ │   Gate   │ │   Sharing   │             │
│  │  Module  │ │  Module  │ │   Module    │             │
│  └──────────┘ └──────────┘ └─────────────┘             │
│                                                          │
│  ┌──────────────── Shared Module ─────────────────────┐  │
│  │ GlobalExceptionFilter | ResponseInterceptor        │  │
│  │ AuthGuard | RolesGuard | ValidationPipe            │  │
│  │ RequestIdMiddleware | AppError + ErrorCodes        │  │
│  └────────────────────────────────────────────────────┘  │
└────────────┬──────────────────┬──────────────────┬───────┘
             │                  │                  │
     ┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
     │ PostgreSQL 16│  │   Redis 7    │  │  Stripe API  │
     │  (TypeORM)   │  │ (blacklist,  │  │ (test mode)  │
     │              │  │  rate limit, │  │              │
     │              │  │  cache)      │  │              │
     └──────────────┘  └──────────────┘  └──────────────┘
```

### Padrões aplicados (dos projetos de referência)

| Padrão | Origem | Implementação |
|--------|--------|---------------|
| CustomError + ErrorCodes | Go/Fiber API | `AppError` class com `code`, `statusCode`, `message`, `errors[]` |
| ResponseHandler | Go/Fiber API | `ResponseInterceptor` — passthrough ou pagination envelope |
| Permission middleware | Go/Fiber API | `RolesGuard` + `@Roles()` decorator |
| Entity-based folders | Go/Fiber API | Cada módulo NestJS tem controller/service/dto/entity |
| Defense in depth | CyberAI | Ownership check no service layer (não só no guard) |
| Anti-enumeration | CyberAI | 404 para cross-user access, 403 para ownership violation |
| Fail-open blacklist | CyberAI | Redis indisponível → permite request + loga `BLACKLIST_UNAVAILABLE` |
| Argon2id | CyberAI | Hash de senhas com memoryCost=65536, timeCost=3, parallelism=4 |
| Rate limiting degradado | CyberAI | Redis down → in-memory fallback + loga `RATE_LIMIT_DEGRADED` |
| Idempotência | Prism/Elixir | Seed idempotente, webhook idempotente, token generation idempotente |
| State machine | Prism/Elixir | Event(draft→published→cancelled), Reservation, Ticket, SharingLink |
| Scope-based access | Prism/Elixir | Queries sempre filtram por userId no service layer |

---

## Stack Tecnológico

| Camada | Tecnologia | Por que esta e não outra |
|--------|------------|--------------------------|
| Backend | **NestJS 10** (TypeScript) | Módulos, DI, guards, interceptors — mapeia diretamente para a arquitetura do Go reference |
| ORM | **TypeORM** | Suporta `SELECT FOR UPDATE NOWAIT`, UUID PKs, @VersionColumn, migrations |
| Database | **PostgreSQL 16** | Confiável, suporta Haversine geo-queries, JSONB, constraint triggers |
| Cache | **Redis 7** | Rate limiting, token blacklist, catalog cache — tudo com fail-open |
| Auth | **Passport.js + JWT** | Dual-source (cookie + header), TOTP 2FA via otplib |
| Password | **@node-rs/argon2** | Argon2id nativo em Rust, sem problemas de compilação C++ no Windows |
| Payment | **Stripe** (test mode) | Melhor sandbox da indústria, webhook idempotent built-in |
| QR Code | **qrcode** package | PNG preferred, JPEG fallback, base64 data URL |
| Real-time | **Socket.io** via @nestjs/websockets | Room-based para updates por evento |
| Signing | **Node.js crypto** (HMAC-SHA256) | Nativo, sem dependências externas, constant-time verify |

---

## Decisões Técnicas

### Por que NestJS e não Express puro?

Express é minimalista — precisaríamos construir guards, DI, interceptors, validation do zero. NestJS entrega isso out of the box com uma arquitetura que mapeia 1:1 para o pattern entity-based do projeto Go de referência. Trade-off: mais boilerplate (decorators), mas muito mais estrutura.

### Por que TypeORM e não Prisma?

Prisma não suporta `SELECT FOR UPDATE NOWAIT` nativamente. A concorrência de assentos é o ponto mais crítico do sistema. TypeORM com `queryRunner` e `pessimistic_write_or_fail` dá controle total sobre o locking behavior. Trade-off: TypeORM tem mais footguns, mas para este caso a flexibilidade compensa.

### Por que HMAC-SHA256 e não JWT para tickets?

QR codes precisam ser compactos. Um JWT tem ~300 chars; nosso HMAC payload tem ~150 chars. Além disso, apenas o server verifica tickets (na portaria) — não precisa de verificação client-side que RSA/JWT permite. Trade-off: o gate precisa de conectividade com o server (não pode verificar offline).

### Por que fail-open no blacklist?

Se Redis cair, preferimos que um token revogado funcione por até 15 minutos (vida do access token) do que derrubar toda a autenticação do sistema. O trade-off é aceito porque: (a) access tokens expiram rápido, (b) logamos `BLACKLIST_UNAVAILABLE` para alerting.

### Por que não usar um auth provider externo (Supabase/Clerk)?

O briefing pede controle total sobre 2FA, magic links, OTP, e OAuth. Providers externos limitam customização e adicionam uma dependência de rede para TODA operação autenticada. Trade-off: mais código nosso, mas zero dependência de terceiros para auth.

---

## Como Rodar

### Pré-requisitos

- Node.js 20+ (recomendado: 20 LTS)
- Docker + Docker Compose (para PostgreSQL e Redis)
- Uma Stripe test key (opcional — o sistema funciona sem para testes locais)

### Setup rápido

```bash
# 1. Clone o projeto
cd "Ticket to ride project"

# 2. Instale dependências do backend
cd backend
npm install

# 3. Configure variáveis de ambiente
cp .env.example .env
# Edite .env com suas keys (ou use os valores default para dev local)

# 4. Suba PostgreSQL + Redis via Docker
cd ..
docker-compose up -d

# 5. Rode o seed (popula dados iniciais)
cd backend
npm run seed

# 6. Inicie a API em modo desenvolvimento
npm run start:dev
```

A API estará disponível em `http://localhost:3000`.

### Sem Docker (PostgreSQL e Redis locais)

Se já tiver PostgreSQL 16 e Redis 7 rodando localmente:

1. Crie o database: `CREATE DATABASE ticket_to_ride;`
2. Configure `DATABASE_URL=postgres://user:pass@localhost:5432/ticket_to_ride` no `.env`
3. Configure `REDIS_URL=redis://localhost:6379` no `.env`
4. O TypeORM sincroniza as tabelas automaticamente em modo development (`synchronize: true`)

---

## Seed de Dados

O comando `npm run seed` cria:

| Tipo | Dados |
|------|-------|
| Organizer | `organizer@ticket.dev` / `Organizer123!` |
| Client 1 | `client1@ticket.dev` / `Client123!` |
| Client 2 | `client2@ticket.dev` / `Client123!` |
| Gate | `gate@ticket.dev` / `Gate123!` |
| Event | "Rock in Rio - Noite Inaugural" (publicado, 14 dias no futuro) |
| Seats | 50 numerados (VIP + Pista Premium) + 200 pista geral |

O seed é **idempotente** — rodar várias vezes não duplica dados.

---

## Endpoints da API

### Autenticação

| Endpoint | Método | Auth | Descrição |
|----------|--------|------|-----------|
| `POST /auth/register` | Public | — | Cria conta |
| `POST /auth/login` | Public | — | Login (retorna JWT em cookie HttpOnly) |
| `POST /auth/logout` | Auth | JWT | Invalida token |
| `POST /auth/refresh` | Auth | JWT | Renova access token |
| `POST /auth/2fa/enable` | Auth | JWT | Gera secret TOTP |
| `POST /auth/2fa/verify` | Auth | JWT | Verifica código 2FA |

### Catálogo Externo

| Endpoint | Método | Auth | Descrição |
|----------|--------|------|-----------|
| `GET /catalog/search` | Organizer | JWT | Busca Ticketmaster + TMDb |

### Eventos

| Endpoint | Método | Auth | Descrição |
|----------|--------|------|-----------|
| `POST /events` | Organizer | JWT | Cria evento (draft) |
| `PATCH /events/:id/publish` | Organizer | JWT | Publica evento |
| `PATCH /events/:id/cancel` | Organizer | JWT | Cancela evento |
| `GET /events/my/list` | Organizer | JWT | Meus eventos |
| `GET /events` | Public | — | Browse com filtros/paginação |
| `GET /events/:id` | Public | — | Detalhes do evento |

### Reservas

| Endpoint | Método | Auth | Descrição |
|----------|--------|------|-----------|
| `POST /reservations` | Client | JWT | Reserva assentos (lock NOWAIT) |
| `GET /reservations/my` | Client | JWT | Minhas reservas |
| `GET /reservations/seats/:eventId` | Public | — | Assentos disponíveis |

### Pagamento

| Endpoint | Método | Auth | Descrição |
|----------|--------|------|-----------|
| `POST /payments/:reservationId` | Client | JWT | Cria PaymentIntent (Stripe) |
| `POST /payments/webhook` | Public | Stripe Sig | Webhook do Stripe |

### Ingressos

| Endpoint | Método | Auth | Descrição |
|----------|--------|------|-----------|
| `GET /tickets` | Client | JWT | Meus ingressos |
| `GET /tickets/:id` | Client | JWT | Detalhe do ingresso |

### Portaria

| Endpoint | Método | Auth | Descrição |
|----------|--------|------|-----------|
| `POST /gate/validate` | Gate | JWT | Valida QR code |

### Compartilhamento

| Endpoint | Método | Auth | Descrição |
|----------|--------|------|-----------|
| `POST /sharing/tickets/:id/share` | Client | JWT | Gera link |
| `POST /sharing/:token/accept` | Client | JWT | Aceita transferência |

---

## Checkpoints

O projeto foi construído incrementalmente em 9 checkpoints:

| # | Checkpoint | O que entrega |
|---|-----------|---------------|
| 1 | Project Setup | Error handling padronizado, validation pipe, request ID, Docker Compose |
| 2 | Database Schema | 8 entities TypeORM, migrations, seed idempotente |
| 3 | Auth & RBAC | JWT dual-source, Argon2id, 2FA, rate limiting, guards globais |
| 4 | External Catalog | Ticketmaster + TMDb com cache Redis 1h e fallback |
| 5 | Event CRUD | Criar, publicar, cancelar, browse com filtros e geo-sort |
| 6 | Reservations | Pessimistic locking (NOWAIT), multi-seat atomic, expiration, WebSocket |
| 7 | Payment | Stripe test mode, webhooks idempotentes, state transitions |
| 8 | Tickets + Gate | HMAC-SHA256 QR, retry 3x, validação com status preservation |
| 9 | Sharing | Link 48h, prioridade USED > EXPIRED, transfer com novo QR |

---

## Testes

```bash
# Rodar todos os testes
npm run test

# Rodar com coverage
npm run test:cov

# Rodar um arquivo específico
npx jest --testPathPattern "nome-do-arquivo"
```

### Tipos de teste implementados

| Tipo | Ferramenta | O que testa |
|------|-----------|-------------|
| Property tests | fast-check + Jest | Propriedades universais (P1-P34 do design document) |
| Unit tests | Jest + mocks | Services, guards, filters com cenários específicos |
| Seed test | Jest | Idempotência do seed (rodar 2x = mesmo resultado) |

### Exemplos de property tests

- **P1**: Error responses sempre têm `{message, code, statusCode}`, nunca pagination metadata
- **P6**: `hash(password)` + `verify(password, hash)` = true para qualquer string
- **P9**: Rightmost IP do X-Forwarded-For é extraído corretamente
- **P11**: Matriz RBAC (Gate só valida, Organizer bloqueado de Client endpoints)

---

## Deploy

### Local (desenvolvimento)

```bash
docker-compose up -d    # PostgreSQL 16 + Redis 7 + API
npm run seed            # Popula dados iniciais
npm run start:dev       # API com hot-reload na porta 3000
```

O compose também sobe a API (`ttr-api`), montando `backend/src` e rodando
`start:dev`. Se você editar o código com o contêiner rodando, prefira
`docker compose up -d --build api` quando algo parecer não ter surtido efeito:
bind mount do Windows não propaga eventos de arquivo, e o watcher já ficou horas
servindo código antigo sem avisar. O `tsconfig` agora sonda arquivos
(`watchOptions`), o que resolve o caso normal.

### Produção — Railway (API) + Vercel (frontend)

A infraestrutura já está provisionada no Railway (projeto `gallant-charisma`):
serviços **ticket-to-ride** (API), **Postgres** e **Redis**, no ambiente `production`.

**API:** https://ticket-to-ride-production-ebbe.up.railway.app — **no ar** ✅

```
GET /health → {"status":"healthy","dependencies":{"database":{"status":"up"},"redis":{"status":"up"}}}
```

Verificado em produção: 16 eventos semeados (6015 assentos), login dos três papéis,
catálogo do Ticketmaster (140 eventos no Brasil), filmes em cartaz do TMDb (134) e a
agenda da portaria com o evento ao vivo aberto para entrada.

> **Falta apenas o frontend.** Depois de subir na Vercel, atualize `CORS_ORIGIN` no
> Railway para a URL da Vercel — enquanto estiver em `http://localhost:5173`, o
> navegador bloqueia as chamadas do site publicado.

#### 1. Variáveis do backend (Railway)

As variáveis não-secretas já estão configuradas (`NODE_ENV`, `DB_SYNCHRONIZE`,
`RUN_SEED_ON_BOOT`, `CORS_ORIGIN`, `REDIS_URL`). Faltam **apenas os segredos**, que
precisam ser colados por você no painel — em *Variables → Raw Editor* do serviço
`ticket-to-ride`:

```
DATABASE_URL=postgresql://ticket:SENHA_DO_POSTGRES@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/ticket_to_ride
JWT_SECRET=<32+ caracteres aleatórios>
TICKET_SIGNING_SECRET=<32+ caracteres aleatórios>
TICKETMASTER_API_KEY=<sua chave>
TMDB_API_KEY=<sua chave>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

> `SENHA_DO_POSTGRES` é o valor de `POSTGRES_PASSWORD` no serviço **Postgres**.
> `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}` é referência do próprio Railway — cole literalmente.

Gerar segredos fortes:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

#### 2. Primeiro boot

Duas flags existem para o **primeiro** deploy num banco vazio:

| Variável | O que faz |
|---|---|
| `DB_SYNCHRONIZE=true` | Cria o schema a partir das entidades. O projeto ainda não tem migrations; sem isso, o banco sobe sem nenhuma tabela. |
| `RUN_SEED_ON_BOOT=true` | Roda o seed no startup. A imagem de produção só tem `dist/`, então `npm run seed` (ts-node sobre `src/`) não existe lá. |
| `PORT=3000` | O Railway injeta `PORT=8080` por padrão, mas o domínio foi criado apontando para 3000. Fixar aqui evita a API subir saudável e o domínio devolver 502. |

O seed é idempotente — sai na hora se já existir usuário. Depois do primeiro boot
bem-sucedido, o recomendado é desligar `DB_SYNCHRONIZE` (ver *Limitações*).

#### 3. Frontend (Vercel)

O repositório já traz `frontend/vercel.json` (framework, build e o rewrite de SPA — sem
ele, recarregar em `/events` daria 404) e `frontend/.env.production` com a URL da API.

1. Vercel → **Add New → Project** → importe `Lauiskk/ticket-to-ride`
2. **Root Directory:** `frontend`
3. Em *Environment Variables*, adicione **apenas** a chave publicável da Stripe:
   `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`
   (sem ela o checkout cai no modo simulado, que ainda fecha o fluxo)

   > ⚠️ **Não crie `VITE_API_URL` na Vercel.** As variáveis do painel sobrescrevem
   > o `.env.production` do repositório. No primeiro deploy ela foi criada com o
   > valor `teste`, e todas as chamadas viraram `https://<site>/teste/events` —
   > que o rewrite de SPA respondia com o `index.html`, HTTP 200. A tela ficava
   > vazia sem nenhum erro visível. Se ela existir, **apague e redeploy**.
4. Deploy

#### 4. Fechar o circuito

Depois que a Vercel devolver a URL, atualize no Railway:

```
CORS_ORIGIN=https://<seu-projeto>.vercel.app
```

#### Webhook da Stripe — já criado ✅

Endpoint `we_1U3d2O80lOSI3x5bjApaGFZI`, ativo, apontando para
`https://ticket-to-ride-production-ebbe.up.railway.app/payments/webhook`,
ouvindo `payment_intent.succeeded` e `payment_intent.payment_failed`. O
`STRIPE_WEBHOOK_SECRET` correspondente já está no Railway.

> **Não fixe `api_version` ao criar o endpoint.** A conta está em
> `2026-07-29.dahlia`; passar `api_version=2024-06-20` devolve
> `Invalid request (check your POST parameters)` sem dizer qual parâmetro.

Validado em produção: cartão `4242…` → webhook entregue (`pending_webhooks: 0`)
→ reserva `paid` → ingresso com QR emitido. Cartão `chargeDeclined` → assento de
volta para `available`.

#### 5. CI/CD

`.github/workflows/ci.yml` roda a cada push e PR: testes + build do backend, typecheck
+ build do frontend, e build da imagem Docker. `deploy.yml` só dispara **depois do CI
verde** em `main`, e pula com aviso quando os tokens não existem — um fork não recebe
pipeline vermelho por infraestrutura que não é dele.

Para ligar o deploy automático, cadastre os secrets no repositório:

```bash
gh secret set RAILWAY_TOKEN      # railway tokens create
gh secret set VERCEL_TOKEN       # vercel.com/account/tokens
gh secret set VERCEL_ORG_ID      # frontend/.vercel/project.json após `vercel link`
gh secret set VERCEL_PROJECT_ID  # idem
```

---

## Limitações conhecidas

> O enunciado pede que o que não funciona como esperado esteja escrito. Está aqui.

### Precisa de ação manual

| O quê | Por quê | Como resolver |
|---|---|---|
| Segredos do Railway | Foram deixados de fora de propósito — chave da Stripe e segredos de assinatura não devem trafegar por automação de terceiros | Colar no *Raw Editor* conforme a seção de Deploy |
| Projeto na Vercel | O deploy por arquivo não permite definir variáveis de build; a integração com o GitHub dá deploy contínuo, que é melhor | Importar o repo apontando *Root Directory* para `frontend` |
| Webhook da Stripe | A URL de produção só existe depois do deploy | Cadastrar no painel da Stripe |

### Limitações técnicas assumidas

| Item | Situação | O que seria o certo |
|---|---|---|
| `DB_SYNCHRONIZE` | Cria o schema a partir das entidades. Não há migrations. | Migrations versionadas; `synchronize` pode perder dados ao alterar uma entidade |
| Postgres e Redis no Railway | Containers `postgres:16-alpine` e `redis:7-alpine` **sem volume** | Um redeploy zera o banco. Como `RUN_SEED_ON_BOOT` está ligado, ele se recria sozinho — mas ingressos comprados somem. Para valer: anexar volume ou usar o Postgres gerenciado |
| Reembolso ao cancelar evento | Só registra log | Chamar `refunds.create` na Stripe para cada reserva paga |
| Scheduler de expiração | `setInterval` de 30 s no processo | `@nestjs/schedule`; com múltiplas réplicas hoje rodaria em todas |
| QR no banco | PNG em base64 na coluna | Guardar em bucket e salvar a URL |
| Meia-entrada | Declaração + documento conferido na portaria | Upload de comprovante com moderação, se o rigor exigir |
| 2FA / OTP / magic link | Só o TOTP (2FA) está implementado | OTP por SMS/WhatsApp e magic link exigem provedor de envio |
| OAuth | Só Google | Apple exige conta paga de desenvolvedor |

### Armadilha resolvida — vale saber

`PaymentController` e `StripeWebhookController` moram os dois em `payments`, e o
primeiro declara `POST :reservationId`. Registrado antes, ele engolia
`POST /payments/webhook` como `reservationId = "webhook"` — rota exclusiva de
cliente — e a Stripe recebia **401**. O `@Public()` do webhook nunca era
consultado, e o `ParseUUIDPipe` nunca chegava a rejeitar `"webhook"` porque
guards rodam antes de pipes.

Pior: o sintoma era invisível. O pagamento fechava mesmo assim, porque o modal de
checkout consulta `/payments/:id/status`, que reconcilia direto com a Stripe. A
aplicação parecia saudável enquanto **toda** entrega de webhook falhava.

A ordem em `payment.module.ts` agora é obrigatória e está travada por teste
(`payment.routing.spec.ts`).

### Verificado e funcionando

Pagamento real na Stripe (`4242…` aprova, `4000…0002` recusa) com webhook emitindo o
ingresso · assentos atualizando ao vivo por WebSocket · portaria devolvendo válido /
já utilizado / evento errado / fora do horário · meia-entrada com cota transacional e
documento mascarado · catálogo trazendo 56 shows no Brasil e 135 filmes em cartaz.
Detalhe de cada validação em `docs/plan/SPEC_CP1*.md`.

---

## Tradeoffs e Limitações

| Item | Decisão | Trade-off aceito |
|------|---------|-----------------|
| `synchronize: true` | Usado em dev para auto-criar tabelas | Em produção, usar migrations |
| Reservation scheduler | `setInterval` 30s | Em produção, usar @nestjs/schedule com Cron |
| QR como data URL | Base64 no banco | Em produção, salvar PNG em S3/bucket |
| Rate limiting | Redis-backed | Se Redis cai, fallback in-memory (menos preciso) |
| Geo-sort | Haversine em SQL | Para volume alto, considerar PostGIS |
| Auth próprio | Full control | Mais código para manter vs auth provider |
| Token blacklist | Fail-open | Token revogado pode funcionar até 15min se Redis cair |
| Event cancellation | Refund é placeholder | Stripe refund real precisa de implementação adicional |

---

## Estrutura de Pastas

```
Ticket to ride project/
├── docker-compose.yml       (PostgreSQL + Redis + API)
├── README.md                (este arquivo)
└── backend/
    ├── package.json
    ├── tsconfig.json         (strict mode, @shared/* alias)
    ├── Dockerfile            (multi-stage: dev + production)
    ├── .env.example          (todas as variáveis documentadas)
    └── src/
        ├── main.ts           (bootstrap com helmet, compression, CORS, cookie-parser)
        ├── app.module.ts     (registra todos os módulos + global guards)
        ├── shared/           (errors, filters, interceptors, guards, decorators, pipes, config)
        ├── auth/             (JWT, Argon2id, 2FA, blacklist, rate-limit)
        ├── user/             (entity)
        ├── event/            (CRUD, catalog Ticketmaster/TMDb, entities)
        ├── reservation/      (pessimistic lock, WebSocket, scheduler)
        ├── payment/          (Stripe, webhooks)
        ├── ticket/           (HMAC signing, QR generation)
        ├── gate/             (validation)
        ├── sharing/          (link generation, transfer)
        ├── audit/            (entity — logging service TODO)
        └── seed/             (4 users + 1 event + 250 seats)
```
