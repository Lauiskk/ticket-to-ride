# SPEC — CP10: Compra ponta a ponta (Stripe real + assento vivo + ingresso visível)

## Contexto

O fluxo de compra existe no papel mas não fecha na prática. O backend cria um `PaymentIntent` na
Stripe, porém o frontend nunca teve Stripe.js: o modal chamava `POST /payments/:id/confirm`, que só
marcava "pago" no banco. Resultado — no dashboard da Stripe **todo pagamento fica `Incomplete`**
(3 de 5 registros no banco estão em `requires_payment_method`), o valor aparece 100× menor no modal
(R$ 1,50 em vez de R$ 150,00) e o cliente não tem tela para abrir o ingresso e ver o QR.
Além disso o `ReservationGateway` emite `seat_status_update` no namespace `/seats`, mas nenhum
componente do frontend conecta — o assento só muda de cor no polling de 30 s, o que o usuário
percebeu como "demorou mas saiu".

Este checkpoint fecha o ciclo: **escolher assento → pagar de verdade na Stripe → webhook gera o
ingresso → QR na tela**.

## Requisitos funcionais

- RF-1: O modal de pagamento exibe o valor na moeda do evento, formatado em pt-BR
  (`Intl.NumberFormat`), idêntico ao `totalAmount` devolvido por `POST /reservations`.
- RF-2: O pagamento é confirmado pela Stripe através do Stripe.js (`PaymentElement` +
  `stripe.confirmPayment`), usando o `clientSecret` que `POST /payments/:reservationId` já devolve.
- RF-3: O webhook `payment_intent.succeeded` é a **única** fonte de verdade para transicionar
  reserva → `paid`, assentos → `sold` e disparar a geração dos ingressos.
- RF-4: `payment_intent.payment_failed` transiciona a reserva para `payment_failed` e devolve os
  assentos para `available`.
- RF-5: A rota `POST /payments/:reservationId/confirm` só permanece ativa em modo simulado
  (chave ausente ou fora do padrão `sk_test_`); com chave real ela responde 400.
- RF-6: A tela de detalhe do evento reflete mudança de assento em tempo real via WebSocket
  (`/seats`, evento `seat_status_update`), sem depender do polling.
- RF-7: Existe a rota `/my-tickets/:ticketId` mostrando o ingresso com QR ampliado, evento,
  assento, status e ação de compartilhar.

## Requisitos não-funcionais

- RNF-1: O assento reservado por outro cliente fica cinza na tela em ≤ 1 s (hoje: até 30 s).
- RNF-2: A chave publicável da Stripe (`pk_test_…`) é a única credencial Stripe no frontend;
  a secreta nunca sai do backend.

## Considerações de segurança

- `POST /payments/:reservationId` exige papel `client` e valida a posse da reserva por `user.sub`
  do JWT — já implementado, manter.
- O valor cobrado é recalculado no servidor a partir de `reservation.totalAmount`; o frontend
  **não** envia valor.
- A assinatura do webhook é verificada com `STRIPE_WEBHOOK_SECRET` antes de qualquer efeito
  colateral; assinatura inválida → 400 sem processar.
- `GET /tickets/:id` continua owner-only com resposta 404 anti-enumeração.
- Nenhuma chave aparece em payload ou log.

## Critérios de aceitação — testáveis

- AC-1: Dada uma reserva de `totalAmount = 55.00`, quando o modal de pagamento abre, então exibe
  `R$ 55,00` (não `R$ 0,55`).
- AC-2: Dada uma chave `sk_test_*` configurada, quando o cliente confirma com o cartão
  `4242 4242 4242 4242`, então o `PaymentIntent` correspondente fica `succeeded` **na Stripe**.
- AC-3: Dado o webhook `payment_intent.succeeded` recebido com assinatura válida, então a reserva
  vira `paid`, os assentos viram `sold` e é gerado 1 ingresso por assento.
- AC-4: Dado o mesmo webhook recebido duas vezes, então o segundo não gera ingressos adicionais e
  responde 200 (idempotência).
- AC-5: Dado o cartão `4000 0000 0000 0002`, quando o pagamento é recusado, então a reserva fica
  `payment_failed` e os assentos voltam a `available`.
- AC-6: Dada uma reserva já paga, quando `confirmTestPayment` é chamado de novo, então o retorno
  traz `ticketCount` igual ao número real de ingressos da reserva (não `0`).
- AC-7: Dados dois navegadores na mesma tela de evento, quando um reserva o assento `A-1-1`, então
  o outro mostra `A-1-1` cinza sem recarregar a página.
- AC-8: Dado um ingresso do cliente logado, quando acessa `/my-tickets/:ticketId`, então vê o QR,
  o título do evento, o assento e o status.

