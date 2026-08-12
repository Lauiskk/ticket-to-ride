# SPEC — CP12: Painel do organizador e meia-entrada

## Contexto

O painel do organizador é hoje um formulário de três passos sem nenhuma validação: dá para
avançar com todos os campos vazios e só descobrir o problema quando a API recusa. O status
aparece cru na tela (`published`, `draft`) e o botão diz "Publicar", vocabulário de blog, não de
bilheteria. A escolha entre assentos numerados e pista existe no backend
(`EventService.createSeats` lê `sections` e `sectors`) mas **não é exposta no formulário** — todo
evento criado pela interface vira pista genérica. E o organizador vê a mesma vitrine do cliente,
sem nenhuma informação de venda: quantos entraram, quanto entrou de dinheiro, quais lugares
sobraram.

Falta também a meia-entrada, que no Brasil não é um extra: a Lei 12.933/2013 obriga 40% dos
ingressos a meio preço para estudantes, idosos e pessoas com deficiência. Sem ela o produto não
é crível como plataforma de ingressos.

## Requisitos funcionais

### Criação de evento
- RF-1: Cada passo do formulário valida seus campos obrigatórios e bloqueia o avanço, com
  mensagem por campo (não um erro genérico no topo).
- RF-2: A data deve ser futura; datas passadas são recusadas na interface, não só na API.
- RF-3: O organizador escolhe explicitamente **assentos numerados** (setores com fileiras ×
  lugares) ou **pista** (setores por quantidade), com prévia da contagem total antes de criar.
- RF-4: A capacidade exibida é derivada da configuração de assentos, não digitada solta —
  hoje é possível criar um evento com capacidade 100 e 300 assentos.

### Vocabulário
- RF-5: Status exibidos em português: `draft` → **Rascunho**, `published` → **À venda**,
  `cancelled` → **Cancelado**. A ação `publish` chama-se **"Colocar à venda"**.

### Métricas
- RF-6: `GET /events/:id/metrics` (organizador dono) devolve: assentos total/vendidos/reservados/
  disponíveis, taxa de ocupação, receita confirmada, ingressos emitidos, ingressos validados,
  quantidade de meias e quebra por setor.
- RF-7: O painel mostra essas métricas por evento, sem qualquer elemento de compra.

### Meia-entrada
- RF-8: O evento tem `halfPriceEnabled` (padrão: verdadeiro) e `halfPriceQuota` (nulo = sem
  limite). O formulário sugere 40% da capacidade, citando a lei.
- RF-9: No checkout, o cliente marca quais assentos são meia, escolhe a categoria
  (`student` | `senior` | `pcd`), informa o documento e aceita o termo de responsabilidade.
- RF-10: O preço da meia é **50% do preço cheio, calculado no servidor**. O cliente nunca envia
  valor.
- RF-11: Estourar a cota de meias do evento recusa a reserva inteira com erro específico.
- RF-12: O ingresso de meia nasce marcado, e a portaria recebe alerta
  **"MEIA — conferir documento"** com a categoria e o documento **mascarado**.

## Requisitos não-funcionais
- RNF-1: A validação de cota é feita dentro da mesma transação da reserva — duas compras
  simultâneas não podem furar a cota.

## Considerações de segurança
- `GET /events/:id/metrics` exige papel `organizer` **e** posse do evento; evento de outro
  organizador responde 404 (anti-enumeração, como o resto do módulo).
- As métricas são agregados. Nenhum nome, e-mail ou id de comprador aparece na resposta.
- O preço da meia é recalculado no servidor a partir de `event.price`; `halfPriceClaims` do
  cliente informa **quais** assentos e a categoria, nunca o valor.
- O documento é PII: fica gravado no ingresso, mas a portaria só recebe **máscara**
  (`***.789.***-**`). É o suficiente para conferir contra o documento físico sem despejar o
  número inteiro numa tela de portão. A resposta da validação nunca traz o documento completo.
- A cota é verificada no servidor com bloqueio transacional; o cliente não pode contorná-la
  repetindo a requisição.

## Critérios de aceitação — testáveis

- AC-1: Dado um evento de R$ 100 com 2 assentos, sendo 1 marcado como meia, quando a reserva é
  criada, então `totalAmount` é **150,00** (100 + 50).
- AC-2: Dado um cliente que envia um preço no corpo da requisição, então o valor é ignorado e o
  total é calculado do `event.price`.
- AC-3: Dado um evento com `halfPriceQuota: 2` e 2 meias já vendidas, quando outra meia é
  solicitada, então 409 com código `HALF_PRICE_QUOTA_EXCEEDED` e **nenhum** assento é reservado.
- AC-4: Dado um evento com `halfPriceEnabled: false`, quando uma meia é solicitada, então 400.
- AC-5: Dada uma reserva com 1 meia e 1 inteira paga, então são gerados 2 ingressos, exatamente
  1 com `isHalfPrice: true` e com categoria e documento gravados.
- AC-6: Dado um ingresso de meia validado na portaria, então a resposta traz
  `isHalfPrice: true`, a categoria e o documento **mascarado** — nunca o número completo.
