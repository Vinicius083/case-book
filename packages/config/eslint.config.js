import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
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
  { ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/.turbo/**'] },
  js.configs.recommended,
  tsConfigs.strictTypeChecked,
  tsConfigs.stylisticTypeChecked,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: { projectService: true },
    },
    settings: {
      'import/resolver': { typescript: true, node: true },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          pathGroups: [{ pattern: '@casebook/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      // Módulos Nest são classes vazias com decorator.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      // Resolução já é garantida pelo TypeScript; a regra é lenta e dá falso positivo com `exports`.
      'import/no-unresolved': 'off',
    },
  },
  // Arquivos JS (eslint.config.js etc.) ficam fora dos tsconfig dos pacotes:
  // lint sem regras que exigem informação de tipo.
  { files: ['**/*.js', '**/*.mjs'], extends: [tsConfigs.disableTypeChecked] },
  prettier,
);
