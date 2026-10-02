import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Este pacote só tem testes de integração (precisam do Postgres).
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
    // Nomes dos testes na saída (inclusive no CI): cada caso é uma regra do schema.
    reporters: ['verbose'],
  },
});
