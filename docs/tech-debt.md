# Dívida técnica

Registro do que ficou conscientemente para depois. Ao resolver um item, remova a linha e
referencie o PR.

| Item | Origem | Impacto | Quando resolver |
| --- | --- | --- | --- |
| **ESLint 9 marcado como deprecated.** O `eslint-plugin-import` (usado para ordenação de imports em `packages/config`) só suporta até a v9. | Sprint 0, parte 1 | Aviso de deprecation a cada `pnpm i`; sem correções novas do ESLint 9. Nenhum efeito funcional hoje. | Quando o `eslint-plugin-import` suportar a v10, ou migrando para `eslint-plugin-import-x` (suporta flat config e v10). Reavaliar na Sprint 2. |
| **Sem spans de nível Nest.** A instrumentação `@opentelemetry/instrumentation-nestjs-core` não se aplica ao Nest 12 em ESM. | Sprint 0, parte 2 | Traces mostram HTTP → handler (via `@fastify/otel`) → `pg`/`redis`, mas não guards, pipes e interceptors individualmente. | Se faltar granularidade ao depurar (provável na Sprint 1, com auth), avaliar um interceptor manual que abra spans por guard/pipe. |
| **Tamanho das imagens Docker.** Medido: api 307 MB, worker-image 290 MB, web 259 MB, worker-video 1,04 GB. A base `node:22-slim` sozinha ocupa ~227 MB. | Sprint 0, parte 3 | Pull mais lento no deploy; a meta original (< 250 / < 200 MB) é inalcançável com a base atual. | Sprint 8, medindo o pull time no deploy real. Decisão a registrar na ADR 0001 (**pendente** — ver nota abaixo). |
| **`ZodError` sempre vira 422.** O `ProblemDetailsFilter` trata qualquer `ZodError` como erro de validação da requisição. | Sprint 0, parte 2 | Um `ZodError` interno (ex.: ao validar dado lido do banco) responderia 422 em vez de 500, culpando o cliente por um bug do servidor. | Sprint 1, quando surgirem os primeiros endpoints com body: o pipe passa a lançar uma exceção própria e `ZodError` cru vira 500. |

## Nota — ADR 0001 pendente

A ADR da meta de tamanho de imagens não foi escrita no fechamento da Sprint 0 porque uma das
premissas não se confirmou: o wheel do PyAV 18.1.0 instalado **inclui `libx264`** (encode H.264
High verificado no container do `worker-video`). A decisão de manter ou não o `ffmpeg` do apt
(~400 MB da imagem) precisa ser refeita com esse dado antes de virar ADR.
