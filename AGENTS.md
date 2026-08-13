# AGENTS.md — regras inegociáveis

Este arquivo é a fonte única das regras que não se quebram neste repositório.
Vale para qualquer ferramenta de IA (Claude Code, Cursor, OpenCode) e para
qualquer pessoa. O [CLAUDE.md](CLAUDE.md) detalha o *como*; em qualquer
divergência, **prevalece este arquivo**.

São seis, e todas nasceram de erro cometido aqui — não de teoria.

---

## 1. Spec antes de código

Toda mudança de comportamento começa por uma spec em `docs/plan/`, com critérios
de aceitação numerados. Correção pequena usa formato reduzido, com um AC — nunca
ausência de spec. Exceção única: documentação pura.

**Por quê:** sem AC escrito antes, "pronto" vira opinião. Com AC, é verificável.

## 2. Teste vermelho antes da implementação

Cada AC tem pelo menos um teste, e o teste é escrito **antes** — tem que falhar
primeiro. Teste que nasce verde não provou nada: pode estar testando o nada.

**Por quê:** aconteceu aqui. O property test "Rightmost X-Forwarded-For" passava
verde defendendo o comportamento **errado**, e teria reprovado o conserto. Teste
escrito depois documenta o que o código faz; escrito antes, define o que ele
deve fazer.

## 3. Validação com dado real antes de dizer "funciona"

Suite verde não é entrega. Antes de dar qualquer coisa por concluída: rodar o
fluxo de verdade — navegador, API, banco — e registrar o que foi observado na
seção "Evidência da validação real" da spec.

**Por quê:** também aconteceu aqui, três vezes. A cota de meia-entrada passava
nos testes e era furada por duas compras simultâneas. O contêiner de
desenvolvimento serviu código de horas atrás sem avisar. O campo Título do
wizard existia, aparecia na tela e não recebia clique.

## 4. Reportar o que aconteceu, não o que se esperava

Teste que falhou se reporta com a saída. Passo pulado se declara. Nada de
"deve funcionar" — ou foi verificado, ou não foi, e as duas respostas são
aceitáveis desde que ditas.

## 5. Commits só com o autor humano

Mensagens curtas e descritivas, em português, sem `Co-Authored-By` de IA
nenhuma. O histórico é do Lauiskk.

## 6. Segredo não entra no repositório nem em log

`.env` fica no `.gitignore`. Chave, token e senha nunca aparecem em código,
teste, log ou mensagem de commit — nem como exemplo. Documento e PII do
comprador não saem mascarados por acaso: saem mascarados por decisão escrita na
spec.

---

## Onde está o quê

| Assunto | Lugar |
|---|---|
| Contrato operacional (comandos, fluxo diário) | [CLAUDE.md](CLAUDE.md) |
| Specs por checkpoint, com evidência de validação | `docs/plan/SPEC_CP*.md` |
| Modelo de ameaças e decisões de segurança | `SDD/05-seguranca/` |
| Como a IA foi usada, e o que foi feito sem ela | [docs/IA.md](docs/IA.md) |
| Instruções de execução e limitações | [README.md](README.md) |
