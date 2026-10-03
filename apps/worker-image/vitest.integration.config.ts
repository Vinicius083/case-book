import { defineConfig } from 'vitest/config';

// Integração: Postgres, Redis e MinIO do compose (pnpm infra:up). O HEIC exige o
// heif-dec do libheif ≥ 1.18 (HEIF_DEC_BIN; no CI, do ppa:strukturag/libheif).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['./test/setup.integration.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
