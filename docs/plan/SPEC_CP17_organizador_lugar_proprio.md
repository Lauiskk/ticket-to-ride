# SPEC — CP17: O organizador tem o próprio lugar

## Contexto

Hoje o organizador entra na plataforma e cai na **vitrine do cliente**. Vê o carrossel de
"eventos perto de você", abre um evento e encontra o mapa de assentos com o botão *Reservar
assentos* — que o backend recusa (`@Roles(UserRole.CLIENT)` no `POST /reservations`), mas só
depois de a pessoa selecionar os lugares e clicar. A interface convida para uma porta trancada.

Pior: quando ele abre o próprio evento, vê a tela de **comprador**, não a de **produtor**. Não
existe forma de olhar quais lugares já foram vendidos — só o painel agregado
(`EventMetricsPanel`), que responde "quanto" mas nunca "onde". Um produtor de teatro que quer
saber se o balcão está encalhado não tem como descobrir.

Falta também definir de quem são os eventos do catálogo externo. O `getMyEvents` já filtra por
`organizerId`, então a posse existe no banco desde o CP12; o que faltou foi a interface parar
de misturar os papéis.

**Modelo escolhido: o catálogo é fonte, não estoque.** Ticketmaster e TMDb servem para o
organizador *montar* o evento dele — título, foto, local, data vêm de lá, mas o evento
resultante é dele, com a casa, o preço e a política de meia que ele definir. Ele não "assume"
um evento que já existe: dois organizadores podem montar sessões diferentes do mesmo filme, e
cada um vê apenas as próprias vendas.

## Requisitos funcionais

- RF-1: `organizer` entra na lista de papéis sem acesso à loja. `/`, `/events` e `/events/:id`
  redirecionam para `/organizer`. O link "Eventos" some da barra.
- RF-2: Nova rota `/organizer/events/:id` — a tela do evento **do ponto de vista de quem
  produz**: mapa de ocupação, métricas e as ações de bilheteria.
- RF-3: O mapa de ocupação usa o mesmo desenho do `SeatMap`, com três estados — **vendido**,
  **em reserva**, **livre** — e **nenhuma** interação de compra: sem seleção, sem total, sem
  botão de reservar.
- RF-4: A tela mostra o resumo por setor junto do mapa, para responder "qual parte da casa não
  está vendendo" sem contar quadradinho.
- RF-5: Cada evento no painel abre essa tela. O rascunho também — ele ainda não vendeu nada,
  mas o organizador precisa conferir a planta antes de colocar à venda.
- RF-6: Organizador sem nenhum evento cai numa tela que **ensina o caminho** (buscar no
  catálogo ou montar do zero), não numa lista vazia sem saída.

## Requisitos não-funcionais

- RNF-1: O mapa de ocupação de mil lugares não pode reintroduzir o peso derrubado no CP16:
  nada de componente de animação por assento.
- RNF-2: Sem endpoint novo. `GET /events/:id/metrics` e `GET /reservations/seats/:eventId` já
  existem e bastam.

## Considerações de segurança

- A posse continua sendo verificada **no servidor**: `getMetrics` passa por `findOwnedEvent`, e
  evento de outro organizador responde 404 — nunca 403, que confirmaria a existência.
- O bloqueio da loja é de interface. A recusa real continua no `@Roles(UserRole.CLIENT)` do
  `POST /reservations`: esconder o botão não é o controle de acesso, é o que evita oferecer o
  que será negado.
- O mapa de ocupação mostra **status de assento**, nunca quem comprou. `getAvailableSeats` já
  devolve só `id, section, row, number, status` — nenhum dado de comprador entra nesta tela.

## Critérios de aceitação — testáveis

- AC-1: Dado um usuário `organizer`, então `isStoreBlocked` é verdadeiro.
- AC-2: Dado um usuário `client`, então `isStoreBlocked` é falso — ele é o dono da loja.
- AC-3: Dado um visitante sem login, então `isStoreBlocked` é falso: a vitrine é pública.
- AC-4: Dado um `organizer` em `/events/:id`, então ele é redirecionado para `/organizer`.
- AC-5: Dado um organizador dono, `/organizer/events/:id` mostra o mapa com vendidos, reservados
  e livres, e **nenhum** botão de compra.
- AC-6: Dado um organizador que não é dono do evento, então a tela responde "evento não
  encontrado" (o 404 do backend).
- AC-7: Dado um organizador sem eventos, então o painel mostra o caminho para criar o primeiro.

## Casos de borda

- AC-E1: Evento de pista (sem fileira) → o mapa agrupa por setor sem coluna de fileira.
- AC-E2: Evento rascunho, sem nenhuma venda → mapa todo livre, ocupação 0%, sem divisão por zero.
- AC-E3: Evento sem assentos configurados → mensagem explicando, não um mapa vazio sem contexto.

## Contrato de API

Nenhuma mudança. A tela é composta de dois endpoints existentes:

| Endpoint | Método | Papel | Uso nesta tela |
|---|---|---|---|
| `/events/:id/metrics` | GET | `organizer` (dono) | números e quebra por setor |
| `/reservations/seats/:eventId` | GET | público | status de cada assento para o mapa |

## Validação real

- Fluxo: entrar como organizador → tentar abrir `/events` e ser levado ao painel → abrir um
  evento com vendas → conferir que os assentos vendidos aparecem marcados e batem com a métrica
  → confirmar que não existe nenhum botão de reservar na página.
- Critério: a contagem de vendidos no mapa é igual a `seatsSold` da métrica.

## Status
- [x] Spec escrita
- [x] Implementação concluída
- [x] Validação real executada — 2026-08-12

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| `organizer` abre `/events` | vai para `/organizer` — AC-4 ✔ |
| `organizer` abre `/events/:id` | vai para `/organizer` — AC-4 ✔ |
| Link "Eventos" na barra | some para o organizador |
| `/organizer/events/:id` (evento com vendas) | 60 assentos desenhados: **3 vendidos**, 0 em reserva, 57 livres — AC-5 ✔ |
| Contagem do mapa × `seatsSold` da métrica | 3 = 3 |
| Texto de compra na página (`Reservar`/`Comprar`/`Selecionado`) | **nenhum** — AC-5 ✔ |
| Métricas de evento de outro organizador | **404** — AC-6 ✔ |
| Painel de organizador recém-criado | tela com os 3 passos e "Criar o primeiro evento" — AC-7 ✔ |
