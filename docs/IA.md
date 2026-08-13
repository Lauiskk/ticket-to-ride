# Como a IA foi usada neste projeto

O desafio pede que eu conte quais ferramentas usei, em que partes, e o que fiz
sem IA. Este documento responde isso sem enfeite — inclusive as vezes em que a
ferramenta errou e o erro só apareceu porque alguém foi conferir.

## As ferramentas

| Ferramenta | Onde |
|---|---|
| **Claude Code (Opus)** | Praticamente todo o código, sempre sob o fluxo descrito abaixo. É o par que escreve; a direção, os critérios e a decisão de aceitar são minhas |
| **MCPs de Railway, Vercel e Stripe** | Deploy, variáveis de ambiente e webhook de produção. Configuração de infraestrutura pela conversa, com verificação no painel |
| **Navegador controlado** | Validação real: percorrer o fluxo como usuário, ler o DOM, conferir estado. É o que separou "os testes passam" de "funciona" |
| **APIs Ticketmaster e TMDb** | Não são IA, mas foram sondadas de verdade antes de codificar. O que aprendi está em `SDD/08-anexos/API_TICKETMASTER_TMDB.md` |

## O método: spec → teste vermelho → código → validação real

Está escrito em [AGENTS.md](../AGENTS.md) e foi seguido em todos os 11
checkpoints. Cada um tem uma spec em `docs/plan/` com critérios de aceitação
numerados, testes escritos **antes** da implementação, e uma tabela de
"Evidência da validação real" preenchida com o que foi observado — não com o que
se esperava observar.

Esse último passo é o que mais mudou o resultado. Quatro exemplos, todos reais:

**A cota de meia-entrada era furável.** O código contava ingressos emitidos para
saber quantas meias já tinham saído. Passava em todos os testes. Só que um
comprador em checkout ainda não tem ingresso: dois compradores simultâneos
estouravam a cota. Descobri comprando de verdade. Hoje a cota conta as
declarações das reservas pendentes **e** pagas.

**"Alguém garantiu esse lugar primeiro" em assentos livres.** O `reserveSeats`
embrulhava *qualquer* exceção como "assento ocupado". Durante um deploy, falha
de conexão com o banco virou conflito de negócio, e eu fui caçar lugar livre num
mapa inteiro livre. Reportar problema de infraestrutura como conflito de negócio
é pior que falhar: manda depurar o problema errado.

**O contêiner servia código de horas atrás.** Bind mount do Windows não propaga
evento de arquivo; o watcher nunca acordava. A API respondia normalmente com
código velho — o pior tipo de falha, a que parece sucesso. E `docker compose up
--build` não consertava, porque o compose apontava para um estágio que havia
sumido do Dockerfile.

**Um teste que defendia o defeito.** O property test chamado "Rightmost
X-Forwarded-For" exigia que o IP do cliente fosse a entrada mais à direita do
cabeçalho — que é o proxy. Ele passava verde enquanto o limitador de login
contava todos os visitantes como uma pessoa só, e teria reprovado qualquer
tentativa de conserto.

**Toda mutação em produção respondia 403.** A proteção de CSRF usa um cookie
legível pelo JavaScript. Só que esse cookie pertence ao domínio da **API**
(`up.railway.app`) e o site roda em `vercel.app` — `document.cookie` de um
domínio nunca enxerga cookie do outro. O navegador anexava o cookie nas
requisições (a sessão funcionava, o `/auth/me` respondia 200), mas o site não
conseguia montar o header. Ninguém conseguia comprar. Local passava porque o
Vite faz proxy de `/api` e a diferença de domínio simplesmente não existe ali:
**os 13 testes de CSRF estavam certos e o sistema estava quebrado**.

**Quem voltasse ao checkout não conseguia mais pagar.** Pedindo o pagamento uma
segunda vez para a mesma reserva, a API devolvia `clientSecret: "reuse_pi_…"` —
uma string inventada, que o Stripe.js recusa de imediato. Na prática: reservar,
fechar a aba, voltar para pagar, e encontrar um checkout que não abre, com os
assentos presos até expirar. A suíte nunca abria o mesmo checkout duas vezes;
uma pessoa distraída faz isso o tempo todo.

Nenhum desses aparece rodando a suíte. Todos apareceram usando o sistema — e os
dois últimos só apareceram no **site publicado**, porque dependem da topologia
de dois domínios e do comportamento de quem usa, não do código isolado.

