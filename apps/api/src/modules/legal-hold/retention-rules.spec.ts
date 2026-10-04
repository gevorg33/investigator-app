import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { RETENTION_RULE_NAMES, RETENTION_RULES } from './retention-rules';

/**
 * A rule's period is set once, in `retention-rules.ts`, and stated in the register
 * (`docs/compliance/retention.md`) — and the two cannot drift (T-204). A period changed in either
 * fails here until the other says the same; rule 4 of the register asks for a recorded decision
 * before a period is shortened, so the diff that changes both is where that decision shows.
 */
const REGISTER = readFileSync(
  join(__dirname, '..', '..', '..', '..', '..', 'docs', 'compliance', 'retention.md'),
  'utf8',
);

/** The register's row for a table: its retention cell. */
const retentionCell = (table: string): string | undefined =>
  REGISTER.split('\n')
    .find((line) => line.startsWith(`| \`${table}\` |`))
    ?.split('|')[2];

describe('the retention rules (T-204)', () => {
  it('found the register', () => {
    expect(retentionCell('audit_logs')).toContain('7 years');
  });

  it.each(RETENTION_RULE_NAMES)('%s runs at the period the register states', (rule) => {
    const def = RETENTION_RULES[rule];
    const table = getTableConfig(def.table).name;
    expect(rule).toBe(`retention.${table}`);
    const days = def.periodDays;
    expect(retentionCell(table)).toContain(`**${days} ${days === 1 ? 'day' : 'days'}**`);
  });

  it.each(RETENTION_RULE_NAMES)(
    '%s runs at least daily, and says which resources hold it',
    (rule) => {
      const def = RETENTION_RULES[rule];
      expect(def.everyMs).toBeGreaterThan(0);
      expect(def.everyMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
      expect(def.heldBy.length).toBeGreaterThan(0);
    },
  );
});
