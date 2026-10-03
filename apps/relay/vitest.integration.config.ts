import { defineConfig } from 'vitest/config';

// Integração: Postgres, Redis e MinIO do compose (pnpm infra:up).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['./test/setup.integration.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