## O que eu decidi, e a IA executou

Estas escolhas não vieram da ferramenta. Várias contrariam o que ela propôs
primeiro:

- **Catálogo é fonte, não estoque.** O organizador *monta* o evento dele a partir
  do Ticketmaster/TMDb; não "assume" um evento que já existe. Dois organizadores
  podem montar sessões do mesmo filme.
- **Recusar o CP17 depois de pronto.** Eu tinha bloqueado o organizador da loja
  inteira para ele não encontrar botão de compra que o servidor recusa. Quem
  testou disse que ficava preso sem saída — e tinha razão. O erro foi confundir
  *não poder comprar* com *não poder olhar*. Revertido no CP19.
- **HMAC no QR, não JWT.** O ingresso precisa ser pequeno o suficiente para
  virar QR legível numa tela rachada, no escuro, numa fila.
- **A portaria não vê a loja.** É um aparelho parado numa porta; catálogo ali é
  distração. O organizador, não — essa foi a lição do item acima.
- **Documento mascarado na portaria**, mantendo 4 dígitos. O operador precisa
  *comparar*, não *aprender* o número. Tela de portão é lida por cima do ombro.
- **Cookie `httpOnly` no lugar do `localStorage`**, com CSRF de dupla submissão
  como consequência assumida — e o corpo da requisição restrito a JSON, que é o
  que fecha o vetor do `<form>` cross-site.
- **Corte do `npm audit` em `critical`, com as `high` justificadas uma a uma**
  em `SDD/05-seguranca/DEPENDENCIAS.md`. Corte que reprova todo dia por coisa
  insolúvel vira ruído e alguém desliga.
- **Estorno fora da transação do banco.** Segurar bloqueio durante latência de
  rede é ruim; estornar antes do commit é pior. O cancelamento vale na hora, o
  dinheiro volta em seguida, e a falha aparece no log.
- **Cortar animação.** A interface saiu da ferramenta cheia de movimento
  decorativo — laços infinitos, *stagger* por índice, mil componentes animados no
  mapa de assentos. Tirei quase tudo: o primeiro carregamento caiu de 895 KB para
  381 KB, e o mapa passou a responder em 1,3 ms para 6 cliques.

## O que fiz sem IA

- **Ler o enunciado e decidir o escopo.** O que entra, o que fica de fora, e em
  que ordem — os checkpoints são divisão minha, feita para cada um ser testável
  sozinho.
- **Testar como usuário.** Comprar, cancelar no meio, compartilhar entre duas
  contas, validar na portaria, tentar de novo. Quase todo bug real desta lista
  saiu daí, não de análise estática.
- **Julgar o resultado visual.** O tema de jogo de tabuleiro, o ingresso com
  picote e o QR em campo branco de alto contraste são escolha minha; a
  ferramenta não tem opinião sobre como um ingresso deve parecer na mão de
  alguém numa fila.
- **Decidir o que NÃO fazer.** Migrar para o Nest 11 a dias da entrega, trocar o
  handshake do OAuth por código de uso único, cobrir 100% de linha. Cada um está
  registrado como limitação assumida, com o motivo.
- **Reprovar código pronto.** Mais de uma vez o que veio funcionava e foi
  descartado por estar errado de propósito — o caso mais claro é o CP17.

## Os artefatos, versionados

O desafio pede para versionar o que foi produzido no caminho. Está tudo aqui:

| Onde | O que é |
|---|---|
| `docs/plan/SPEC_CP*.md` | 11 specs, com ACs e a evidência do que foi medido em cada uma |
| `SDD/` | Estrutura de documentação de sistema; `05-seguranca` traz o modelo de ameaças |
| `AGENTS.md` e `CLAUDE.md` | As regras que a ferramenta seguiu, e o contrato operacional |
| `.claude/` | Configuração do agente usada no projeto |
| Histórico do git | 65 commits, um por decisão, na ordem em que as coisas aconteceram |

O histórico é a parte mais honesta: dá para ver os erros sendo cometidos e
corrigidos, inclusive o `fix:` que desfaz uma decisão de dois commits antes.

## Em uma frase

A IA escreveu a maior parte das linhas. O que decidiu quais linhas mereciam
existir — e quais precisavam sair — foi o uso do sistema por uma pessoa,
conferindo cada afirmação contra o que a tela realmente fazia.
