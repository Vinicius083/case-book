# Casebook

Plataforma de portfólio para profissionais do audiovisual, construída por blocos de layout e com
foco em qualidade de mídia (HLS, AVIF/WebP).

- [`docs/requisitos.md`](docs/requisitos.md) — requisitos, modelo de dados e API
- [`docs/stack.md`](docs/stack.md) — decisões de stack e justificativas
- [`docs/plano-de-sprint.md`](docs/plano-de-sprint.md) — plano de sprints do MVP

## Arquitetura

```
              browser ─────────── PUT das partes (URL presigned) ──────────────┐
                 │                                                             │
                 ▼                                                             ▼
        ┌─────────────────┐   fetch + traceparent   ┌─────────────────┐   MinIO (S3)
        │ web  :3000      │ ──────────────────────▶ │ api  :3001      │   casebook-originals (privado)
        │ Next.js 15 RSC  │                         │ NestJS/Fastify  │   casebook-media (público)
        └─────────────────┘                         └────┬───────┬────┘
                                       complete: estado + │       │ Redis db 1
                                       outbox + NOTIFY    ▼       ▼ (rate limit, sessões)
                                                  ┌──────────────┐
                                                  │ Postgres 16  │
                                                  └──────┬───────┘
                                          LISTEN outbox  │  + poll a cada 5s
                                                         ▼
                                                  ┌──────────────┐  fila maintenance
                                                  │ relay        │  (GC de uploads,
                                                  │ outbox→BullMQ│   reservas de handle)
                                                  └──────┬───────┘
                         Redis db 0 (BullMQ) ◀── job.data.traceparent (span outbox.relay)
                              │                  │
                              ▼ fila "image"     ▼ fila "video"
                      ┌───────────────┐  ┌──────────────────┐
                      │ worker-image  │  │ worker-video     │
                      │ Node + sharp  │  │ Python + PyAV    │
                      └───────────────┘  └──────────────────┘

  todos ──OTLP/HTTP :4318──▶ SigNoz (collector → ClickHouse → UI :3301)
```

A API nunca enfileira direto: o `complete` grava o estado e o evento em `outbox_events` na mesma
transação, e o **relay** (processo separado, ADR-4) publica no BullMQ. Uma queda do Redis entre o
commit e o enfileiramento não perde o job (RNF-6): o evento fica pendente até o relay conseguir
publicar. O trace atravessa tudo: `POST /media/:id/complete` → `upload.complete` → `s3.*` →
`outbox.relay` → `image.process`, num único `trace_id`.

## Estrutura

```
apps/
  web/            Next.js 15 (App Router, output standalone)
  api/            NestJS + Fastify
  relay/          outbox → BullMQ (LISTEN/NOTIFY + poll) e jobs agendados de manutenção
  worker-image/   Node + sharp + BullMQ
  worker-video/   Python 3.12 + PyAV + BullMQ (uv)
packages/
  config/         tsconfig, ESLint e Prettier compartilhados
  contracts/      Zod: env, Problem Details, payloads e nomes de filas; `/auth`, `/handle`, `/profile`, `/media`: contratos da API
  db/             schema Drizzle e migrations
  storage/        cliente S3 (MinIO/R2), layout de chaves e spans manuais, compartilhado por api, relay e worker
  renderer/       renderização dos blocos de layout (Sprint 3)
infra/dev/        configs da infra local (Postgres, MinIO, SigNoz)
```

## Pré-requisitos

