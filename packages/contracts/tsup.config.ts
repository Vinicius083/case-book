import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // Em watch não limpa dist/: os apps em `pnpm dev` importam daqui e quebrariam
  // durante o rebuild.
  clean: !options.watch,
  target: 'node22',
}));
