import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integração: aplicação Nest real contra Postgres e Redis (pnpm infra:up).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['./test/setup.integration.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
