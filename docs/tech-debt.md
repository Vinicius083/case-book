# Dívida técnica

Registro do que ficou conscientemente para depois. Ao resolver um item, remova a linha e
referencie o PR.

| Item | Origem | Impacto | Quando resolver |
| --- | --- | --- | --- |
| **ESLint 9 marcado como deprecated.** O `eslint-plugin-import` (usado para ordenação de imports em `packages/config`) só suporta até a v9. | Sprint 0, parte 1 | Aviso de deprecation a cada `pnpm i`; sem correções novas do ESLint 9. Nenhum efeito funcional hoje. | Quando o `eslint-plugin-import` suportar a v10, ou migrando para `eslint-plugin-import-x` (suporta flat config e v10). Reavaliar na Sprint 2. |
| **Sem spans de nível Nest.** A instrumentação `@opentelemetry/instrumentation-nestjs-core` não se aplica ao Nest 12 em ESM. | Sprint 0, parte 2 | Traces mostram HTTP → handler (via `@fastify/otel`) → `pg`/`redis`, mas não guards, pipes e interceptors individualmente. | Se faltar granularidade ao depurar (provável na Sprint 1, com auth), avaliar um interceptor manual que abra spans por guard/pipe. |
| **Tamanho das imagens Docker.** Medido: api 307 MB, worker-image 290 MB, web 259 MB, worker-video 931 MB. A base `node:22-slim` sozinha ocupa ~227 MB. | Sprint 0, parte 3 | Pull mais lento no deploy. A meta original (< 250 / < 200 MB) era inalcançável com a base atual e foi revisada para ≤ 320 MB nas imagens Node. | Sprint 8, medindo o pull time no deploy real: runtime distroless/bundle nas imagens Node e FFmpeg compilado do fonte no worker-video. Ver [ADR 0001](adr/0001-tamanho-de-imagens-e-ffmpeg.md). |
| **`ffprobe` redundante no worker-video.** O probe é feito pelo PyAV; o binário estático do `ffprobe` ocupa ~165 MB. | Sprint 0, fechamento | ~165 MB a mais na imagem, em troca de uma ferramenta de depuração dentro do container. | Sprint 6, quando o pipeline de vídeo existir: remover se ninguém usar. Ver [ADR 0001](adr/0001-tamanho-de-imagens-e-ffmpeg.md). |
| **`ZodError` sempre vira 422.** O `ProblemDetailsFilter` trata qualquer `ZodError` como erro de validação da requisição. | Sprint 0, parte 2 | Um `ZodError` interno (ex.: ao validar dado lido do banco) responderia 422 em vez de 500, culpando o cliente por um bug do servidor. | Sprint 1, quando surgirem os primeiros endpoints com body: o pipe passa a lançar uma exceção própria e `ZodError` cru vira 500. |
