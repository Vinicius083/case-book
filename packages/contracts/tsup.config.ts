import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: [
    'src/index.ts',
    'src/auth.ts',
    'src/handle.ts',
    'src/profile.ts',
    'src/problem.ts',
    'src/media.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // Em watch não limpa dist/: os apps em `pnpm dev` importam daqui e quebrariam
  // durante o rebuild.
  clean: !options.watch,
  target: 'node22',
}));
