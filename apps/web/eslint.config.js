import nextPlugin from '@next/eslint-plugin-next';

import casebook from '@casebook/config/eslint';

export default [
  {
    ignores: [
      '.next/**',
      '.next-e2e/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...casebook,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Sem `next/image`: os derivativos já saem prontos do worker de imagem e são
      // servidos direto do storage (`images.unoptimized` no next.config.ts).
      '@next/next/no-img-element': 'off',
    },
  },
];
