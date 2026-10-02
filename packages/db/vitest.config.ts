import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Este pacote só tem testes de integração (precisam do Postgres).
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
  },
});
