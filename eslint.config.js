// Flat config (ESLint 9). Rules that encode architecture decisions carry their ADR.
import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: { 'import-x': importX },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `const { omitted: _x, ...rest } = obj` is the idiomatic way to drop a key.
          ignoreRestSiblings: true,
        },
      ],

      // Catches the package-root form: '../../validation'. Resolves package.json
      // boundaries rather than guessing from path depth — a hand-rolled '../../*'
      // pattern also blocks legitimate intra-package imports (T-001).
      'import-x/no-relative-packages': 'error',

      // The rule above resolves entry points, so a deep path into another package's
      // source ('../../validation/src/index') slips past it — verified.
      // Re-entering a 'src' directory after traversing up is cross-package by
      // construction: you are already inside your own src and never climb back into it.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../**/src/**'],
              message:
                'Deep relative import into another package. Depend on the workspace package (@investigator/*) and its public entry point instead — T-001.',
            },
          ],
        },
      ],
    },
  },

  // ADR-0004: packages/ui is web-only. shadcn, Cult UI and React Bits are DOM
  // libraries and will break the React Native build. Share tokens, never components.
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@investigator/ui',
              message:
                'packages/ui is web-only (ADR-0004). DOM component libraries break the React Native build. Share design tokens, never components.',
            },
          ],
          patterns: [
            {
              group: ['@investigator/ui/*', 'react-dom', 'react-dom/*', 'next', 'next/*'],
              message: 'Web-only dependency. Not importable from the mobile companion (ADR-0004).',
            },
          ],
        },
      ],
    },
  },
);
