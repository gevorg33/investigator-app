// Flat config (ESLint 9). Rules that encode architecture decisions carry their ADR.
import js from '@eslint/js';
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
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*'],
              message:
                'Cross-package relative imports are forbidden. Depend on the workspace package (@investigator/*) instead — T-001.',
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
