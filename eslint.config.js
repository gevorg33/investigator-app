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

    },
  },

  // The import-x rule above resolves entry points, so a deep path into another
  // package's source ('../../validation/src/index') slips past it — verified.
  // Re-entering a 'src' directory after traversing up is cross-package by
  // construction, but ONLY for a file that is itself inside src: from there you never
  // climb back into your own. A sibling of src — apps/api/test — legitimately does,
  // and the rule flagged it as a cross-package import until this was scoped (T-006).
  {
    files: ['**/src/**/*.{ts,tsx,js,jsx}'],
    rules: {
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

  // NestJS dependency injection reads constructor parameter types at runtime from
  // `design:paramtypes`, which `emitDecoratorMetadata` writes at compile time. A
  // type-only import erases the value, so the metadata degrades to `[Function]`:
  //
  //   import { Dep } from './dep'       -> design:paramtypes [dep_1.Dep]
  //   import type { Dep } from './dep'  -> design:paramtypes [Function]
  //
  // Two consequences, both silent. DI can no longer resolve the provider, and a
  // `@Body() dto: SomeDto` parameter loses its class metatype, so ValidationPipe
  // skips the DTO entirely -- taking `whitelist` and `forbidNonWhitelisted` mass
  // assignment protection (main.ts) with it. Unit tests do not catch either,
  // because they construct services with `new` rather than through the container.
  //
  // typescript-eslint documents this rule as incompatible with
  // emitDecoratorMetadata. apps/api is the only package that enables it, so the
  // rule stays on everywhere else. auth.boot.spec.ts is the regression test: it
  // boots the real container and asserts validation still rejects an unknown field.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
