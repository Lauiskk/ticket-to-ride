# Modelo de ameaças

O que alguém tentaria contra uma plataforma de ingressos, o que impede, e onde
está no código. Ordenado por quanto dói se der errado.

## 1. Entrar sem pagar

**Como se tenta:** forjar um QR, reusar o ingresso de outra pessoa, ou entrar
duas vezes com o mesmo.

| Defesa | Onde |
|---|---|
| QR assinado com HMAC-SHA256 sobre `ticketId + eventId + assento + emissão` | `ticket/crypto/ticket-signer.service.ts` |
| Assinatura conferida **antes** de qualquer consulta ao banco | `gate.service.ts` |
| Validação marca `used` — a segunda leitura recebe `TICKET_ALREADY_USED` | `gate.service.ts` |
| Ingresso de outro evento é recusado mesmo com assinatura boa | idem |
| Fora da janela de entrada o status **não muda** (Req 11.7) | idem |
| Evento cancelado não abre portão, e os ingressos já nascem invalidados | `event.service.ts` + `gate.service.ts` |
| Limite de 60 validações/min impede usar o portão como oráculo | `gate.controller.ts` |

O segredo de assinatura (`TICKET_SIGNING_SECRET`) é a chave do reino: com ele,
qualquer QR é forjável. Vive só em variável de ambiente.

## 2. Vender o mesmo lugar duas vezes

**Como acontece:** duas compras simultâneas no mesmo assento.

Bloqueio pessimista `SELECT … FOR UPDATE NOWAIT` na reserva, dentro de
transação: a segunda transação falha na hora em vez de esperar, e o comprador
recebe "alguém garantiu esse lugar primeiro" — mensagem que agora só aparece em
contenção **real** (`55P03`, `40001`, `40P01`, `23505`), nunca em falha de
infraestrutura. `reservation.service.ts`.

A mesma disciplina vale para a cota de meia-entrada: ela conta declarações de
reservas pendentes **e** pagas, não ingressos emitidos — contar ingressos deixava
dois compradores simultâneos furarem a cota.

## 3. Roubar a sessão de alguém

| Vetor | Defesa |
|---|---|
| XSS lendo o token | Token em cookie `httpOnly`; o JavaScript não alcança. React escapa por padrão e não há `dangerouslySetInnerHTML` em lugar nenhum |
| CSRF | Dupla submissão (`csrf_token` legível + header `X-CSRF-Token`), corpo restrito a JSON e CORS com lista fechada de origens |
| Token em log/`Referer` | O callback do OAuth não leva mais token na URL |
| Força bruta de senha | 5 falhas por IP em 15 min → bloqueio de 30 min, com o IP **do cliente** (o `trust proxy` corrigiu isto) |
| Sessão eterna | JWT de 15 min; logout coloca o `jti` numa blacklist em Redis |

Ver `SPEC_CP20` para o raciocínio completo, inclusive por que `sameSite: 'none'`
era obrigatório e o que isso custou.

## 4. Injeção

- **SQL:** duas queries cruas no projeto, ambas parametrizadas (`$1..$n`). O
  `INSERT … VALUES` monta apenas *placeholders*; os valores vão pelo array. Todo
  o resto passa por query builder do TypeORM.
- **Corpo da requisição:** validação global com `whitelist` +
  `forbidNonWhitelisted` — campo não declarado no DTO derruba a requisição, em
  vez de ser ignorado em silêncio.
- **Comando/`eval`:** não existem no código.
- **Redirect aberto:** o `?next=` do login só aceita caminho interno; o callback
  do OAuth usa endereço resolvido no servidor.

## 5. Ver dados de quem não é você

| Regra | Como |
|---|---|
| Recurso alheio responde **404**, não 403 | 403 confirmaria que existe. Vale para ingresso, reserva, evento e métricas |
| Métricas do organizador são agregados | Nenhum nome, e-mail ou id de comprador |
| Portaria vê documento **mascarado** | 4 dígitos visíveis: dá para comparar, não para anotar |
| Prévia do link compartilhado | Evento e assento, nunca quem comprou |
| Sala do WebSocket | Só ids e horário; a sala é pública e a mensagem foi desenhada sabendo disso |

## 6. Derrubar ou drenar o serviço

Limites por rota em cadastro, reserva, pagamento, portaria e catálogo, mais um
teto geral. O caso do catálogo é econômico antes de ser técnico: cada busca
consome da cota de 5.000/dia do Ticketmaster, compartilhada pela plataforma.

## O que continua em aberto

Está em `README.md` → *Limitações conhecidas* e em
[DEPENDENCIAS.md](DEPENDENCIAS.md). Em resumo: três avisos `high` de dependência
que exigem Nest 11 e não são alcançáveis por esta superfície; token do OAuth
ainda trafegando na URL do callback (mitigado, não eliminado); e ausência de
verificação de e-mail no cadastro.
