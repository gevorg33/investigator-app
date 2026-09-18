import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { assignments, assignmentStatusHistory } from './assignments';
import { investigatorProfiles } from './profiles';
import { missions } from './missions';
import { quotes } from './quotes';
import { users } from './users';

const fks = (table: PgTable) =>
  getTableConfig(table).foreignKeys.map((f) => ({
    column: f.reference().columns[0]?.name,
    target: f.reference().foreignTable,
    onDelete: f.onDelete,
  }));

const columns = Object.fromEntries(getTableConfig(assignments).columns.map((c) => [c.name, c]));

/**
 * An assignment is the agreement money was taken against, so nothing it depends on may be
 * removed out from under it — every key restricts, none cascades.
 */
describe('what an assignment is attached to', () => {
  it.each([
    ['mission_id', missions],
    ['quote_id', quotes],
    ['customer_id', users],
    ['investigator_profile_id', investigatorProfiles],
  ] as Array<[string, PgTable]>)(
    'keeps the assignment when %s’s row is removed',
    (column, target) => {
      expect(fks(assignments)).toContainEqual({ column, target, onDelete: 'restrict' });
    },
  );

  it('holds the history against the assignment being removed', () => {
    // Append-only evidence of what happened. A cascade here would let deleting an assignment
    // erase the record of a policy halt or a decline.
    expect(fks(assignmentStatusHistory)).toContainEqual({
      column: 'assignment_id',
      target: assignments,
      onDelete: 'restrict',
    });
  });
});

describe('the assignment table’s own rules', () => {
  it('starts every assignment waiting for the investigator', () => {
    // Created by a payment, not moved there by anyone: "until you accept, the work is not yours".
    expect(columns['status']?.default).toBe('PENDING_ACCEPTANCE');
    expect(columns['status']?.notNull).toBe(true);
  });

  it('starts the version at 1, so the first optimistic write has something to match', () => {
    expect(columns['version']?.default).toBe(1);
  });

  it('cannot exist without the payment that created it', () => {
    // An assignment exists because money was authorized. Not "should have been" — was.
    expect(columns['payment_reference']?.notNull).toBe(true);
    expect(columns['payment_authorized_at']?.notNull).toBe(true);
  });

  it('carries the agreed terms itself rather than pointing at them', () => {
    // Snapshotted from the quote: the agreement as it stood at acceptance cannot change
    // underneath a live assignment.
    for (const name of [
      'accepted_scope',
      'deliverables',
      'cancellation_terms',
      'price_minor',
      'currency',
      'estimated_duration_days',
    ]) {
      expect(columns[name]?.notNull, name).toBe(true);
    }
  });

  it('gives the investigator a deadline to accept by', () => {
    expect(columns['acceptance_due_at']?.notNull).toBe(true);
    expect(columns['accepted_at']?.notNull).toBe(false);
  });
});
