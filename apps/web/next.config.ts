import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const config: NextConfig = {
  // O E2E builda em outra pasta, para não atropelar o `.next` de um `pnpm dev` em curso.
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  output: 'standalone',
  // Monorepo: o tracing do standalone precisa enxergar a raiz para copiar os
  // node_modules hoisted e os pacotes do workspace.
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@casebook/contracts'],
  poweredByHeader: false,
  // Mesma origem: o browser só fala com /api/*, e o Next repassa para a API —
  // o mesmo papel do Caddy em produção. É o que mantém o cookie `cb_refresh`
  // (Path=/api/auth) funcionando igual nos dois ambientes, sem CORS com credenciais.
  // Avaliado no build: em imagem Docker, API_URL entra como build arg.
  rewrites: () =>
    Promise.resolve([
      {
        source: '/api/:path*',
        destination: `${process.env['API_URL'] ?? 'http://localhost:3001'}/:path*`,
      },
    ]),
  images: {
    // Derivativos (AVIF/WebP em várias larguras) são gerados pelo worker-image e
    // servidos direto do storage; o otimizador do Next seria trabalho duplicado.
    unoptimized: true,
  },
  outputFileTracingExcludes: {
    // Sem otimizador de imagem, sharp/libvips não são usados em runtime; typescript
    // entra no trace só por causa do next.config.ts.
    '*': ['node_modules/sharp/**', 'node_modules/@img/**', 'node_modules/typescript/**'],
  },
};

export default config;
