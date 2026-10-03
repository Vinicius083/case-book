import { defineConfig } from 'vitest/config';

// Unitários: sem infra. Integração fica em vitest.integration.config.ts.
export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node', testTimeout: 60_000 },
});
