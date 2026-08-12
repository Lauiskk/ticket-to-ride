# SPEC — CP18: Tempo real onde a espera incomoda

## Contexto

Duas telas mentem sobre o estado das coisas.

**A portaria.** Ela valida um ingresso e marca `status = used` no banco. A tela do cliente,
com o QR aberto na mão, continua dizendo **"Válido"** até alguém recarregar a página. Existe um
gateway de WebSocket funcionando (`ReservationGateway`, namespace `/seats`), usado para
disponibilidade de assento — mas o ingresso, que é justamente o que muda na frente da pessoa,
não passa por ele. E enquanto o servidor valida, a portaria fica com a tela parada: o operador
não sabe se o leitor pegou, se está processando ou se travou, e escaneia de novo.

**Os formulários.** A validação só dispara quando a pessoa tenta avançar. Preenche os quatro
campos, clica em "Continuar" e só então descobre que o primeiro estava errado. Pior no sentido
inverso: depois de corrigir o campo, a mensagem vermelha **continua lá** até a próxima
tentativa de avançar — erro que sobrevive à correção vira ruído, e a pessoa aprende a ignorar
mensagem de erro.

## Requisitos funcionais

### Portaria

- RF-1: Ao validar um ingresso com sucesso, o servidor emite `ticket_validated` pelo gateway
  existente, na sala do evento, com `ticketId`, `eventId` e `validatedAt`.
- RF-2: O cliente com a lista ou o detalhe do ingresso aberto atualiza o status para
  **"Utilizado"** ao receber o evento, sem recarregar.
- RF-3: Enquanto a validação está em curso, a portaria mostra estado de carregamento explícito
  e **bloqueia** um segundo envio — o mesmo QR lido duas vezes gera "já utilizado" falso.

### Formulários

- RF-4: Cada campo valida ao **sair** dele (`blur`), não só ao tentar avançar.
- RF-5: O erro de um campo **desaparece assim que a pessoa começa a corrigi-lo**.
- RF-6: Vale para o wizard de criação de evento, o login e o cadastro.
- RF-7: O contêiner de desenvolvimento precisa servir o código que está no
  disco. (Ver "Achados durante a implementação".)
- RF-8: Todo campo do wizard precisa ser clicável em qualquer altura de janela.

## Requisitos não-funcionais

- RNF-1: O evento de validação não pode carregar dados do comprador — a sala é do evento, e
  qualquer um pode entrar nela.
- RNF-2: A emissão pelo gateway não pode derrubar a validação. Se o WebSocket estiver fora, o
  ingresso continua sendo validado normalmente.

## Considerações de segurança

- A sala `event:{id}` é pública (o mapa de assentos depende disso). Portanto o payload de
  `ticket_validated` carrega **apenas ids e o horário** — nada de nome, documento ou assento do
  portador. Quem não tem o ingresso não descobre nada de novo: já sabia que aquele lugar estava
  vendido.
- O cliente **não confia** no evento para conceder nada; ele só invalida o cache local e
  refaz a leitura autenticada. O status verdadeiro continua vindo do banco.
- A emissão fica dentro de `try/catch`: falha de broadcast é registrada, nunca propagada. Um
  portão que recusa a entrada porque o WebSocket caiu seria pior que a tela desatualizada que
  estamos consertando.

## Critérios de aceitação — testáveis

- AC-1: Dada uma validação bem-sucedida, então o gateway recebe `ticket_validated` com
  `ticketId`, `eventId` e `validatedAt`.
- AC-2: Dado um ingresso **já utilizado**, quando reapresentado, então **não** há emissão — o
  estado não mudou, não há o que anunciar.
- AC-3: Dado um ingresso de outro evento, então não há emissão.
- AC-4: Dado um evento fora da janela de entrada, então não há emissão e o status permanece
  intacto (Req 11.7).
- AC-5: Dado que o gateway lança exceção ao emitir, então a validação **ainda assim** retorna
  sucesso e o ingresso fica `used`.
- AC-6: O payload emitido não contém documento, nome ou e-mail do portador.

## Casos de borda

- AC-E1: Duas leituras do mesmo QR em sequência → a segunda encontra `used` e responde
  `TICKET_ALREADY_USED`, sem segunda emissão.
- AC-E2: Cliente sem WebSocket (rede corporativa) → a lista continua correta pelo `refetch`
  periódico; o tempo real é melhoria, não requisito de correção.

## Contrato de WebSocket

| Evento | Direção | Sala | Payload |
|---|---|---|---|
| `ticket_validated` | servidor → cliente | `event:{eventId}` | `{ ticketId, eventId, validatedAt }` |

Nenhuma mudança em endpoint HTTP.

## Validação real

- Fluxo: cliente abre o ingresso na tela → portaria valida o mesmo ingresso → a tela do cliente
  vira "Utilizado" sem recarregar.
- Critério: a mudança acontece sem interação do cliente; o payload no console não traz PII.

## Achados durante a implementação

Dois problemas apareceram só porque a validação foi feita de verdade:

**RF-7 — o contêiner de desenvolvimento servia código de horas atrás.** O
`docker-compose.yml` monta `./backend/src` e roda `npm run start:dev`, mas
eventos de arquivo não atravessam um bind mount do Windows: o watcher nunca
acordava. A API respondia normalmente com código antigo — o pior tipo de falha,
a que parece sucesso. Pior ainda, `docker compose up --build` não consertava:
o compose aponta para `target: base`, um estágio que havia sumido do
`Dockerfile`, então a build falhava e todo mundo seguia com a imagem em cache.
Corrigidos os dois: o estágio `base` voltou (e `build` agora deriva dele) e o
`tsconfig` passou a sondar arquivos (`dynamicPriorityPolling`).

**RF-8 — o primeiro campo do wizard não recebia clique.** O modal usava
`items-start md:items-center`: quando o cartão fica mais alto que a janela, ele
é centralizado, o topo sai da tela e o cabeçalho `sticky` — que gruda no topo do
contêiner de rolagem — passa a cobrir o campo Título. O campo aparecia na tela e
simplesmente não respondia. Agora o cartão é sempre alinhado ao topo.

## Status
- [x] Spec escrita
- [x] Testes escritos — vermelhos (6 ACs de portaria)
- [x] Implementação concluída — testes verdes (116/116)
- [x] Validação real executada — 2026-08-12

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| Compra real (Stripe test, `tok_visa`) | pagamento `succeeded`, 1 ingresso emitido |
| Ingresso na lista do cliente, antes | **Válido** |
| Portaria valida **fora do navegador** (PowerShell) | `valid: true`, `validatedAt` gravado |
| Mesma tela do cliente, **sem recarregar** | virou **Utilizado** — AC-1 e RF-2 ✔ |
| Payload do broadcast | só `eventId`, `ticketId`, `validatedAt` — AC-6 ✔ |
| Gateway lançando exceção (teste) | validação continua retornando sucesso — AC-5 ✔ |
| Portaria durante a validação | "Lendo ingresso... / Não escaneie de novo" + spinner, `aria-live="polite"` — RF-3 ✔ |
| Login: e-mail inválido, sair do campo | "Formato de e-mail inválido." — RF-4 ✔ |
| Login: voltar a digitar | erro some na primeira tecla — RF-5 ✔ |
| Wizard: título "a", sair do campo | "Nome muito curto", `aria-invalid=true`, borda vermelha — RF-4 ✔ |
| Wizard: digitar de novo | erro some — RF-5 ✔ |
