import nextPlugin from '@next/eslint-plugin-next';

import casebook from '@casebook/config/eslint';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...casebook,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
];
