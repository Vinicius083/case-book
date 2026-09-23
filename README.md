# Casebook

Plataforma de portfólio para profissionais do audiovisual, construída por blocos de layout e com
foco em qualidade de mídia (HLS, AVIF/WebP).

- [`docs/requisitos.md`](docs/requisitos.md) — requisitos, modelo de dados e API
- [`docs/stack.md`](docs/stack.md) — decisões de stack e justificativas
- [`docs/plano-de-sprint.md`](docs/plano-de-sprint.md) — plano de sprints do MVP

## Arquitetura (Sprint 0)

```
              browser
                 │
                 ▼
        ┌─────────────────┐   fetch + traceparent   ┌─────────────────┐
        │ web  :3000      │ ──────────────────────▶ │ api  :3001      │
        │ Next.js 15 RSC  │                         │ NestJS/Fastify  │
        └─────────────────┘                         └────┬───────┬────┘
                                                         │       │
                                              Postgres 16│       │Redis 7 (db 1: cache)
                                                         ▼       ▼
                                          ┌────────────────────────────────┐
   Redis 7 (db 0: filas BullMQ) ◀─────────│ job.data.traceparent           │
        │                  │              │ (propaga o trace pela fila)    │
        ▼ fila "image"     ▼ fila "video" └────────────────────────────────┘
  ┌───────────────┐  ┌──────────────────┐
  │ worker-image  │  │ worker-video     │         MinIO (S3): casebook-originals (privado)
  │ Node + sharp  │  │ Python + PyAV    │                     casebook-media (público)
  │ concorrência 4│  │ concorrência 1   │
  └───────────────┘  └──────────────────┘

  todos ──OTLP/HTTP :4318──▶ SigNoz (collector → ClickHouse → UI :3301)
```

Na Sprint 0 os processors são `noop` e ainda não há produtor de jobs na API: o script
`enqueue:test` faz esse papel para provar a propagação de trace.

## Estrutura

```
apps/
  web/            Next.js 15 (App Router, output standalone)
  api/            NestJS + Fastify
  worker-image/   Node + sharp + BullMQ
  worker-video/   Python 3.12 + PyAV + BullMQ (uv)
packages/
  config/         tsconfig, ESLint e Prettier compartilhados
  contracts/      Zod: env, Problem Details, payloads e nomes de filas
  db/             schema Drizzle e migrations
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
pnpm dev            # web, api, worker-image, worker-video e watch dos pacotes
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
pnpm test          # inclui pytest; testes de integração da API precisam da infra no ar
pnpm format

pnpm infra:up      # sobe e espera tudo ficar healthy
pnpm infra:down    # para os containers, mantém os dados
pnpm infra:reset   # para e APAGA os volumes (Postgres, Redis, MinIO, SigNoz)
```

## CI

`.github/workflows/ci.yml`, em todo PR e push na `main`:

- **node** — lint, typecheck, test e build de todos os pacotes TS (Postgres e Redis como services
  para os testes de integração), com cache do pnpm e do Turborepo
- **python** — `ruff`, `mypy --strict` e `pytest` no `worker-video`
- **docker** — build das 4 imagens com Buildx e cache `type=gha`; push no GHCR
  (`ghcr.io/<owner>/casebook-<app>:<sha curto>`) só em push na `main`
