import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atTime } from './time';

const SRC = join(__dirname, '../src');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );

describe('frozen time', () => {
  it('stops the clock where it was asked to', async () => {
    await atTime('2026-03-01T12:00:00.000Z', (clock) => {
      expect(clock.now().toISOString()).toBe('2026-03-01T12:00:00.000Z');
      expect(new Date().toISOString()).toBe('2026-03-01T12:00:00.000Z');
    });
  });

  it('moves forward only when told to', async () => {
    await atTime('2026-03-01T12:00:00.000Z', (clock) => {
      clock.advance(90 * 60 * 1000);
      expect(clock.now().toISOString()).toBe('2026-03-01T13:30:00.000Z');
    });
  });

  it('leaves timers alone, or every awaited socket would hang', async () => {
    await atTime('2026-03-01T12:00:00.000Z', async () => {
      // Not an assertion about time: it is the assertion that faking Date did not also fake
      // setTimeout, which would stop the connection pool and supertest rather than fail them.
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  });

  it('gives the clock back, whatever happened inside', async () => {
    const before = Date.now();
    await expect(
      atTime('1999-01-01T00:00:00.000Z', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });
});

/**
 * The convention this supports, enforced where it matters most (T-042).
 *
 * A `*.policy.ts` file is a pure decision — `isExpired`, `isWithinWindow` — and a decision that
 * reads the clock itself cannot be tested at a chosen moment, only near now. The convention is
 * an injected `now` with a default, and this is the one place it is a rule rather than a habit.
 */
describe('decision modules take the time rather than reading it', () => {
  const policies = walk(SRC)
    .filter((f) => f.endsWith('.policy.ts'))
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }));

  it('found the policy modules', () => {
    expect(policies.length).toBeGreaterThan(0);
  });

  it('read the clock only as a default parameter', () => {
    const hidden = policies.flatMap((p) =>
      [...p.source.matchAll(/(.{0,24})(?:new Date\(\)|Date\.now\(\))/g)]
        .filter((m) => !/now[^=]*=\s*$/.test(m[1] ?? ''))
        .map((m) => `${p.path}: ${m[0].trim()}`),
    );
    expect(hidden).toEqual([]);
  });
});
