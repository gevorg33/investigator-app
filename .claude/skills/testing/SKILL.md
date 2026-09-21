---
name: testing
description: What each test layer must cover in this repo — unit, integration, e2e and security — and what makes a test worth having. Use when writing tests, when a task's validation is unclear, or when reviewing test adequacy.
---

# Testing

The question for every test: **would this fail if the implementation were wrong?** A test
that passes against a broken implementation is worse than no test — it buys false
confidence and takes maintenance.

## Layers

### Unit — pure domain rules
State transitions (legal *and illegal*) · pricing, fees, rounding · permission predicates ·
policy classification · localization helpers · Zod schemas at their boundaries.

Fast, no I/O, no mocks needed because pure functions do not need them. If a "unit" test
needs three mocks, the code under test is orchestration, not a rule.

### Integration — real PostgreSQL, real Redis
Repositories and actual SQL · PostGIS distance and index use · authentication flows ·
**authorization boundaries** · quote acceptance under concurrency · payment webhook
handling including replay · Cloudinary upload authorization · evidence access and grants ·
report visibility · outbox and queue processing.

Use a real database. A mocked repository tests your mock. Most real bugs in this platform
live at the SQL and transaction boundary, which mocks cannot reach.

### End-to-end
Registration → mission submission · investigator verification · quote → paid assignment ·
assignment → report completion · dispute · role switching · deep links and notifications ·
admin moderation.

Few, high-value, stable. An e2e suite that flakes gets ignored, and an ignored suite is
worse than none.

### Security — mandatory, not optional
IDOR per endpoint · broken role checks · unauthorized evidence access · signed-URL misuse
and expiry · file upload bypass · rate limits · webhook replay · **prompt injection** ·
sensitive-data leakage in responses and logs.

## Rules

1. **Every endpoint ships with its authorization test.** Same commit. Not a follow-up
   task. The test asserts on a *different* actor — a test where the owner succeeds proves
   nothing about isolation.
2. **Test the illegal path.** For a state machine, the illegal transitions are the test.
   For authorization, the denials are the test.
3. **Never weaken a test to make it pass.** Do not relax an assertion, widen a type, add a
   skip, or increase a timeout to hide a race. Fix the code or escalate.
4. **Deterministic.** No real clock, no real network, no random without a seed, no
   inter-test order dependency. Freeze time; expiry logic needs it. `random()` in seed data
   counts: two query-plan suites seeded random coordinates, and the planner's choice — which
   was the assertion — changed with them.
5. **Name the behaviour, not the function.** `rejects quote acceptance after expiry`, not
   `test acceptQuote 3`.
6. **Concurrency where it matters.** Quote acceptance, assignment creation, payment
   confirmation and payout each need a concurrent-execution test proving exactly one
   effect.

## Fixtures

Build via factories with sensible defaults and explicit overrides — the test states only
what matters to it. Never share mutable fixture state between tests.

Never use real personal data, even anonymized-looking data, in fixtures.


## Coverage

**100% across statements, branches, functions and lines**, enforced in CI. Below threshold:
CI fails, the PR is not mergeable. Not a dashboard metric — a gate.

Reports are preserved as CI artifacts.

### Coverage is necessary, not sufficient

A 100% mandate has one well-known failure mode, and it is worth naming because it is the thing
that would make this rule harmful rather than useful:

```ts
// 100% line coverage. Proves nothing.
it('creates an assignment', async () => {
  await service.create(input);      // no assertion
});
```

Covered lines are not verified behaviour. The standing question in this skill applies
unchanged: **would this test fail if the implementation were wrong?** A test that executes a
line without asserting on its effect satisfies the tool and not the purpose.

So coverage is the floor, and these remain the actual bar:

- Every test asserts on an outcome, not merely that nothing threw
- Authorization tests assert on a **different** actor
- State-machine tests cover the **illegal** transitions
- Concurrency tests prove exactly one effect

`qa-reviewer` checks for assertion-free and mock-asserting tests specifically. A PR that hits
100% with tests that assert nothing is rejected, and hitting the number is not a defence.

### Exclusions are declared, never silent

Where 100% is genuinely inappropriate — generated code, framework bootstrap, infrastructure
glue, type-only files — the exclusion is:

1. Listed in `docs/operations/coverage-exclusions.md` with a **reason**
2. Scoped to a path, never a blanket pattern
3. Reviewed like code

**Never add an inline ignore comment without a corresponding entry.** An inline ignore with no
entry is uncovered code made invisible, which is strictly worse than uncovered code that the
report shows.

Bypassing the threshold requires a documented exception approved by a maintainer. An agent may
never lower it, never add a blanket exclusion, and never mark a suite `skip` to get green.

### Per package, not global

Thresholds are enforced **per package**. A global 100% lets a thoroughly tested package mask an
untested one, and in a monorepo that happens quickly.

## Fixtures and test utilities

Build factories with sensible defaults and explicit overrides, so a test states only what
matters to it:

```ts
const assignment = await assignmentFactory({ status: 'IN_PROGRESS' });
```

- **No shared mutable state between tests.** Each test creates what it needs.
- **No inter-test ordering dependency.** A suite must pass when run alone, in reverse, and in
  parallel — see *Isolation* below for how that is made true and how to check it.
- **Clean environment every run.** The database is provisioned and migrated from empty in CI
  (`ci-cd`); tests must not assume seeded data they did not create.
- **Never real personal data** in a fixture, including data that merely looks anonymised.
  Addresses use a domain RFC 2606 reserves — anything ending `.test`, or `example.com` — and
  phone numbers are `555-01xx`. `test/fixtures.spec.ts` enforces both across the whole suite.

