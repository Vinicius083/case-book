import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Unitários de lógica pura (cliente HTTP, validação de rota). Fluxos de tela são
// cobertos pelo Playwright em e2e/.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
