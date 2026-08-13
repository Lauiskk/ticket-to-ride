# Dependências — o que a auditoria acusa e por quê continua aqui

`npm audit` roda no CI sobre as dependências **de produção** (`--omit=dev`), com
corte em `critical`. A escolha do corte precisa de explicação, porque um corte
mal posto é pior que nenhum: se a etapa reprova todo dia por coisa que não se
pode resolver, ela vira ruído e alguém a desliga.

## Por que só as de produção

Vulnerabilidade em ferramenta de build não embarca no contêiner. Hoje a maior
parte dos alertas vem do `@nestjs/cli` e da cadeia do `@angular-devkit`
(`glob`, `lodash`, `tmp`, `picomatch`) — código que roda na máquina de quem
compila, não no servidor que atende requisição. Misturar as duas listas produz
um número grande e sem significado.

## Por que o corte é `critical` e não `high`

Restam **três `high` em dependências de produção**, todas com a mesma
característica: a correção exige subir para o **NestJS 11** (major). Migrar
framework a dias da entrega, com a aplicação em produção e funcionando, troca um
risco teórico por um risco concreto.

| Pacote | Advisory | Chega por | Alcançável nesta aplicação? |
|---|---|---|---|
| `multer` | 4 avisos de negação de serviço (limpeza incompleta, exaustão de recursos, recursão, campos aninhados) | `@nestjs/platform-express` | **Não.** Nenhuma rota aceita `multipart`. Desde o CP20 a API só faz *parse* de JSON (`bodyParser: false` + `express.json()`), então o multer sequer é acionado |
| `lodash` | Injeção de código via `_.template` | `@nestjs/config` | **Não.** `_.template` não é chamado em lugar nenhum do código — a exploração depende de passar dado do usuário para essa função |
| `@nestjs/platform-express` | herda os avisos acima | direta | mesmo caso |

"Não alcançável" aqui não é opinião: é a ausência de um caminho entre entrada do
usuário e a função vulnerável. Se aparecer upload de arquivo no futuro, a
primeira linha do multer volta a valer e a migração passa a ser obrigatória.

## O que a etapa do CI garante de verdade

- Nenhuma dependência **crítica** de produção entra em `main`.
- A lista de `high` é conhecida, nomeada e justificada — não é um número que
  ninguém olhou.

## Quando revisar

- Ao acrescentar upload de arquivo, formulário `multipart` ou qualquer uso de
  `lodash` com entrada do usuário.
- Na primeira janela sem entrega em cima: subir para o Nest 11 e voltar o corte
  do CI para `high`.
