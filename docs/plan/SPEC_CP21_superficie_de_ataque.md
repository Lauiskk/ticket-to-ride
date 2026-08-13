# SPEC — CP21: Superfície de ataque

## Contexto

O único limite de tráfego que existia era o de **falhas de login**. Todo o resto
estava aberto: criar contas, abrir reservas, disparar pagamentos, validar na
portaria e — o caso mais concreto — consultar o catálogo externo, que repassa a
chamada para o Ticketmaster e consome de uma cota de **5.000 requisições por
dia** compartilhada pela plataforma inteira.

E o limitador que existia estava apoiado no endereço errado. `extractClientIp`
pegava a entrada **mais à direita** de `x-forwarded-for`, com um comentário
dizendo que seria "a mais confiável". A direita é o proxy mais próximo da API —
o mesmo endereço para todos os visitantes. Cinco erros de qualquer pessoa
trancariam a porta para **todo mundo** por meia hora, e o atacante real não
ficaria isolado de ninguém. Um controle de segurança que erra assim é pior que a
ausência dele: vira negação de serviço que qualquer um dispara de graça.

O gateway de WebSocket, por sua vez, aceitava `origin: '*'` com um comentário
prometendo "configurar em produção" — promessa que nunca se cumpre, porque nada
quebra enquanto está aberto. Com `credentials: true` ao lado, qualquer site
podia abrir conexão autenticada com a sessão de quem estivesse visitando.

## Requisitos funcionais

- RF-1: Teto geral de requisições por IP, folgado o bastante para não incomodar
  uso normal.
- RF-2: Limites próprios, mais apertados, em cadastro, reserva, portaria e
  catálogo externo.
- RF-3: `trust proxy` configurado, e o IP do cliente lido de `req.ip`.
- RF-4: A origem aceita pelo WebSocket é a mesma lista fechada do HTTP.
- RF-5: O CI reprova se entrar dependência de produção com vulnerabilidade
  **crítica**.

## Considerações de segurança

- O limitador vem **antes** da autenticação: quem está inundando a API não
  deveria custar uma consulta ao banco por tentativa.
- Os números são escolhidos por uso, não por estética: 5 cadastros/min (cada um
  é um bcrypt de 12 rounds), 10 reservas/min (cada uma tranca assentos por 10
  minutos), 60 validações/min (mais rápido do que qualquer fila anda), 20 buscas
  de catálogo/min (protege a cota diária de todos os organizadores).
- Na portaria o limite não é contra falsificação — a assinatura HMAC já resolve
  isso. É contra usar o portão como oráculo para descobrir quais códigos existem.
- O corte do CI em `critical` (e não `high`) está justificado em
  [SDD/05-seguranca/DEPENDENCIAS.md](../../SDD/05-seguranca/DEPENDENCIAS.md):
  as três `high` restantes exigem migração para o Nest 11 e nenhuma é alcançável
  pela superfície desta aplicação.

## Critérios de aceitação — testáveis

- AC-1: Com `req.ip` presente, é ele que identifica o cliente.
- AC-2: Sem `req.ip`, o cliente é a **primeira** entrada de `x-forwarded-for`.
- AC-3: Sem nada identificável, devolve marcador — nunca vazio.
- AC-4: O 6º cadastro no mesmo minuto responde **429**.
- AC-5: O gateway não aceita `*` como origem.

## Validação real

- Disparar cadastros em sequência contra a API e observar o 429.
- Abrir a página de um evento e confirmar que o mapa continua "ao vivo" — a
  restrição de origem não pode quebrar o caminho legítimo.

## Status
- [x] Spec escrita
- [x] Testes escritos — vermelhos (5 ACs de IP; o property test antigo afirmava o contrário e foi corrigido)
- [x] Implementação concluída — testes verdes (141/141)
- [x] Validação real executada — 2026-08-13

### Evidência da validação real

| Verificação | Resultado |
|---|---|
| `extractClientIp` com XFF `203.0.113.7, 10.0.0.1` | antes devolvia **`10.0.0.1`** (o proxy); agora `203.0.113.7` — AC-1 ✔ |
| 8 cadastros seguidos | 201, 201, 201, 201, 201, **429, 429, 429** — AC-4 ✔ |
| Mapa de assentos após fechar a origem do socket | "Disponibilidade ao vivo", 12 assentos — caminho legítimo intacto |
| `npm audit --omit=dev --audit-level=critical` | passa nos dois pacotes |

### Achado: um teste que defendia o defeito

O property test "Property 9: Client IP Extraction (**Rightmost** X-Forwarded-For)"
exigia exatamente o comportamento errado. Ele passava verde enquanto o limitador
contava o proxy no lugar do cliente — e teria reprovado qualquer tentativa de
conserto. Teste que fixa o comportamento errado não protege o sistema: protege o
defeito. Foi reescrito junto com a correção.
