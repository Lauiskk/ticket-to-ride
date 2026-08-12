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
docker-compose up -d    # PostgreSQL 16 + Redis 7
npm run seed            # Popula dados iniciais
npm run start:dev       # API com hot-reload na porta 3000
```

### Produção (Railway + Vercel)

**Backend (Railway/Render):**
- Build: `npm run build`
- Start: `npm run start:prod`
- Variáveis de ambiente: conforme `.env.example`
- Health check: `GET /health`

**Frontend (Vercel):**
- Framework: Vite
- Build output: `dist/`
- Environment: `VITE_API_URL=https://sua-api.railway.app`

**CORS:** configurado via `CORS_ORIGIN` no .env do backend.

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