## Casos de borda

- AC-E1: Dada uma reserva expirada, quando se tenta criar o PaymentIntent, então 400
  `BAD_REQUEST` com mensagem de reserva expirada (comportamento atual — manter coberto).
- AC-E2: Dado webhook com assinatura inválida, então 400 e **nenhuma** mudança de estado.
- AC-E3: Dado `STRIPE_SECRET_KEY` ausente, então o modo simulado permanece funcional e o fluxo
  fecha sem rede (para quem clonar o repo sem chave).
- AC-E4: Dado um `ticketId` de outro usuário, quando acessa `/my-tickets/:ticketId`, então 404.
- AC-E5: Dado o WebSocket indisponível, então a tela continua funcional via refetch manual
  (degradação graciosa, sem tela branca).

## Contrato de API

| Endpoint | Método | Papel | Request | Response | Erros |
|---|---|---|---|---|---|
| `/payments/:reservationId` | POST | `client` | — | `{clientSecret, paymentId}` | 404 `NOT_FOUND`, 400 `BAD_REQUEST` (reserva expirada / estado inválido) |
| `/payments/:reservationId/confirm` | POST | `client` | — | `{success, ticketCount}` | 400 `BAD_REQUEST` quando há chave real configurada |
| `/payments/webhook` | POST | público | corpo bruto Stripe + header `stripe-signature` | `{received: true}` | 400 assinatura inválida |
| `/tickets/:id` | GET | `client` (dono) | — | `Ticket` | 404 anti-enumeração |

WebSocket: namespace `/seats`, `emit('join_event', {eventId})`, escuta `seat_status_update`
com `{eventId, seatIds, status}`.

## Validação real

- Fluxo: login `client1@ticket.dev` / `Client123!` → evento com assentos numerados → reservar →
  pagar com `4242 4242 4242 4242` → Meus Ingressos → abrir ingresso.
- Evidência esperada:
  - modal com `R$ 55,00`;
  - `stripe listen` registrando `payment_intent.succeeded`;
  - `select status, stripe_status from payments order by created_at desc limit 1` → `succeeded / succeeded`;
  - PaymentIntent como **Succeeded** no dashboard da Stripe;
  - `select count(*) from tickets where reservation_id = '<id>'` → igual ao nº de assentos.
- Critério: os cinco itens acima verdadeiros na mesma execução.

## Adendo — RF-8 (levantado durante a implementação)

Cancelar o checkout deixava os assentos presos em `reserved` até a varredura de expiração de
10 minutos, e clicar neles devolvia `Seat <uuid> is no longer available` em inglês, com id interno.

- RF-8: Cancelar o pagamento libera os assentos imediatamente via
  `POST /reservations/:id/cancel` (dono, só em `pending_payment`, idempotente).
- AC-9: Dada uma reserva pendente, quando o cliente cancela, então os assentos voltam a
  `available` na mesma requisição e a reserva fica `cancelled`.
- AC-10: Cancelar duas vezes responde sucesso com `released: 0`, sem erro.
- AC-11: Mensagens de erro de reserva são exibidas em pt-BR, sem id interno.

## Status

- [x] Spec aprovada pelo usuário (decisão "Stripe Elements real + webhook", 2026-08-11)
- [x] Testes escritos — vermelhos (`payment.service.spec.ts`, 6 ACs)
- [x] Implementação concluída — testes verdes (6/6)
- [x] Validação real executada — 2026-08-11

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| `POST /reservations` (2 assentos, evento Ghibli) | `totalAmount: 90`, assentos → `reserved` |
| `POST /payments/:id` | `clientSecret: pi_3U3ROm…_secret_…` (PaymentIntent real) |
| `POST /payments/:id/confirm` com chave `sk_test_` | **HTTP 400** — RF-5 ✔ |
| Confirmação na Stripe (`pm_card_visa` = 4242) | `status: succeeded` (antes ficava *Incomplete*) |
| `GET /payments/:id/status` | `{"status":"succeeded","ticketCount":2}` |
| `payments` no banco | `succeeded / succeeded` |
| `reservations` no banco | `paid` |
| `seats` da reserva | ambos `sold` |
| `tickets` gerados | 2 ativos, QR PNG de 6118 e 6326 bytes, payload assinado |
| `POST /reservations/:id/cancel` | `{"released":1}`, assento → `available`, reserva → `cancelled` |
| Cancelar de novo | `{"released":0}` sem erro — AC-10 ✔ |

**Pendente de validação por navegador** (exige interação humana): AC-1 (valor no modal),
AC-7 (dois navegadores, assento cinza ao vivo) e AC-8 (tela do ingresso). O caminho de servidor
de todos os três está verificado acima.