Every table that holds a workspace's own data has a factory, or a written reason why the thing
that owns it is what writes it. `test/fixtures.spec.ts` reads the classification registry
(`table-classes.ts`) and fails when a new domain table has neither, so the next person who
needs one does not write their own INSERT and let the constraints drift apart.

### Isolation — one database per worker (T-042)

Each worker owns a database of its own, cloned from a migrated template, and every spec file
starts from it emptied and re-seeded with whatever the migrations put there. **The file is the
unit of isolation**: what a file sets up in `beforeAll` survives its own tests, and no file can
reach another's rows.

- `test/global-setup.ts` provisions the template and the worker databases before any worker
  starts. They are kept between runs; building them is slow, emptying them is fast.
- `test/setup-database.ts` points `DATABASE_URL` at this worker's copy — before the spec file
  and everything it imports is loaded, because a spec that boots the application reads that
  variable exactly as the application does — and empties it.
- Nothing in a spec needs to know any of this. `testPool()` lands in the right place.

What this bought, and the shape of what it replaces: T-022 needed a PostgreSQL advisory lock so
that one suite publishing legal documents did not decide another suite's registration, and
T-077, T-080 and T-083 each created a throwaway probe database. If you find yourself reaching
for either, the state you are protecting is global and the isolation is already there.

**Check the three orders before claiming them:**

```bash
pnpm --filter api test                                    # in parallel
VITEST_SEQUENCE=reverse pnpm --filter api test            # in reverse
pnpm --filter api test --sequence.shuffle --sequence.seed=7   # and any order at all
```

Running a file alone is one `vitest run <file>`. A dependency that only appears under load is
still a dependency: two of them were found this way, and both were tests passing for reasons
that had nothing to do with what they asserted.

### Time

Expiry logic takes the moment as a parameter with a default — `isExpired(expiresAt, now = new
Date())`, `isUsable(session, now = new Date())` — and its tests pass the moment they mean. That
is clearer than a global clock and it survives concurrency, so it is the first choice, and in
`*.policy.ts` it is a rule that `test/time.spec.ts` enforces.

For code that reads the clock in the middle of doing something else and has no seam to pass a
date through, `atTime` freezes it:

```ts
await atTime('2026-03-01T12:00:00Z', async (clock) => {
  for (let i = 0; i < LIMITS.loginPerAccount.max; i++) await svc.consume('loginPerAccount', 'a');
  clock.advance((LIMITS.loginPerAccount.windowSeconds + 1) * 1000);
  await expect(svc.consume('loginPerAccount', 'a')).resolves.toBeUndefined();
});
```

It fakes `Date` and nothing else. Faking timers would stop `setTimeout`, and with it the
connection pool and every HTTP client in the suite — tests would hang rather than fail.

### Databases, HTTP and timing (T-069)

These three are how this suite used to flake. Each is now enforced by a spec:

- **Open database pools only through `testPool()`** (`apps/api/test/db.ts`). The code under test runs
  on `testPool()`, which is `investigator_app`, the runtime role, so row-level security applies
  to it. Fixtures and schema-rule tests use `testPool({ role: 'owner' })`, because they write what
  the application may not (T-073). Every pool is capped
  at `TEST_POOL_MAX`, and the suite runs on a fixed `MAX_WORKERS`
  (`apps/api/test/db-budget.ts`). `connection-budget.spec.ts` fails if a spec opens its own pool,
  exceeds the per-file budget, or the worst case stops fitting in `max_connections`. A pool must
  hold at least as many connections as the transactions a test runs concurrently, plus any query
  issued outside them while they are open. Otherwise the test deadlocks on itself.
- **Start every HTTP test app with `listenOnce(app)` and stop it with `closeApp(app)`**
  (`apps/api/test/http.ts`), never with a bare `app.init()` / `app.close()`. HTTP clients run
  with keep-alive off (`test/setup-http.ts`). Together these stop a request from being answered
  by a *previous* test's app on a reused port, which is how tests failed with another app's 404.
  `http-harness.spec.ts` enforces it and reproduces the failure deterministically.
- **Timing assertions compare medians of interleaved samples, after a warm-up, and are paired
  with a structural assertion that needs no clock.** A single wall-clock ratio measures how
  busy the machine is. See `password.service.spec.ts`: the structural check caught a regression
  that the timing bound let through.

## A regression test for every fixed bug

Every bug fix ships with a test that **fails against the old code and passes against the new**.
Write it before the fix where practical — a test you have not seen fail is a test you have not
verified.

Name it for the defect, and reference the issue. This is the only reliable defence against the
same bug returning after a refactor.

## What not to test

Framework behaviour · third-party library internals · getters · a mock's configuration ·
snapshot tests of whole rendered pages (they fail on every change and get regenerated
without reading, which trains people to ignore failures).

## Definition of done

- [ ] Task acceptance criteria each map to a test
- [ ] Authorization test present, asserting on a different actor
- [ ] Illegal transitions and denials covered
- [ ] Concurrency tested where two actors can collide
- [ ] Validation commands pass, with real output reported
- [ ] No test weakened, skipped or timeout-inflated to get green
- [ ] Coverage at threshold, per package, with no undeclared exclusion
- [ ] Every test asserts on an outcome; none pass against a broken implementation
- [ ] Bug fixes carry a regression test that was seen to fail first
- [ ] The suite passes alone, in reverse and in parallel — run, not assumed
