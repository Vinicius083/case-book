# syntax=docker/dockerfile:1.7
# Build (contexto = raiz do repo):
#   docker build -f apps/web/Dockerfile -t casebook-web .

ARG NODE_IMAGE=node:22.23.2-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.3 prune @casebook/web --docker

FROM deps AS build
COPY --from=prune /repo/out/json/ ./
RUN pnpm install --offline --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
# output: 'standalone' → .next/standalone traz server.js + só os node_modules usados.
RUN pnpm turbo run build --filter=@casebook/web

# ─── runtime: sem node_modules do workspace, só o standalone ─────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
# O standalone não inclui assets estáticos: copiados ao lado do server.js.
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
