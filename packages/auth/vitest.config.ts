import { defineConfig } from 'vitest/config';

/**
 * The same gate apps/api carries, because "100% per package" is only true if every package
 * that ships running code is measured (T-042). This package is nearly all types, which
 * compile to nothing and so cost nothing to cover; `STAFF_SCOPES` is the exception, and it is
 * the part that can drift away from the union it mirrors.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
