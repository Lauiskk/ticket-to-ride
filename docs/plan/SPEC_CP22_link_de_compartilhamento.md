# SPEC — CP22: O link de compartilhamento chega ao destino

## Contexto

Compartilhar um ingresso por link é **item obrigatório** do desafio. O backend
faz a parte dele: gera um token de 256 bits, guarda com validade de 48 h,
transfere a posse e invalida o ingresso antigo. O botão "Compartilhar" na tela do
cliente devolve uma URL.

Só que essa URL não leva a lugar nenhum. O SPA **não tem rota `/share/:token`**:
quem recebe o link abre o site e encontra o roteador sem correspondência. O
recurso existe no servidor e não existe para o usuário — que, do ponto de vista
de quem avalia, é o mesmo que não existir.

E a URL vem malformada em produção. `generateLink` monta o endereço com
`cors.origin`, que hoje é uma **lista com curingas**
(`https://a.vercel.app,https://ticket-to-ride-*.vercel.app,http://localhost:5173`).
É exatamente o defeito já corrigido no retorno do OAuth, ainda vivo aqui — a
função que conserta, `resolveFrontendUrl`, já existe no repositório.

Falta também uma peça de produto: quem recebe o link precisa saber **o que está
aceitando** antes de aceitar. Hoje só existe `POST /:token/accept`, que já
consome o link. Abrir uma página que transfere um ingresso sem perguntar é
transformar um clique em decisão irreversível.

## Requisitos funcionais

- RF-1: A URL do link é montada com `resolveFrontendUrl` — nunca contém vírgula
  nem `*`.
- RF-2: Novo `GET /sharing/:token` devolve o que o destinatário precisa para
  decidir: evento, data, local, assento e a situação do link. **Não consome** o
  link.
- RF-3: Nova rota `/share/:token` no SPA mostra esses dados e um botão de aceitar.
- RF-4: A tela distingue os casos que o backend já separa: link **válido**,
  **já utilizado**, **expirado** e **quem gerou tentando aceitar o próprio**.
- RF-5: Sem sessão, a tela manda entrar e **volta para o link** depois do login —
  não descarta o destino.
- RF-6: Aceito, o ingresso novo aparece em "Meus ingressos" e o antigo consta
  como invalidado.

## Considerações de segurança

- O token é `randomBytes(32)` — 256 bits. Quem tem o link é o destinatário
  pretendido; não há o que adivinhar.
- A prévia mostra **evento, data, local e assento**. Nada de quem comprou: nome,
  e-mail e documento não entram na resposta. Um link vazado revela um assento,
  não uma pessoa.
- A prévia não muda estado. Só o `POST` transfere — leitura não pode ter efeito
  colateral, e menos ainda um efeito irreversível.
- A transferência exige sessão de **cliente**, como já era.

## Critérios de aceitação — testáveis

- AC-1: A URL gerada nunca contém `,` nem `*`, mesmo com `CORS_ORIGIN` em lista.
- AC-2: `GET /sharing/:token` de link ativo devolve evento e assento, com
  `status: 'active'`.
- AC-3: Consultar a prévia **não** transfere o ingresso nem consome o link.
- AC-4: Link já usado → `status: 'used'`.
- AC-5: Link vencido → `status: 'expired'`.
- AC-6: Token inexistente → 404.
- AC-7: A prévia não contém nome, e-mail nem documento de ninguém.

## Casos de borda

- AC-E1: Ingresso já validado na portaria depois do link gerado → a prévia acusa
  que não é mais transferível.
- AC-E2: Quem gerou abre o próprio link → a tela explica, em vez de deixar
  clicar e receber erro.

## Contrato de API

| Endpoint | Método | Papel | Resposta |
|---|---|---|---|
| `/sharing/:token` | GET | público | `{status, event: {title, date, venueName, venueCity}, seatIdentifier, expiresAt}` |
| `/sharing/:token/accept` | POST | `client` | ingresso novo (inalterado) |

## Validação real

- Cliente A gera o link; cliente B abre em outra sessão, vê o evento e o assento,
  aceita; o ingresso aparece para B e o de A fica invalidado.

## Status
- [x] Spec escrita
- [x] Testes escritos — vermelhos (9 ACs)
- [x] Implementação concluída — testes verdes (150/150)
- [x] Validação real executada — 2026-08-13

### Evidência da validação real

Fluxo completo, duas sessões, pela interface:

| Passo | Resultado |
|---|---|
| Cliente 1 gera o link | `http://localhost:5173/share/a0d6e564…` — sem vírgula, sem curinga — AC-1 ✔ |
| Cliente 2 abre o link | a tela mostra **"Maratona Ghibli - Noite Especial"**, sexta-feira 21 de agosto às 21:54, Cine Roxy — Rio de Janeiro, **Assento Sala Principal-3-1** — RF-3 ✔ |
| Aviso antes de aceitar | "Ao receber, o ingresso de quem enviou é invalidado na hora." |
| Cliente 2 aceita | vai para "Meus ingressos" com o assento `Sala Principal-3-1` **ativo** — RF-6 ✔ |
| Mesmo ingresso na conta do cliente 1 | **invalidado** — RF-6 ✔ |
| O link, consultado de novo | `status: 'used'` — AC-4 ✔ |

Antes do CP22 este fluxo não existia para o usuário: o link levava a uma rota
sem correspondência, e em produção sequer era um endereço válido.
