# SPEC — CP24: o ingresso aparece na hora, e a aba não mente sobre quem é você

## Contexto

Dois relatos de uso real, na mesma sessão de teste:

1. **"Comprei um ingresso e não apareceu. Na verdade apareceu, porém demorou muito."**
2. **"Fechei a aba estando como escaneador; abri de novo e estava como cliente, bugado, sem
   mostrar ingresso. Ao recarregar, mostrou."**

Nenhum dos dois é do servidor, e isso importa: o backend fez tudo certo nas duas vezes.

**O primeiro.** O checkout só declara sucesso quando o ingresso **já existe** — `waitForSettlement`
fica em `settling` enquanto `ticketsPending` for verdadeiro, exatamente para não jogar o comprador
numa lista vazia (correção do B13). Ou seja: quando a tela diz "Ingresso garantido", o ingresso
está no banco. O que estava velho era o **cache do navegador**. O `QueryClient` nasce com
`staleTime` de 5 minutos e ninguém invalida `['my-tickets']` depois da compra: quem já tinha
aberto "Meus ingressos" antes de comprar via a lista de antes, considerada *fresca* — o React
Query nem sequer refazia a busca em segundo plano. O ingresso aparecia aos 5 minutos, ou na hora
em que a pessoa recarregava e derrubava o cache. É o relato inteiro, incluindo o "ao recarregar
mostrou".

**O segundo.** A sessão é **um cookie do navegador**; o usuário é **estado React de uma aba**.
Entrar com outra conta em outra aba troca o cookie das duas — e a primeira continua estampando o
nome antigo enquanto já faz cada requisição como a conta nova. `GET /tickets` responde com os
ingressos de quem o **cookie** diz que é: para a portaria, nenhum. Aí o `staleTime` de 5 minutos
fixa essa lista vazia na tela do cliente. Nada revalida a sessão quando a aba volta ao foco, e o
cache não é separado por pessoa, então dado de uma identidade sobrevive à troca para outra.

O denominador comum dos dois é o mesmo erro de raciocínio: tratar cache de leitura como se fosse
o estado do sistema. O servidor é a fonte da verdade sobre o que existe e sobre quem está pedindo;
o cache precisa ser jogado fora quando qualquer um dos dois muda.

## Requisitos funcionais

- RF-1: Concluído o pagamento, a lista de ingressos é descartada do cache **antes** da navegação.
  A tela de "Meus ingressos" abre buscando do servidor, não exibindo o que havia antes da compra.
- RF-2: A mesma conclusão invalida os assentos e o detalhe do evento — os lugares que acabaram de
  ser vendidos não podem continuar desenhados como livres para quem volta ao mapa.
- RF-3: As consultas de dados pessoais são endereçadas **por dono**: a chave de `my-tickets`
  inclui o id do usuário. Cache de uma pessoa deixa de ser alcançável pela chave de outra.
- RF-4: Quando a aba volta a ficar visível, o SPA reconfere a sessão com `GET /auth/me`.
- RF-5: Se a identidade que volta do servidor for diferente da que estava em memória — inclusive
  "ninguém" —, o cache de consultas é esvaziado por inteiro.
- RF-6: A reconferência tem intervalo mínimo, para alternar de aba não virar uma rajada de
  requisições contra o limitador do CP21.

## Requisitos não-funcionais

- RNF-1: A reconferência não pode reiniciar o checkout. `reservationData` é estado do componente,
  não cache de consulta — esvaziar o cache não o alcança, e é assim que deve continuar.
- RNF-2: Nada de `setInterval` perguntando quem sou eu. O gatilho é a aba voltar, que é o momento
  em que a resposta pode ter mudado.

## Considerações de segurança

- Isto **não é** um controle de acesso; é uma correção de exibição. Quem decide o que cada
  requisição enxerga continua sendo o cookie verificado no servidor: a aba mentia para o usuário,
  nunca para a API. O `GET /tickets` da portaria voltava vazio justamente porque o servidor estava
  certo.
- Ainda assim tem valor defensivo: uma tela que mostra o nome de outra pessoa é uma tela em que
  alguém confia por engano — e um computador compartilhado (a portaria é exatamente isso) é onde
  isso acontece.
