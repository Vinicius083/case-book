import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: o tracing do standalone precisa enxergar a raiz para copiar os
  // node_modules hoisted e os pacotes do workspace.
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@casebook/contracts'],
  poweredByHeader: false,
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
