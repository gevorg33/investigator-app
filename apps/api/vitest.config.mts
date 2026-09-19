import MagicString from 'magic-string';
import { defineConfig } from 'vitest/config';
import { MAX_WORKERS } from './test/db-budget';

/**
 * The one registered coverage exclusion — docs/operations/coverage-exclusions.md, approved
 * by the maintainer (ACTIONS-FOR-ME #12, option 1).
 *
 * With `emitDecoratorMetadata`, oxc records each constructor and method parameter type as
 *
 *     _decorateMetadata("design:paramtypes", [typeof TokenService === "undefined" ? Object : TokenService])
 *
 * The `Object` side runs only if the imported class is still undefined when the decorator
 * is evaluated — a circular import. No test can reach it without breaking the module graph
 * it exists to survive, so every decorated class with a typed parameter carries one
 * permanently uncovered branch. That makes a 100% branch threshold unreachable by
 * construction, not by neglect.
 *
 * Vitest already excludes the equivalent for SWC (its provider ignores `_ts_decorate`
 * statements outright). That rule does not match oxc's `_decorate`, so this does the same
 * job for oxc — more narrowly. Vitest's rule ignores the whole decorate statement, which
 * includes decorator ARGUMENTS, and those are user code. This marks only the guard
 * expression itself, and only when both sides name the same identifier: the exact shape the
 * compiler emits and nothing a person would write.
 *
 * Fails safe. If oxc changes this output the pattern matches nothing, the branches reappear,
 * and the 100% gate goes red — it cannot start silently excluding something else.
 *
 * Test-only: production builds use `tsc`, and this config is never loaded by them.
 */
const METADATA_GUARD = /typeof ([\w$.]+) === "undefined" \? Object : ([\w$.]+)/g;
const DECORATE_METADATA_HELPER = '@oxc-project/runtime/helpers/decorateMetadata';

function excludeDecoratorMetadataGuards() {
  return {
    name: 'coverage:exclude-decorator-metadata-guards',
    enforce: 'post' as const,
    transform(code: string, id: string) {
      // Only compiled application source that actually emitted decorator metadata.
      if (!id.includes('/src/') || !code.includes(DECORATE_METADATA_HELPER)) return null;

      const s = new MagicString(code);
      let marked = 0;
      for (const m of code.matchAll(METADATA_GUARD)) {
        // `typeof A === "undefined" ? Object : B` with A !== B is not the compiler's shape.
        if (m[1] !== m[2] || m.index === undefined) continue;
        s.appendLeft(m.index, '/* v8 ignore next */ ');
        marked++;
      }
      if (marked === 0) return null;

      // A real source map, not `map: null`: the hint shifts columns on the line, and
      // coverage positions are column-sensitive — a stale map would misattribute the
      // decorator arguments that share the line.
      return {
        code: s.toString(),
        map: s.generateMap({ hires: 'boundary', source: id, includeContent: true }),
      };
    },
  };
}

export default defineConfig({
  plugins: [excludeDecoratorMetadataGuards()],
  test: {
    environment: 'node',
    // test/ holds helpers that import vitest and so must not be compiled into dist;
    // their own specs live alongside them. coverage.include stays src-only, so nothing
    // under test/ is counted as source.
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Keep-alive off for test HTTP clients — see the file (T-069).
    setupFiles: ['./test/setup-http.ts'],
    globals: false,
    // Vitest's default is 5s, which is not a statement about behaviour — it is a cap that a
    // database-backed test can exceed purely because 60-odd spec files are running against one
    // PostgreSQL at once. It produced intermittent failures in tests that pass every time in
    // isolation, including `app.module.spec.ts`, which asserts nothing about timing. Raised so
    // a slow machine reports what a test found rather than how loaded the box was; a test that
    // genuinely hangs still fails, just later.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Fixed, not derived from the machine (T-069). The default is the number of CPUs: 10 on a
    // developer's laptop, 4 on CI's runner. That meant CI ran a different concurrency than
    // anyone could reproduce locally, and the worst-case connection count scaled with the
    // laptop. MAX_WORKERS × PER_FILE_BUDGET must fit in PostgreSQL's max_connections, which
    // `test/connection-budget.spec.ts` checks against the live server.
    maxWorkers: MAX_WORKERS,
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