- AC-7: Dado um ingresso inteiro validado, então `isHalfPrice: false` e nenhum campo de documento.
- AC-8: Dado um organizador dono do evento, `GET /events/:id/metrics` devolve os agregados com
  ocupação correta.
- AC-9: Dado um organizador que **não** é dono, então 404.
- AC-10: Dado um cliente autenticado, então 403.
- AC-11: Dado um evento sem nenhum assento vendido, então `occupancyRate` é 0 e não há divisão
  por zero.

## Casos de borda
- AC-E1: `halfPriceClaims` referenciando um assento fora de `seatIds` → 400.
- AC-E2: Documento vazio ou com menos de 5 caracteres → 400.
- AC-E3: Todos os assentos marcados como meia, dentro da cota → aceito, total = 50% × n.
- AC-E4: Cota nula (sem limite) → qualquer quantidade de meias é aceita.

## Contrato de API

| Endpoint | Método | Papel | Request | Response | Erros |
|---|---|---|---|---|---|
| `/events/:id/metrics` | GET | `organizer` (dono) | — | `{seatsTotal, seatsSold, seatsReserved, seatsAvailable, occupancyRate, revenue, currency, ticketsIssued, ticketsValidated, halfPriceTickets, bySection[]}` | 404 não-dono, 403 papel errado |
| `/reservations` | POST | `client` | `{eventId, seatIds[], halfPriceClaims?: [{seatId, category, document}]}` | `ReservationResponseDto` | 400 evento sem meia / claim inválida, 409 `HALF_PRICE_QUOTA_EXCEEDED`, 409 `SEAT_UNAVAILABLE` |
| `/gate/validate` | POST | `gate` | igual | acrescenta `{isHalfPrice, halfPriceCategory, holderDocumentMasked}` | igual |

`POST /events` ganha `halfPriceEnabled?: boolean` e `halfPriceQuota?: number | null`.

## Validação real
- Fluxo: organizador cria evento numerado com cota de meia → cliente compra 1 inteira + 1 meia →
  confere total no banco → paga → 2 ingressos, 1 marcado meia → portaria valida a meia e vê o
  alerta → organizador abre as métricas.
- Critério: total 150,00 para evento de 100,00; exatamente 1 ingresso meia; documento mascarado
  na resposta da portaria; ocupação batendo com os assentos vendidos.

## Achado durante a implementação — RF-13

A validação real reprovou o AC-3 na primeira tentativa: a cota contava **ingressos emitidos**,
e um comprador em checkout ainda não tem ingresso. Dois compradores simultâneos furavam a cota.

- RF-13: A cota conta as declarações de meia das reservas em `pending_payment` **e** `paid`,
  não os ingressos emitidos. Uma reserva pendente ocupa a cota igual a uma paga.

Também apareceu um efeito colateral do CP11: o evento ao vivo **não aparecia no catálogo**,
porque `browse()` filtrava `date > now`. Um evento que começou há 30 min sumia da vitrine — o
oposto do que faz uma bilheteria, que vende na porta. O corte passou a ser o mesmo da janela de
entrada da portaria (+7 h), para que catálogo e portaria nunca discordem sobre o que está
acontecendo.

## Status
- [x] Spec aprovada pelo usuário (decisão "declaração + documento", 2026-08-11)
- [x] Testes escritos — vermelhos (8 ACs de meia + 3 de portaria)
- [x] Implementação concluída — testes verdes (68/68)
- [x] Validação real executada — 2026-08-11

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| Evento R$ 30, 1 inteira + 1 meia | `totalAmount: 45` — AC-1 ✔ |
| Preço enviado pelo cliente no corpo | ignorado, total 200 no evento de 100 — AC-2 ✔ |
| Cota esgotada, nova meia | **409** `HALF_PRICE_QUOTA_EXCEEDED`, assento intocado — AC-3 ✔ |
| Inteira no mesmo assento logo depois | 201, total 30 |
| Reserva paga | 2 ingressos, exatamente 1 com `is_half_price` + categoria + documento — AC-5 ✔ |
| Portaria valida a meia | `isHalfPrice: true`, `student`, `holderDocumentMasked: "•••4001•••"` — AC-6 ✔ |
| `GET /events/:id/metrics` (dono) | ocupação 5%, receita R$ 75, 3 emitidos, 2 validados, 1 meia — AC-8 ✔ |
| `GET /events/:id/metrics` (cliente) | **403** — AC-10 ✔ |

### Validação pelo navegador (executada)

| Tela | Resultado |
|---|---|
| Painel do organizador | "À venda"/"Rascunhos" em português, cota de meia por evento |
| Métricas expandidas | ocupação, vendidos/reserva/livres, receita, por setor |
| Checkout com meia | assento cai para R$ 15,00, total R$ 45,00, categorias e termo aparecem |
| Botão antes do documento | bloqueado com "Complete os dados da meia-entrada" |
| Reserva criada pela UI | `total_amount 45.00` + `half_price_claims` com categoria `senior` |
| Cancelar no modal | reserva `cancelled`, 0 assentos presos |
