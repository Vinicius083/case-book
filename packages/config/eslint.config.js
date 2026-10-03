import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import globals from 'globals';
import { configs as tsConfigs } from 'typescript-eslint';

/**
 * Config base compartilhada. Cada app/pacote consome com:
 *
 *   import casebook from '@casebook/config/eslint';
 *   export default casebook;
 *
 * A análise com tipos usa `projectService`, então cada pacote precisa de um
 * tsconfig.json cobrindo os arquivos que o ESLint vai ler.
 */
export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      // Temporário do tsup (bundle-require): o `tsup.config.ts` vira um
      // `tsup.config.bundled_<hash>.mjs` que existe só durante o build. O turbo
      // roda `lint` e `build` do mesmo pacote em paralelo; sem isto o ESLint lista
      // o arquivo e quebra com ENOENT (exit 2) quando o tsup o apaga.
      '**/*.bundled_*.mjs',
    ],
  },
  js.configs.recommended,
  tsConfigs.strictTypeChecked,
  tsConfigs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: { projectService: true },
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver(), createNodeResolver()],
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          pathGroups: [{ pattern: '@casebook/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',
      // Módulos Nest são classes vazias com decorator.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      // Resolução já é garantida pelo TypeScript; a regra é lenta e dá falso positivo com `exports`.
      'import-x/no-unresolved': 'off',
    },
  },
  // Arquivos JS (eslint.config.js etc.) ficam fora dos tsconfig dos pacotes:
  // lint sem regras que exigem informação de tipo.
  { files: ['**/*.js', '**/*.mjs'], extends: [tsConfigs.disableTypeChecked] },
  prettier,
);
