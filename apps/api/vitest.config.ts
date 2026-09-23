import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // O esbuild do Vite não emite metadados de decorators; sem eles o DI do Nest
  // não resolve dependências pelo tipo do construtor.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