- Node 22 (`nvm use` lê o `.nvmrc`)
- pnpm 9 — via Corepack: `corepack enable` (a versão exata vem de `packageManager`)
- [uv](https://docs.astral.sh/uv/) e Python 3.12 — para o `worker-video`
- Docker com Compose v2.20+ (usa `include:`)
- ~1 GB de RAM livre para a infra (medido em idle: ~840 MB, sendo ~670 MB do SigNoz —
  ClickHouse ~370 MB e ZooKeeper ~300 MB)

## Primeiros passos

```bash
cp .env.example .env
pnpm i
pnpm infra:up       # espera tudo ficar healthy (~1–2 min na primeira vez)
pnpm db:migrate
pnpm dev            # web, api, relay, worker-image, worker-video e watch dos pacotes
```

Abra http://localhost:3000 — a página mostra o `/health` da API (api, postgres, redis).

> Já tem um Postgres local em 5432? Defina `POSTGRES_PORT=5433` no `.env` e ajuste a porta no
> `DATABASE_URL`.

Para rodar um app só: `pnpm --filter api dev`, `pnpm --filter web dev` etc. Os pacotes
internos (`db`, `contracts`) são buildados antes automaticamente.

## Serviços

| Serviço        | URL / porta                                      | Credenciais (dev)                              |
| -------------- | ------------------------------------------------ | ---------------------------------------------- |
| Web            | http://localhost:3000                            | —                                              |
| API            | http://localhost:3001                            | —                                              |
| Postgres 16    | `localhost:5432`                                 | `casebook` / `casebook`, db `casebook`         |
| Redis 7        | `localhost:6379`                                 | — (db 0 = filas, db 1 = cache/rate-limit)      |
| MinIO (S3 API) | http://localhost:9000                            | `S3_ACCESS_KEY` / `S3_SECRET_KEY`              |
| MinIO console  | http://localhost:9001                            | idem                                           |
| SigNoz UI      | http://localhost:3301                            | `SIGNOZ_ADMIN_EMAIL` / `SIGNOZ_ADMIN_PASSWORD` |
| OTLP           | `localhost:4317` (gRPC), `localhost:4318` (HTTP) | —                                              |

Buckets: `casebook-originals` (privado, acesso só por URL pré-assinada) e `casebook-media`
(leitura anônima).

## Testando a propagação de trace

Com `pnpm dev` rodando:

```bash
pnpm --filter worker-image enqueue:test          # fila image → worker Node
pnpm --filter worker-image enqueue:test video    # fila video → worker Python
```

O script cria um span `enqueue.test <fila>` (PRODUCER), injeta o `traceparent` no payload do job e
imprime o `trace_id`. No SigNoz (Traces → busque pelo `trace_id`) aparece **um único trace** com o
span do script como pai e `image.process` / `video.process` (CONSUMER) do worker como filho — o
contexto atravessou Node → Redis → Node/Python.

Também dá para ver web → api: cada acesso a http://localhost:3000 gera um trace
`casebook-web GET /` → `fetch` → `casebook-api GET /health` → spans de `pg` e `redis`.

Erros da API seguem RFC 9457 (`application/problem+json`) com `trace_id` — cole no SigNoz para
achar o trace da requisição.

## Autenticação e perfil

Feita à mão, sem Passport/NextAuth: senha em `argon2id`, access token JWT HS256 de 15 min
(`Authorization: Bearer`, guardado em memória pelo client) e refresh token opaco de 30 dias no
cookie `cb_refresh` (`HttpOnly; Secure; SameSite=Lax`), do qual o banco só guarda o SHA-256.

| Rota                                | Autenticação | Efeito                                                                        |
| ----------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| `POST /auth/signup`                 | —            | cria `users` + `profiles`, devolve access token + cookie (201)                |
| `POST /auth/login`                  | —            | access token + cookie, numa família nova de refresh tokens                    |
| `POST /auth/refresh`                | cookie       | rotaciona o refresh token: novo access token + novo cookie                    |
| `POST /auth/logout`                 | cookie       | revoga a família do cookie e o limpa (204)                                    |
| `POST /auth/logout-all`             | Bearer       | revoga todas as famílias do usuário (204)                                     |
| `GET /me`                           | Bearer       | user + profile; o `ETag` é exigido na edição                                  |
| `PATCH /me/profile`                 | Bearer       | edição parcial, com `If-Match` (409 se desatualizado)                         |
| `PATCH /me/handle`                  | Bearer       | troca de handle (uma a cada 30 dias; o antigo fica 30 dias reservado ao dono) |
| `PATCH /me/password`                | Bearer       | senha atual + nova; derruba as outras sessões                                 |
| `GET /handles/:handle/availability` | —            | `{ available, reason? }` (`taken`, `reserved`, `invalid`)                     |
| `GET /public/profiles/:handle`      | —            | perfil público, sem email, `Cache-Control: public, max-age=60`                |

Requests prontos para todos os endpoints em [`docs/api/sprint-1.http`](docs/api/sprint-1.http).

Toda rota exige Bearer, salvo as marcadas com `@Public()`. Cada refresh troca o token; apresentar
um token já trocado há mais de 10s é tratado como roubo e revoga a família inteira (dentro dos
10s, é corrida entre abas e as duas recebem um token válido). Limites em Redis db 1, com 429 e
`Retry-After`: login 5 falhas/15 min por IP+email (zera no login bem-sucedido) e 30 tentativas/15 min por IP, signup 5/h por IP, refresh 60/min
por família.

```bash
curl -c jar.txt -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","password":"uma-senha-longa","handle":"ana","display_name":"Ana"}' \
  http://localhost:3001/auth/signup
curl -b jar.txt -c jar.txt -X POST http://localhost:3001/auth/refresh
curl -b jar.txt -c jar.txt -X POST http://localhost:3001/auth/logout
```

O cookie sai com `Path=/api/auth`, porque o browser sempre chega à API por `/api` (rewrite do Next
em dev, Caddy em produção). Batendo direto na porta 3001, como acima, o curl só reenvia o cookie
se a API subir com `AUTH_COOKIE_PATH=/auth` — ver [`docs/api/sprint-1.http`](docs/api/sprint-1.http).
Com `TRUST_PROXY=true` o IP do cliente vem de `X-Forwarded-For`.

### No front

O browser só fala com a própria origem: `next.config.ts` reescreve `/api/*` para `API_URL`, o
mesmo papel do Caddy em produção. Por isso o cookie `cb_refresh` funciona igual nos dois
ambientes, sem CORS com credenciais.

- **Access token só em memória** (`src/lib/api/session.ts`); nada em `localStorage`.
- **Cliente HTTP** (`src/lib/api/client.ts`): em 401 dispara um único refresh, compartilhado
  pelas requisições concorrentes, e refaz a original uma vez. Erros viram `ApiError`, com
  `fieldErrors` por campo a partir do Problem Details.
- **`middleware.ts`** redireciona pela presença do cookie `cb_session` — um marcador sem segredo
  que a API emite junto com o `cb_refresh` (este só trafega em `/api/auth`, então não aparece nas
  requisições de página). É só UX: quem autoriza é a API.
- **Rotas:** `/signup`, `/login`, `/app` (projetos), `/app/media`, `/app/settings/profile` e uma
  versão mínima de `/u/:handle`.

## Mídia (Sprint 2)

Upload direto do browser para o storage, sem bytes passando pela API:

| Rota                       | Efeito                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /media/uploads`      | valida tipo e tamanho, cria o asset em `pending` e devolve uma URL presigned por parte (10 MB, 1h) |
| `POST /media/:id/complete` | confere as partes, fecha o multipart; `uploaded` + evento de outbox na mesma transação             |
| `POST /media/:id/retry`    | de `failed` volta para `uploaded`, com evento novo                                                 |
| `GET /media`               | biblioteca por cursor; filtros `kind`, `state`, `q` (nome, índice trigram), `limit` ≤ 50           |
| `GET /media/:id`           | asset com derivativos e paleta                                                                     |
| `PATCH /media/:id`         | `filename`, `alt_text`                                                                             |
| `DELETE /media/:id`        | soft delete; em uso por bloco exige `?confirm=true` (409 com a lista de projetos)                  |

Requests prontos em [`docs/api/sprint-2.http`](docs/api/sprint-2.http). O mesmo arquivo (sha256)
na mesma conta é deduplicado. RAW de câmera é recusado (a revelação muda a cor) e vídeo fica atrás
de `MEDIA_VIDEO_ENABLED` até a Sprint 6 — ver [`docs/design/README.md`](docs/design/README.md#9-sprint-2--alinhamento-da-mídia-com-o-design).

Chaves no storage (documentadas em `packages/storage/src/keys.ts`): originais em
`o/{userId}/{mediaId}` no bucket privado; derivativos em `m/{mediaId}/{width}-{hash8}.{fmt}` no
público, imutáveis (`Cache-Control: immutable`), porque o hash do conteúdo está na chave.

O **relay** roda um por ambiente (duas instâncias também funcionam: `FOR UPDATE SKIP LOCKED`
divide os lotes) e consome a fila `maintenance`: de hora em hora aborta uploads `pending` há mais de
24h (RF-UP-6); todo dia às 04:00 UTC apaga reservas de handle vencidas.

> Os testes de integração que rodam o relay (`apps/api/test/media-pipeline.int.test.ts`) publicam
> qualquer evento pendente do banco: pare o `pnpm dev` antes de rodá-los, senão o relay de dev
> rouba os eventos.

### Processamento de imagem e eventos

O **worker-image** consome o job `image.process`: baixa o original conferindo o SHA-256, reconhece
o formato pelo conteúdo, gera AVIF e WebP em até seis larguras mais um JPEG de fallback, com a
qualidade escolhida por SSIM, extrai a paleta e grava tudo numa transação. As decisões (busca de
qualidade, variante de SSIM, HEIC, bucket público) estão na
[ADR 0002](docs/adr/0002-pipeline-de-imagem.md).

- **HEIC** exige o `heif-dec` do libheif ≥ 1.18. A imagem Docker já traz; fora dela, aponte
  `HEIF_DEC_BIN` para o binário (Ubuntu 24.04: `ppa:strukturag/libheif`).
- **`WORKER_CONCURRENCY`** (padrão 2) é o número de imagens processadas ao mesmo tempo; os núcleos
  são divididos entre elas.
- **`GET /media/events`** é um stream SSE (Bearer) com um evento `media.updated` a cada mudança de
  estado ou de progresso das mídias do usuário, e um comentário de heartbeat a cada 15 s. A conexão
  dura no máximo o tempo de vida do access token; o cliente reconecta com o token novo.

No browser, a biblioteca (`/app/media`) calcula o SHA-256 num Web Worker, em fatias de 8 MB, envia
as partes direto ao storage (até 4 em paralelo, com retry por parte) e acompanha o processamento
pelos eventos, sem recarregar. O access token fica só em memória; o stream de eventos autentica
por header.

Imagens reais para teste e benchmark ficam fora do git:

```bash
pnpm --filter @casebook/worker-image fixtures:fetch   # baixa ~135 MB e confere o SHA-256
pnpm --filter @casebook/worker-image bench            # mede o pipeline nelas (precisa da infra no ar)
```

O benchmark em condição de produção (container com CPU limitada) está descrito no cabeçalho de
[`apps/worker-image/src/scripts/bench.ts`](apps/worker-image/src/scripts/bench.ts).

## Rodando em Docker

Valida os Dockerfiles de produção sobre a infra de dev (pare o `pnpm dev` antes — mesmas portas):

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.apps.yml up --build
```

Build de uma imagem isolada (contexto sempre na raiz):

```bash
docker build -f apps/api/Dockerfile -t casebook-api .
```

## Banco

```bash
pnpm db:migrate     # aplica packages/db/migrations (migrator do Drizzle, nunca push)
pnpm db:generate    # gera migration a partir de packages/db/src/schema — revise o SQL
```

O `init.sql` do Postgres (extensões `pgcrypto` e `pg_trgm`) só roda na criação do volume. Se
mudá-lo, rode `pnpm infra:reset && pnpm infra:up`.

## Comandos

```bash
pnpm dev           # todos os apps em watch
pnpm build
pnpm lint          # inclui ruff no worker-video
pnpm typecheck     # inclui mypy --strict no worker-video
pnpm test              # unitários (TS + pytest) — não precisam de infra; com cache do turbo
pnpm test:integration  # *.int.test.ts e pytest -m integration — exigem `pnpm infra:up`; nunca em cache
pnpm test:all          # os dois, em sequência
pnpm --filter web test:e2e   # Playwright; exige `pnpm infra:up`, `pnpm build`, `pnpm db:migrate` e o `pnpm dev` parado
pnpm format

pnpm infra:up      # sobe e espera tudo ficar healthy
pnpm infra:down    # para os containers, mantém os dados
pnpm infra:reset   # para e APAGA os volumes (Postgres, Redis, MinIO, SigNoz)
```

## CI

`.github/workflows/ci.yml`, em todo PR e push na `main`:

- **node** — lint, typecheck, test e build de todos os pacotes TS (Postgres e Redis como services
  e MinIO pelo compose de dev, para os testes de integração), com cache do pnpm e do Turborepo
- **e2e** — Playwright (Chromium) contra a API, o relay, o worker de imagem e o Next em build de
  produção, com Postgres, Redis e MinIO: o upload do teste vai até `ready` de verdade; o relatório
  fica como artefato do run
- **python** — `ruff`, `mypy --strict` e `pytest` no `worker-video`
- **docker** — build das 5 imagens com Buildx e cache `type=gha`; push no GHCR
  (`ghcr.io/<owner>/casebook-<app>:<sha curto>`) só em push na `main`
