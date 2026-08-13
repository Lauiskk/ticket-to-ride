# SDD — documentação de sistema

Estrutura adaptada do projeto CyberAI. Nem toda pasta está preenchida: só entra
documento quando ele responde uma pergunta que alguém teve de verdade. Pasta com
arquivo vazio dentro é pior que pasta vazia — parece que existe resposta.

| Pasta | O que vive aqui | Estado |
|---|---|---|
| `01-visao-geral` | O que é o produto e para quem | no [README](../README.md) |
| `02-requisitos` | Requisitos e critérios | nas specs em [`docs/plan/`](../docs/plan/) |
| `03-arquitetura` | Decisões estruturais | seção *Arquitetura* e *Decisões Técnicas* do README |
| `04-design-detalhado` | Desenho por módulo | nos comentários do código e nas specs |
| `05-seguranca` | **Modelo de ameaças e dependências** | [MODELO_DE_AMEACAS.md](05-seguranca/MODELO_DE_AMEACAS.md) · [DEPENDENCIAS.md](05-seguranca/DEPENDENCIAS.md) |
| `06-testes` | Estratégia de testes | seção *Testes* do README |
| `07-operacional` | Deploy e operação | seção *Deploy* do README |
| `08-anexos` | Investigações de apoio | [API_TICKETMASTER_TMDB.md](08-anexos/API_TICKETMASTER_TMDB.md) — escrito sondando as APIs de verdade |

O registro do processo — decisão a decisão, com o que foi medido em cada
checkpoint — está em [`docs/plan/`](../docs/plan/), e o relato de como a IA foi
conduzida está em [`docs/IA.md`](../docs/IA.md).
