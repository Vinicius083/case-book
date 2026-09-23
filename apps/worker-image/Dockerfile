# syntax=docker/dockerfile:1.7
# Build (contexto = raiz do repo):
#   docker build -f apps/worker-image/Dockerfile -t casebook-worker-image .

ARG NODE_IMAGE=node:22.23.2-slim

# ─── base: pnpm via Corepack, versão fixada pelo packageManager ────────────────
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# ─── deps: baixa todo o lockfile para o store. Só invalida quando o lock muda ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch

# ─── prune: recorta o monorepo só com o app e suas dependências de workspace ──
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.3 prune @casebook/worker-image --docker

# ─── build: install offline (store do stage deps) + build + deploy de produção.
# O deploy usa --prefer-offline: no pnpm 9 ele re-resolve metadados das deps dos
# pacotes do workspace, que o `pnpm fetch` não guarda (tarballs vêm do store).
FROM deps AS build
COPY --from=prune /repo/out/json/ ./
RUN pnpm install --offline --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
RUN pnpm turbo run build --filter=@casebook/worker-image \
 && pnpm --filter=@casebook/worker-image deploy --prod --prefer-offline /prod

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod ./
USER node
# Sem HEALTHCHECK: o worker não expõe HTTP. Liveness = processo vivo; o BullMQ
# reentrega jobs de workers que perdem o lock.
CMD ["node", "--enable-source-maps", "--import", "./dist/instrumentation.js", "dist/main.js"]
