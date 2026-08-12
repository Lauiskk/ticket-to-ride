# SPEC — CP11: Portaria isolada e operável

## Contexto

Hoje a portaria é um cliente com uma tela a mais. O operador entra e cai na home de marketing,
tem "Eventos" no menu e navega pela vitrine como se fosse comprar — e `ProtectedRoute` até
redireciona quem erra de papel para `/events`, ou seja, para a loja. Nada disso faz sentido para
quem está num portão com um leitor de QR na mão.

Pior: **a validação não funciona hoje em nenhum evento**. `GateService.isEventActive` só aceita
ingresso entre 1 h antes e 7 h depois do início, e os 15 eventos do seed acontecem daqui a 5–55
dias. Qualquer QR legítimo devolve `EVENT_NOT_ACTIVE`. O fluxo mais importante do enunciado —
validar na entrada — é hoje impossível de demonstrar.

Este checkpoint dá à portaria uma tela própria, com a informação que ela precisa (o que está
acontecendo agora, quantos já entraram), e um evento ao vivo no seed para o fluxo fechar.

## Requisitos funcionais

- RF-1: O papel `gate` não acessa a home nem a vitrine. `/` e `/events` redirecionam para `/gate`.
- RF-2: O menu não exibe "Eventos" para o papel `gate`; o logo aponta para `/gate`.
- RF-3: Redirecionar por papel errado leva cada papel ao seu destino
  (`gate` → `/gate`, `organizer` → `/organizer`, `client` → `/events`), nunca sempre à loja.
- RF-4: A portaria tem uma lista própria de eventos (`GET /gate/events`) ordenada por
  proximidade da janela de validação, exibindo para cada evento: se está **aberto para entrada
  agora**, total de ingressos emitidos e quantos já foram validados.
- RF-5: O seed inclui **1 evento ao vivo** (início 30 min atrás, assentos numerados) para
  permitir comprar → validar → revalidar no mesmo dia.
- RF-6: A regra de janela de validação (−1 h a +7 h) permanece inalterada.

## Requisitos não-funcionais

- RNF-1: A tela da portaria é usável com uma mão e em pouca luz: alvos de toque grandes,
  resultado ocupando a tela inteira, contraste alto.

## Considerações de segurança

- `GET /gate/events` exige papel `gate`; um cliente autenticado recebe 403.
- O endpoint devolve apenas dados operacionais (título, local, horário, contagens). **Nunca**
  nome, e-mail ou documento de comprador — a portaria confere ingresso, não pessoas.
- A validação continua exigindo assinatura HMAC válida; a escolha do evento na tela é
  conveniência de UI e **não** substitui a checagem `payload.eventId === gateEventId` no servidor.
- Redirecionar `gate` para fora da loja é UX, não autorização: as rotas de compra já são
  bloqueadas no backend por `@Roles(UserRole.CLIENT)` e assim permanecem.

## Critérios de aceitação — testáveis

- AC-1: Dado um usuário `gate` autenticado, quando acessa `/`, então é levado a `/gate`.
- AC-2: Dado um usuário `gate` autenticado, quando acessa `/events`, então é levado a `/gate`.
- AC-3: Dado um usuário `gate`, então o menu não contém o link "Eventos".
- AC-4: Dado um usuário `organizer`, quando acessa uma rota só de cliente, então vai para
  `/organizer` (e não para `/events`).
- AC-5: Dado o seed executado, então existe exatamente 1 evento cuja janela de validação está
  aberta no instante da execução.
- AC-6: Dado o evento ao vivo e um ingresso válido dele, quando a portaria valida, então
  retorna `valid: true` — hoje retorna `EVENT_NOT_ACTIVE`.
- AC-7: Dado o mesmo ingresso já validado, quando a portaria valida de novo, então
  `TICKET_ALREADY_USED` e a primeira validação é preservada.
- AC-8: Dado um ingresso de outro evento, quando validado no evento ao vivo, então
  `INVALID_TICKET` com mensagem de evento errado, e o ingresso **não** é consumido.
- AC-9: Dado `GET /gate/events` chamado por um `gate`, então cada item traz
  `entryOpen`, `ticketsIssued` e `ticketsValidated`.
- AC-10: Dado `GET /gate/events` chamado por um `client`, então 403.

## Casos de borda

- AC-E1: Dado um evento futuro escolhido na portaria, quando um QR válido dele é lido, então
  `EVENT_NOT_ACTIVE` e o ingresso permanece `active` (regra 11.7 — não consumir).
- AC-E2: Dado um QR com assinatura adulterada, então `INVALID_TICKET` sem tocar no banco.
- AC-E3: Dado um evento sem nenhum ingresso emitido, então `GET /gate/events` retorna
  `ticketsIssued: 0` sem erro de divisão.

## Contrato de API

| Endpoint | Método | Papel | Response | Erros |
|---|---|---|---|---|
| `/gate/events` | GET | `gate` | `[{id, title, venueName, date, entryOpen, entryOpensAt, entryClosesAt, ticketsIssued, ticketsValidated}]` | 403 papel errado |
| `/gate/validate` | POST | `gate` | `{valid, ticketId, seatIdentifier, eventTitle, validatedAt}` | 400 `INVALID_TICKET`, 400 `EVENT_NOT_ACTIVE`, 409 `TICKET_ALREADY_USED` |

## Validação real

- Fluxo: seed novo → `client1` compra no evento ao vivo → `gate@ticket.dev` valida o QR →
  valida de novo → tenta o QR em outro evento.
- Evidência esperada: `valid: true`, depois `TICKET_ALREADY_USED`, depois `INVALID_TICKET`;
  `tickets.status` = `used` e `validated_by_gate_id` preenchido apenas uma vez.
- Critério: as três respostas distintas e corretas, com o ingresso consumido exatamente uma vez.

## Status

- [x] Spec aprovada pelo usuário (decisão "seed com evento acontecendo agora", 2026-08-11)
- [x] Testes escritos — vermelhos (`gate.service.spec.ts` 7 ACs + AC-5 em `seed.service.spec.ts`)
- [x] Implementação concluída — testes verdes (57/57 na suíte completa)
- [x] Validação real executada — 2026-08-11

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| `GET /gate/events` como `gate` | evento ao vivo em 1º, `entryOpen: true`, contadores presentes |
| `GET /gate/events` como `client` | **HTTP 403** — AC-10 ✔ |
| Compra no evento ao vivo + Stripe | `succeeded`, `ticketCount: 1` |
| 1ª validação | `{"valid":true,"seatIdentifier":"Sala 1-1-1"}` — AC-6 ✔ |
| 2ª validação do mesmo QR | `TICKET_ALREADY_USED` (409) — AC-7 ✔ |
| Mesmo QR em outro evento | `INVALID_TICKET` "different event" (400) — AC-8 ✔ |
| Estado final do ingresso | `used`, `validated_at` e `validated_by_gate_id` preenchidos **uma vez** |

**Pendente de validação por navegador:** AC-1, AC-2, AC-3 e AC-4 (redirecionamentos e menu).
O `roleHome`/`StoreRoute` compila e está montado em `/`, `/events` e `/events/:id`.

### Nota de implantação

O seed é idempotente (não roda se já existem usuários), então o evento ao vivo **não aparece
sozinho em banco já semeado**. Em banco existente ele foi inserido via SQL equivalente ao seed;
em instalação nova vem do próprio `SeedService`. Como a data é relativa a `now()`, um banco
semeado há mais de 7 h volta a não ter evento aberto — nesse caso, recriar o volume
(`docker-compose down -v && docker-compose up -d`) devolve a janela aberta.
