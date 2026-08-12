# SPEC — <nome da feature>

> Preenchida a partir da entrevista de requisitos com o usuário.
> Nenhum teste ou código é escrito antes desta spec estar APROVADA.
> Adaptado de `cyberai/docs/templates/SPEC_TEMPLATE.md` para o contexto deste projeto
> (NestJS + TypeORM + React, papéis Organizador/Cliente/Portaria).

## Contexto
<por que esta feature existe — 2 a 4 frases>

## Requisitos funcionais
- RF-1: ...
- RF-2: ...

## Requisitos não-funcionais (se houver)
- RNF-1: <performance, responsividade, acessibilidade, i18n pt-BR...>

## Considerações de segurança
- Quem pode chamar este endpoint? (papel mínimo: `client` / `organizer` / `gate` / público)
- `userId` é extraído exclusivamente do JWT? (confirmar — nunca de body/query/path)
- Inputs externos passam por `class-validator`? Valores monetários são recalculados no servidor?
- A resposta pode vazar dado de outro usuário (ingresso, reserva, evento em rascunho)?
- Segredos (chaves Stripe/Ticketmaster/TMDb, `TICKET_SIGNING_SECRET`) ficam fora de payload e log?

## Critérios de aceitação — testáveis
> Cada AC vira ≥1 teste ANTES da implementação. A docstring/`it()` do teste cita o ID.

- AC-1: Dado <estado inicial>, quando <ação>, então <resultado observável>
- AC-2: ...

## Casos de borda
- AC-E1: Dado <entrada inválida/vazia/limite/concorrência>, então <comportamento esperado>

## Contrato de API (se aplicável)
> Pré-requisito antes de escrever testes de endpoint. Não deixar em branco se a feature tem endpoint.
- Endpoint, método, papel exigido, schema de request/response, códigos de erro (`ErrorCodes`)

## Validação real
> "container healthy" não conta. Preencher os campos para executar o teste de ponta a ponta.
- Fluxo/rota:
- Usuário do seed usado:
- Evidência esperada (payload, linha no banco, evento na Stripe, log):
- Critério: <resultado observável, verificável por terceiro>

## Status
- [ ] Spec aprovada pelo usuário (sem ACs em branco; contrato de API preenchido se aplicável)
- [ ] Testes escritos — vermelhos
- [ ] Implementação concluída — testes verdes
- [ ] Validação real executada
