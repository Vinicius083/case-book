import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unitários: sem infra. Integração fica em vitest.integration.config.ts.
export default defineConfig({
  // O esbuild do Vite não emite metadados de decorators; sem eles o DI do Nest
  // não resolve dependências pelo tipo do construtor.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./test/setup.unit.ts'],
    environment: 'node',
  },
});
