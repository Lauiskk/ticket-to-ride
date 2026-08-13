# CLAUDE.md — contrato operacional

> Regras inegociáveis: [AGENTS.md](AGENTS.md). Este arquivo é o *como*, no dia a
> dia. Em divergência, prevalece o AGENTS.md.

## O que é este projeto

Plataforma de eventos e ingressos. Organizador monta eventos a partir do
catálogo do Ticketmaster/TMDb, cliente compra e recebe ingresso com QR assinado,
portaria valida na entrada. Três papéis, um banco, um gateway de pagamento em
modo de teste.

Backend NestJS + PostgreSQL + Redis. Frontend React + Vite. Deploy: API no
Railway, site na Vercel.

## Comunicação

- Direto ao ponto. Sem tutorial básico, sem resumo do que acabou de ser dito.
- Não saber é resposta aceitável; inventar não é.
- Discordar é útil quando vem com o motivo e uma alternativa.

## Fluxo de uma mudança

1. **Spec** em `docs/plan/SPEC_CP<n>_<assunto>.md`, com ACs numerados. Modelo em
   `docs/templates/SPEC_TEMPLATE.md`.
2. **Testes vermelhos** para os ACs. Rodar e ver falhar — o texto da falha é a
   prova de que o teste testa algo.
3. **Implementação** até verde.
4. **Validação real**: navegador e/ou API contra o ambiente que roda. Preencher
   a tabela de evidência na spec com o que foi observado, não com o esperado.
5. **Commit** curto, em português, sem coautoria de IA.

## Comandos

```bash
# Banco, Redis e API (a API monta ./backend/src e roda em watch)
docker compose up -d

# Se algo parecer não ter surtido efeito, reconstrua: bind mount do Windows não
# propaga evento de arquivo de forma confiável
docker compose up -d --build api

# Testes do backend
cd backend && npm test

# Um arquivo só
cd backend && npx jest src/gate/gate.service.spec.ts

# Typecheck do frontend (o build já roda tsc -b antes do vite)
cd frontend && npx tsc -b

# Seed (idempotente — sai na hora se já houver usuário)
cd backend && npm run seed
```

Contas semeadas: `organizer@ticket.dev` / `Organizer123!`,
`client1@ticket.dev` e `client2@ticket.dev` / `Client123!`,
`gate@ticket.dev` / `Gate123!`.

## Convenções que este código já segue

- **Comentário explica o porquê, não o quê.** Se o comentário descreve o que a
  linha faz, ele é ruído; se descreve a armadilha que levou àquela linha, é o
  que salva a próxima pessoa. Vários comentários aqui citam o bug que motivou o
  código — mantenha esse padrão.
- **Erro do domínio é `AppError` com código.** O filtro global traduz para JSON e
  nunca devolve stack.
- **404 anti-enumeração.** Recurso de outra pessoa responde "não encontrado", não
  "sem permissão" — 403 confirmaria a existência.
- **Nada de SQL por concatenação.** As duas queries cruas usam `$1..$n`; o resto
  é query builder.
- **Dinheiro e cota são recalculados no servidor.** O cliente informa o quê, não
  quanto.
- **Mensagem para o usuário em português, sem culpar quem lê.** "Alguém garantiu
  esse lugar primeiro" é melhor que "SEAT_UNAVAILABLE".

## Armadilhas conhecidas deste repositório

| Armadilha | O que fazer |
|---|---|
| Duas rotas em `payments` | `StripeWebhookController` **antes** de `PaymentController` no array — senão `POST /payments/webhook` cai em `:reservationId`. Coberto por `payment.routing.spec.ts` |
| `CORS_ORIGIN` é lista com curinga | Nunca use como endereço. Para link navegável, `resolveFrontendUrl` |
| Cookie cross-site | Vercel→Railway exige `sameSite: 'none'` + `secure`. `lax` não é enviado, e o sintoma é login que "não faz nada" |
| Corpo cru da Stripe | O parser é customizado em `main.ts` e guarda `rawBody`. Trocar isso quebra a assinatura do webhook em silêncio |
| Contêiner com código velho | `docker compose up -d --build api` |
