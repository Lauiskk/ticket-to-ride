# Anexo — APIs externas de catálogo: Ticketmaster Discovery v2 e TMDb

> Referência escrita a partir de **chamadas reais** às duas APIs com as chaves do projeto
> (2026-08-11), não só da documentação. Onde a documentação e a resposta divergem, vale o que
> a API devolveu — está anotado.
>
> - Ticketmaster Discovery v2: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
> - TMDb: https://developer.themoviedb.org/docs/getting-started

## Por que as duas

Elas respondem a perguntas diferentes e o produto precisa das duas:

| Pergunta do organizador | Fonte |
|---|---|
| "Quais shows existem de verdade, onde e quando?" | Ticketmaster — traz local, endereço, cidade e coordenadas |
| "Quais filmes estão em cartaz agora?" | TMDb — traz cartaz, sinopse em pt-BR e a janela de exibição |

Ticketmaster **não** cobre bem cinema; TMDb **não** conhece locais nem datas de sessão. Usar só
uma deixaria metade do catálogo do enunciado (shows *ou* filmes) sem uma fonte decente.

---

## 1. Ticketmaster Discovery API v2

### Autenticação
Chave na query string: `?apikey=<TICKETMASTER_API_KEY>`. Não há OAuth para a Discovery API —
o par consumer key/secret só serve às APIs de comércio, que não usamos.

### Limites (medidos nos headers da resposta)

```
Rate-Limit: 5000            # por dia, por chave
Rate-Limit-Available: 4994
Rate-Limit-Over: 0
Rate-Limit-Reset: 1786585111079   # epoch ms
```

A documentação também cita **5 requisições por segundo**. Profundidade máxima de paginação:
1000 itens (`page * size <= 1000`).

> **Consequência de projeto:** 5000/dia é pouco para servir busca digitada por usuário sem cache.
> Por isso o `CatalogService` guarda toda resposta no Redis por 1 hora e, em falha ou resposta
> vazia, devolve o cache em vez de propagar erro.

### Endpoint usado

`GET https://app.ticketmaster.com/discovery/v2/events.json`

| Parâmetro | Uso no projeto |
|---|---|
| `keyword` | texto livre digitado pelo organizador |
| `countryCode` | **default `BR`** — sem isso a busca vem enviesada para os EUA |
| `city` | filtro por cidade |
| `classificationName` | `Music`, `Film`, `Arts & Theatre`, `Sports`, `Miscellaneous` |
| `startDateTime` | ISO-8601 **sem milissegundos** (`2026-08-11T00:00:00Z`) — com `.000Z` a API rejeita |
| `latlong` + `radius` + `unit` | eventos perto de um ponto |
| `sort` | `date,asc` (usado), `relevance,desc`, `name,asc` |
| `size` / `page` | paginação, `size` máx. 200 |
| `locale` | `*` aceita qualquer idioma; sem isso resultados em pt podem sumir |

### Formato de resposta (campos que usamos)

```jsonc
{
  "page": { "totalElements": 142, "totalPages": 8, "size": 20, "number": 0 },
  "_embedded": {
    "events": [{
      "id": "ZFIMVHtnMZ17kbx_",
      "name": "Sticky Fingers - Rio de Janeiro",
      "info": "…",                        // opcional
      "pleaseNote": "…",                  // opcional
      "url": "https://www.ticketmaster.com/…",
      "dates": { "start": {
        "localDate": "2026-08-11",
        "localTime": "21:00:00",
        "dateTime": "2026-08-12T00:00:00Z",
        "dateTBD": false, "timeTBA": false
      }},
      "classifications": [{
        "segment": { "name": "Music" },
        "genre":   { "name": "Rock" }
      }],
      "priceRanges": [{ "min": 50, "max": 300, "currency": "BRL" }],  // MUITAS VEZES AUSENTE
      "images": [                          // ~11 variações por evento
        { "ratio": "16_9", "width": 2048, "height": 1152, "url": "…" },
        { "ratio": "3_2",  "width": 640,  "height": 427,  "url": "…" }
      ],
      "_embedded": { "venues": [{
        "name": "Qualistage",
        "city": { "name": "Rio de Janeiro" },
        "address": { "line1": "Av. Ayrton Senna, 3000 - Barra da Tijuca" },
        "location": { "latitude": "-22.98135949", "longitude": "-43.36089723" }
      }]}
    }]
  }
}
```

### Armadilhas confirmadas na prática

1. **`priceRanges` costuma não existir.** Medido: 5 de 5 eventos nos EUA sem o campo. Nunca
   assumir preço vindo da API — o organizador define o dele.
2. **`_embedded` ausente quando não há resultados.** `data._embedded?.events || []` é obrigatório,
   não defensivismo.