- Esvaziar o cache na troca de identidade fecha o vazamento de dados **entre contas dentro da
  mesma aba**: sem isso, métricas de organizador ou ingressos de cliente sobreviviam à troca de
  conta até envelhecerem sozinhos.

## Critérios de aceitação — testáveis

- AC-1: Comprar com "Meus ingressos" já visitada na mesma sessão de página → o ingresso novo
  aparece na lista **imediatamente**, sem recarregar e sem esperar.
- AC-2: Ao voltar para o mapa do evento depois da compra, os assentos comprados aparecem como
  vendidos.
- AC-3: Entrar como cliente numa aba e como portaria em outra; ao voltar para a aba do cliente, a
  barra passa a mostrar a portaria — a mesma conta que a API já estava usando.
- AC-4: Nesse mesmo momento, a lista de ingressos do cliente **não** permanece na tela.
- AC-5: Com a sessão encerrada em outra aba, voltar à aba antiga leva ao login em vez de manter
  uma interface logada que não funciona.
- AC-6: Alternar de aba repetidas vezes em poucos segundos não gera uma chamada a `/auth/me` por
  alternância.

## Casos de borda

- AC-E1: A primeira carga da página não conta como troca de identidade — não pode esvaziar cache
  nem piscar a tela.
- AC-E2: Voltar à aba com a **mesma** sessão não descarta nada.
- AC-E3: Visitante sem conta alternando de aba continua visitante, sem ser mandado para o login
  (o `allowAnonymous` do B19 continua valendo).

## Contrato de API

Nenhuma mudança. Os dois defeitos são de cliente.

## Validação real

Navegador contra o site publicado: comprar um ingresso do evento que está acontecendo agora tendo
aberto "Meus ingressos" antes; abrir cliente e portaria em abas separadas e alternar entre elas.

## Achado durante a implementação — a segunda porta

Um ingresso não nasce só na compra: ele também **chega**. `SharePage.accept`
transferia o ingresso e navegava para "Meus ingressos" sem tocar no cache, com o
mesmo desfecho — receber um ingresso e não vê-lo. A correção é a mesma nos dois
lugares, e foi por essa porta que a validação abaixo passou: ela dispensa cartão.

## Status
- [x] Spec escrita
- [x] Implementação concluída — `npx tsc -b` limpo
- [~] Validação real executada — 2026-08-13, parcial (ver ressalvas)

### Evidência da validação real

Ambiente local (`docker compose` + Vite), conta `client1@ticket.dev`, medindo as
requisições de rede além do que aparece na tela.

| Verificação | Resultado |
|---|---|
| **Mecanismo do defeito**, medido: ir a "Meus ingressos", sair e voltar pela navegação interna | **nenhum** `GET /tickets` novo — a lista sai do cache, tida como fresca por 5 min. É a causa do "comprei e não apareceu" |
| Lista aquecida antes de o ingresso chegar | 9 ingressos; assento `Sala 1-1-3` ausente |
| Receber ingresso transferido e cair na lista (RF-1) | **10 ingressos, com o `Sala 1-1-3` visível na hora**, sem recarregar — AC-1 ✔ |
| `GET /tickets` disparado por essa chegada | 1, exatamente o que a correção força |
| Trocar de conta na mesma aba (RF-3 e RF-5) | novo `GET /tickets`; `Cliente Dois` vê **os 3 dele**, nenhum dos 10 do anterior — AC-4 ✔ |
| Ingresso cedido, na lista de quem cedeu | "Invalidado" — a transferência do CP22 segue íntegra |

**Ressalvas honestas — o que não foi exercido aqui.** O painel do navegador desta
sessão não estava sendo desenhado, e isso fecha duas portas: não dá para digitar
no *iframe* de cartão da Stripe (compra ponta a ponta) nem para gerar evento de
visibilidade, já que `document.visibilityState` fica preso em `hidden` e a
reconferência — corretamente — se recusa a rodar em aba escondida. Então:

- AC-1 pelo **caminho da compra** ficou por confirmar. A chamada é a mesma linha
  do caminho da transferência, mas caminho parecido não é caminho testado.
- AC-3, AC-5 e AC-6, que dependem de alternar abas de verdade, idem.
