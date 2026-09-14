import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/test-results/**', '**/playwright-report/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['electron', 'react*', '*sqlite*', 'drizzle*', 'node:*', '@arise/*', '*chart*', '*mt5*'] }] },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['electron', 'node:*', '@arise/database', '*sqlite*', 'drizzle*', '*mt5*', '**/main/*'] }] },
  },
);