3. **`location.latitude/longitude` vêm como _string_**, não número. Precisa de `Number()`.
4. **`city` pode faltar** mesmo com `venues` presente (visto no evento da Farmasi Arena).
5. **Imagens não vêm ordenadas.** Escolher a maior `16_9` explicitamente, senão cai numa
   miniatura de 100×56.
6. Sem `countryCode`, a resposta é dominada por eventos dos EUA — o organizador brasileiro
   busca "rock" e recebe Las Vegas.

---

## 2. TMDb (The Movie Database)

### Autenticação
Duas formas; usamos a primeira:
- `?api_key=<TMDB_API_KEY>` (v3, query string)
- `Authorization: Bearer <read access token>` (v4)

### Limites
Sem limite rígido publicado hoje (o antigo era 40 req/10 s). Mesmo assim passa pelo mesmo cache
de 1 hora — é uma fonte externa, e o princípio do projeto é que a tela nunca depende dela estar de pé.

### Endpoints usados

| Endpoint | Para quê |
|---|---|
| `GET /3/search/movie` | busca por texto |
| `GET /3/movie/now_playing?region=BR` | **em cartaz no Brasil** — é isto que dá sentido a "sessão de cinema" |
| `GET /3/genre/movie/list` | traduzir `genre_ids` em nomes |

Parâmetros comuns: `language=pt-BR` (sinopse traduzida), `region=BR`, `page` (1-indexado).

### Formato de resposta

```jsonc
{
  "page": 1,
  "total_results": 135,
  "dates": { "minimum": "2026-07-01", "maximum": "2026-08-12" },  // só em now_playing
  "results": [{
    "id": 603,
    "title": "Homem-Aranha: Um Novo Dia",
    "original_title": "…",
    "overview": "…",                  // pt-BR quando language=pt-BR
    "release_date": "2026-07-29",
    "genre_ids": [878, 28, 12],       // IDs, não nomes
    "poster_path": "/xyz.jpg",        // pode ser null
    "backdrop_path": "/abc.jpg",
    "vote_average": 7.4
  }]
}
```

Imagens: `https://image.tmdb.org/t/p/w500` + `poster_path` (usamos `w500`; há `w200`, `w780`, `original`).

### Armadilhas confirmadas na prática

1. **`genre_ids` são números.** Sem o `/genre/movie/list` a UI mostra `[878, 28]`. O mapa é
   estável e pequeno — cabe em cache longo.
2. **`poster_path` pode ser `null`** → a UI precisa de estado sem imagem.
3. **`runtime` NÃO vem na busca.** Confirmado: os campos de `search/movie` são
   `adult, backdrop_path, genre_ids, id, title, original_language, original_title, overview,
   popularity, poster_path, release_date, video, vote_average, vote_count`. Duração exige
   `GET /3/movie/{id}` — não vale a chamada extra aqui.
4. **`release_date` é a estreia, não a sessão.** Nunca usar como data do evento: quem define
   quando a sessão acontece é o organizador. `now_playing.dates` diz apenas a janela de cartaz.

---

## 3. Mapeamento para `CatalogItem`

Fonte única no backend: `backend/src/event/catalog/catalog.interfaces.ts`.

| Campo | Ticketmaster | TMDb |
|---|---|---|
| `externalId` | `id` | `String(id)` |
| `source` | `'ticketmaster'` | `'tmdb'` |
| `name` | `name` | `title` |
| `description` | `info ?? pleaseNote ?? ''` | `overview` |
| `image` | maior `images[]` com `ratio === '16_9'` | `w500 + poster_path` |
| `category` | `classifications[0].genre.name ?? segment.name` | nome do gênero via `/genre/movie/list` |
| `date` | `dates.start.dateTime` | `release_date` (**apenas informativo**) |
| `venue` | `_embedded.venues[0].name` | `null` |
| `venueCity` | `venues[0].city.name` | `null` |
| `venueAddress` | `venues[0].address.line1` | `null` |
| `venueLat` / `venueLng` | `Number(venues[0].location.latitude / .longitude)` | `null` |

### Regra de ouro

O item de catálogo **pré-preenche** o formulário; ele não vira evento sozinho. Data, preço,
capacidade e mapa de assentos são decisão do organizador — a API externa não sabe quantas
cadeiras existem na sala dele, nem quanto ele quer cobrar.

---

## 4. Comportamento em falha (já implementado)

`CatalogService` (`backend/src/event/catalog/catalog.service.ts`):

1. Tenta a API com timeout de **5 s**.
2. Falhou, estourou o tempo **ou voltou vazio** → devolve o cache do Redis (TTL 1 h).
3. Sem cache → `503 EXTERNAL_SERVICE_UNAVAILABLE`.
4. Sucesso não-vazio → grava no cache.

`searchAll` combina as duas fontes com `Promise.allSettled`: **uma fonte fora do ar não derruba a
busca**, só reduz os resultados. Só falha se as duas caírem.

Chaves de API nunca entram em payload de resposta nem em log.
