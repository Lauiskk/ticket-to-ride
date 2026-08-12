# SPEC — CP13: Catálogo externo de verdade (Ticketmaster + TMDb)

## Contexto

A integração externa existia, mas usava as duas APIs pelo mínimo: `TicketmasterClient` mandava
quatro parâmetros e `TmdbClient` só sabia `search/movie`. O resultado era pior do que parece à
primeira vista.

Sem `countryCode`, a Discovery API responde com eventos dos **Estados Unidos** — um organizador
brasileiro buscava "rock" e recebia Las Vegas. E o pouco que voltava era jogado fora: o payload
traz nome do local, cidade, endereço e **coordenadas**, e nada disso era mapeado, então o
organizador redigitava à mão um endereço que a API já tinha entregue.

Do lado do TMDb, `search/movie` responde "qual filme tem esse nome", que não é a pergunta de quem
monta uma sessão. A pergunta é "o que está em cartaz agora" — e isso é outro endpoint.

Por fim, a vitrine ilustrava cada evento com uma foto aleatória do `picsum.photos` sorteada pelo
id. Uma praia genérica num show de stand-up é pior do que não ter foto.

Referência de formatos, limites e armadilhas, escrita a partir de chamadas reais:
**`SDD/08-anexos/API_TICKETMASTER_TMDB.md`**.

## Requisitos funcionais

- RF-1: A busca no Ticketmaster usa `countryCode=BR` por padrão e aceita `city`,
  `classificationName`, `startDateTime` e ordenação por data.
- RF-2: O item de catálogo carrega local, cidade, endereço e coordenadas quando a fonte souber.
- RF-3: A imagem escolhida é 16:9 e dimensionada para card — nem miniatura, nem o arquivo `_SOURCE`.
- RF-4: O TMDb expõe **filmes em cartaz no Brasil** (`now_playing?region=BR`), além da busca por texto.
- RF-5: Os `genre_ids` do TMDb são traduzidos em nomes; o mapa é carregado uma vez por processo.
- RF-6: O evento guarda `imageUrl`, e a vitrine mostra a arte real — nunca foto de banco de imagens.
- RF-7: O wizard tem duas abas — **Shows e eventos** (Ticketmaster) e **Filmes em cartaz** (TMDb) —
  com filtros de cidade e categoria.
- RF-8: Escolher um item preenche título, descrição, imagem, local, endereço, cidade e coordenadas.
  **Não** preenche preço nem capacidade, e só preenche data quando ela é uma sessão real
  (Ticketmaster); a data do TMDb é estreia, não sessão.

## Considerações de segurança
- `/catalog/search` continua exigindo papel `organizer`.
- Chaves de API nunca aparecem em resposta nem em log; a chamada externa é sempre server-side.
- `classificationName` é validado contra lista fechada — um valor livre viraria consulta arbitrária.
- A chave do Ticketmaster tem cota de **5000 req/dia**: toda chamada passa pelo cache de 1 h no
  Redis, e o cache é indexado por **todos** os filtros (duas cidades diferentes são perguntas
  diferentes).

## Critérios de aceitação — testáveis

- AC-1: Busca sem `countryCode` explícito envia `countryCode=BR`.
- AC-2: `city`, `classificationName`, `startDateTime` e `sort=date,asc` chegam na URL.
- AC-3: `startDateTime` com milissegundos é normalizado (a API rejeita `.000Z`).
- AC-4: O item mapeado traz `venue`, `venueCity`, `venueAddress` e lat/lng **numéricos**
  (a API devolve string).
- AC-5: Entre variações de imagem, escolhe a menor 16:9 com ≥640px de largura.
- AC-6: Se nenhuma atinge 640px, cai para a maior disponível.
- AC-7: Resposta sem `_embedded` devolve lista vazia, sem exceção.
- AC-8: Evento sem venue devolve `venue: null` e `venueLat: null`, sem quebrar.
- AC-9: `now_playing` chama a API com `region=BR` e `language=pt-BR`.
- AC-10: `genre_ids` viram nomes; a UI nunca recebe `[878, 28]`.
- AC-11: Filme sem `poster_path` devolve `image: null`.
- AC-12: O mapa de gêneros é buscado **uma vez** entre chamadas.
- AC-13: Filme não recebe venue inventado.

## Validação real
- Fluxo: organizador busca no catálogo → escolhe um evento real → o formulário nasce preenchido →
  cria o evento → a vitrine mostra a arte real.
- Critério: evento criado com local, cidade, coordenadas e imagem vindos da API, sem digitação.

## Status
- [x] Spec aprovada pelo usuário (item do plano aprovado: "CP13 — catálogo externo de verdade")
- [x] Testes escritos — vermelhos (16 ACs em `catalog.mapping.spec.ts`)
- [x] Implementação concluída — testes verdes (84/84)
- [x] Validação real executada — 2026-08-11

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| `GET /catalog/search?source=ticketmaster&classificationName=Music` | **56 eventos no Brasil** (antes: resultados dos EUA) |
| Item mapeado | `Rosalía: Lux Tour 2026 · World · Farmasi Arena · Rio de Janeiro · lat -22.9736753 · com imagem` |
| `GET /catalog/search?source=now-playing` | **135 filmes em cartaz**, gêneros em pt-BR ("Ficção científica", "Terror") |
| Criar evento a partir do item | criado com `imageUrl`, `venueLat`, `venueCity` — **zero digitação** |
| Tamanho da imagem escolhida | **28 KB** (antes o `_SOURCE` de 260 KB) |
| `picsum.photos` no código | **0 ocorrências** |

**Limitação do ambiente:** o painel de navegador embutido não carrega imagens de domínios
externos, então a arte não pôde ser vista renderizada aqui. A URL foi verificada por fora:
`HTTP 200 · image/jpeg · 28.344 bytes`. Num navegador normal ela aparece.