import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // test/ holds helpers that import vitest and so must not be compiled into dist;
    // their own specs live alongside them. coverage.include stays src-only, so nothing
    // under test/ is counted as source.
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      // `all` is what makes the gate honest: without it a source file with no spec is
      // simply absent from the report rather than counted as 0%. Turning it on is what
      // revealed that the gate had never actually run (see T-063).
      all: true,
      include: ['src/**/*.ts'],
      // Specs and type-only declarations are the measuring instrument, not the subject.
      // Anything beyond these two belongs in the exclusions register
      // (docs/operations/coverage-exclusions.md), which an agent may not add to.
      exclude: ['src/**/*.spec.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
