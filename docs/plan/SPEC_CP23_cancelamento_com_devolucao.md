# SPEC — CP23: Cancelar devolve ao estoque

## Contexto

Cancelar um evento hoje troca uma palavra no banco:

```ts
event.status = EventStatus.CANCELLED;
// TODO: Trigger refund for all paid reservations (Checkpoint 7)
```

Tudo o mais fica onde estava. Os assentos vendidos continuam `sold`, os
ingressos continuam `active` — e continuam **abrindo a portaria**, porque a
validação olha a janela de entrada do evento, não o status dele. O dinheiro
continua com a gente. Do ponto de vista de quem comprou, o evento foi cancelado
e nada aconteceu.

O enunciado lista "cancelamento com devolução ao estoque" entre os opcionais que
contam nota, e é a primeira coisa que alguém testa depois de criar um evento.

## Requisitos funcionais

- RF-1: Cancelar um evento devolve **todos** os assentos vendidos e reservados
  para `available`.
- RF-2: Os ingressos ativos daquele evento passam a `invalidated`.
- RF-3: As reservas pagas são estornadas na Stripe (modo de teste) e passam a
  `refunded`; as pendentes viram `cancelled`.
- RF-4: A portaria recusa ingresso de evento cancelado com mensagem própria —
  não pode continuar liberando entrada para um evento que não vai acontecer.
- RF-5: O gateway anuncia a liberação, para quem estiver com o mapa aberto ver
  os lugares voltarem.
- RF-6: Cancelar duas vezes não estorna duas vezes.

## Requisitos não-funcionais

- RNF-1: A mudança de estado no banco é uma transação só. Meio cancelamento —
  assentos livres com ingressos ainda válidos — é pior que nenhum.

## Decisão: o estorno acontece FORA da transação

Estorno é chamada de rede para a Stripe. Duas opções ruins e uma escolha:

- Dentro da transação: os bloqueios do banco ficam abertos durante a latência da
  rede, e um erro no `commit` depois de a Stripe já ter devolvido o dinheiro
  produz estorno que ninguém registrou.
- Fora, antes do commit: se o commit falha, o cliente recebeu o dinheiro de um
  evento que continua à venda.

Escolha: **commit primeiro, estorno depois**. O cancelamento é a decisão do
organizador e precisa valer imediatamente — é ele que fecha a entrada e libera
os assentos. O estorno é consequência, e é retentável: cada um usa chave de
idempotência na Stripe, então repetir a operação não devolve dinheiro duas
vezes. O que sobra em caso de falha é uma reserva paga com evento cancelado, que
aparece no log e pode ser reprocessada — visível, não silenciosa.

## Considerações de segurança

- Só o organizador dono cancela; evento de outro responde 404, como o resto do
  módulo.
- A idempotência do estorno é garantida pela Stripe (`idempotencyKey` derivada
  da reserva) **e** pelo status local: uma reserva já `refunded` não é
  reprocessada.
- Invalidação dos ingressos é o que impede o uso do QR depois do cancelamento;
  a checagem na portaria é a segunda barreira, não a única.

## Critérios de aceitação — testáveis

- AC-1: Evento com assentos vendidos e reservados → todos voltam a `available`.
- AC-2: Ingressos ativos do evento → `invalidated`.
- AC-3: Reserva paga → `refunded`, com estorno pedido à Stripe uma vez.
- AC-4: Reserva pendente → `cancelled`, sem estorno.
- AC-5: Cancelar de novo → nenhum estorno adicional (AC de idempotência).
- AC-6: Falha da Stripe não desfaz o cancelamento; fica registrada em log.
- AC-7: Portaria recusa ingresso de evento cancelado com código próprio.
- AC-8: Evento sem venda nenhuma cancela sem erro.
- AC-9: Cancelar continua exigindo posse — outro organizador recebe 404.

## Validação real

- Organizador cancela um evento com ingresso vendido: conferir no banco que os
  assentos voltaram, o ingresso ficou `invalidated` e a reserva `refunded`; na
  Stripe de teste, o estorno aparece; na portaria, aquele QR é recusado.

## Status
- [x] Spec escrita
- [x] Testes escritos — vermelhos (6 ACs)
- [x] Implementação concluída — testes verdes (156/156)
- [x] Validação real executada — 2026-08-13

### Evidência da validação real

Evento criado, ingresso comprado com pagamento **real** de teste na Stripe
(`tok_visa`), depois cancelado:

| Verificação | Resultado |
|---|---|
| Assentos antes | `sold: 1, available: 5` |
| Assentos depois | **`available: 6`** — AC-1 ✔ |
| Ingresso do comprador | `active` → **`invalidated`** — AC-2 ✔ |
| Reserva | `paid` → **`refunded`** — AC-3 ✔ |
| Log da API | "1 estornadas, 0 pendentes canceladas, **0 falhas**" |
| Portaria com aquele QR | **400** — "Este evento foi cancelado. Nenhum ingresso dá entrada." — AC-7 ✔ |
| Cancelar de novo | 200, e **nenhum** estorno adicional no log — AC-5 ✔ |
| Tempo total da operação | 883 ms |
