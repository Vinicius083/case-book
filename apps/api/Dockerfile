# syntax=docker/dockerfile:1.7
# Build (contexto = raiz do repo):
#   docker build -f apps/api/Dockerfile -t casebook-api .

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
RUN pnpm dlx turbo@2.11.3 prune @casebook/api --docker

# ─── build: install offline (store do stage deps) + build + deploy de produção.
# O deploy usa --prefer-offline: no pnpm 9 ele re-resolve metadados das deps dos
# pacotes do workspace, que o `pnpm fetch` não guarda (tarballs vêm do store).
FROM deps AS build
COPY --from=prune /repo/out/json/ ./
RUN pnpm install --offline --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
RUN pnpm turbo run build --filter=@casebook/api \
 && pnpm --filter=@casebook/api deploy --prod --prefer-offline /prod

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod ./
USER node
ENV API_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.API_PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# instrumentation.js via --import: precisa carregar antes de qualquer módulo instrumentado.
CMD ["node", "--enable-source-maps", "--import", "./dist/instrumentation.js", "dist/main.js"]
