# SPEC — CP19: Tirar o organizador do beco (e destravar o Google)

## Contexto

Duas coisas vieram do uso real.

**1. O organizador ficou preso.** O CP17 tirou o organizador da loja para ele
parar de encontrar um botão de compra que o backend recusa. A intenção estava
certa; a dose, não. Quem testou disse que **não conseguia voltar para a tela
inicial** e que **não havia outra tela**: `/`, `/events` e `/events/:id` todos
devolviam para o painel, e o logo apontava para o próprio painel. O papel virou
um cômodo com uma porta só — e, pior, a pessoa não consegue nem *ver* como o
próprio evento aparece para quem compra.

O erro de projeto foi confundir duas coisas diferentes: **não poder comprar** e
**não poder olhar**. Só a primeira é verdade.

**2. Login com Google quebrado em produção.** `GOOGLE_CALLBACK_URL` não existia
nas variáveis do Railway. O passport aceita `callbackURL: undefined` calado e
monta a URL de autorização **sem** `redirect_uri`; quem descobre é o usuário,
numa tela do Google — *"Erro 400: Missing required parameter: redirect_uri"* —
que parece erro do Google e é nosso.

## Requisitos funcionais

### O organizador volta a circular

- RF-1: `isStoreBlocked` volta a ser só a portaria. O organizador navega `/`,
  `/events` e `/events/:id` como qualquer visitante.
- RF-2: Quem **não pode comprar** (organizador, portaria, visitante sem conta)
  não vê botão de compra. No lugar dele, uma explicação em uma linha do porquê
  — nunca um botão que só descobre a recusa depois do clique.
- RF-3: O organizador vendo **um evento seu** na vitrine tem atalho para a tela
  de bilheteria daquele evento (`/organizer/events/:id`).
- RF-4: O painel oferece, em cada evento à venda, o link para **ver na vitrine**
  — é assim que ele confere o que o cliente enxerga.
- RF-5: A barra de navegação do organizador tem mais de um destino: vitrine e
  painel.

### Google

- RF-6: Faltando `GOOGLE_CALLBACK_URL`, o endereço é derivado do domínio público
  da própria API, e em desenvolvimento do localhost. O valor nunca é vazio.
- RF-7: Quando o endereço é derivado, o boot registra aviso dizendo qual foi —
  configuração adivinhada precisa aparecer no log.

## Considerações de segurança

- Nada muda no servidor: `POST /reservations` continua `@Roles(CLIENT)`. Esconder
  o botão nunca foi o controle de acesso; é o que evita oferecer o que será
  negado.
- A posse do evento continua sendo checada no servidor. O frontend descobre "é
  meu?" comparando com `/events/my/list`, que já é a lista do próprio
  organizador — nenhum `organizerId` novo é exposto na resposta pública
  (Req 6.4).
- O mapa em modo leitura mostra o mesmo que `getAvailableSeats` já devolve
  publicamente hoje. Nenhum dado de comprador entra nessa tela.

## Critérios de aceitação — testáveis

- AC-1: `isStoreBlocked('organizer')` é falso; `isStoreBlocked('gate')` continua
  verdadeiro.
- AC-2: `canBuyTickets` é verdadeiro só para `client`.
- AC-3: Organizador em `/events/:id` vê o mapa **sem** botão de reservar e com a
  explicação.
- AC-4: Organizador em um evento **seu** vê o atalho para a bilheteria.
- AC-5: Visitante sem conta continua vendo o caminho de compra (ele *pode*
  comprar, depois de entrar).
- AC-6: Faltando `GOOGLE_CALLBACK_URL`, `resolveGoogleCallbackUrl` devolve uma
  URL absoluta terminada em `/auth/google/callback`.

## Validação real

- Entrar como organizador, navegar até a vitrine e abrir um evento próprio e um
  de terceiro; confirmar ausência de botão de compra e presença do atalho no
  próprio.
- Entrar com Google em produção até o fim.

## Status
- [x] Spec escrita
- [x] Testes escritos — vermelhos (6 ACs do callback)
- [x] Implementação concluída — testes verdes (122/122)
- [x] Validação real executada — 2026-08-12 (produção pendente do deploy)

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| Organizador em `/events` | abre a vitrine, 12 eventos — AC-1 ✔ |
| Barra do organizador | "Eventos" e "Painel" — dois destinos, RF-5 ✔ |
| Organizador num evento **seu** | "Este evento é seu — você está vendo a página como o cliente vê", com "Abrir bilheteria →" — AC-3 e AC-4 ✔ |
| Organizador num evento **de terceiro** | "Você está na vitrine como visitante. Organizadores não compram ingressos.", sem atalho — AC-3 ✔ |
| Botão de compra em qualquer um dos dois | nenhum — AC-3 ✔ |
| Visitante sem conta no mesmo evento | "Escolha seus assentos", 12 assentos clicáveis — AC-5 ✔ |
| Portaria em `/events` | continua indo para `/gate` — AC-1 ✔ |
| `GOOGLE_CALLBACK_URL` ausente | resolve para `.../auth/google/callback` — AC-6 ✔ (6 testes) |
