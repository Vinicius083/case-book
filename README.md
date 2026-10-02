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
  contracts/      Zod: env, Problem Details, payloads e nomes de filas; `/auth`, `/handle`, `/profile`: contratos da API
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
pnpm --filter web test:e2e   # Playwright; exige `pnpm infra:up`, `pnpm build` e `pnpm db:migrate`
pnpm format

pnpm infra:up      # sobe e espera tudo ficar healthy
pnpm infra:down    # para os containers, mantém os dados
pnpm infra:reset   # para e APAGA os volumes (Postgres, Redis, MinIO, SigNoz)
```

## CI

`.github/workflows/ci.yml`, em todo PR e push na `main`:

- **node** — lint, typecheck, test e build de todos os pacotes TS (Postgres e Redis como services
  para os testes de integração), com cache do pnpm e do Turborepo
- **e2e** — Playwright (Chromium) contra a API e o Next em build de produção, com Postgres e Redis
  como services; o relatório fica como artefato do run
- **python** — `ruff`, `mypy --strict` e `pytest` no `worker-video`
- **docker** — build das 4 imagens com Buildx e cache `type=gha`; push no GHCR
  (`ghcr.io/<owner>/casebook-<app>:<sha curto>`) só em push na `main`
