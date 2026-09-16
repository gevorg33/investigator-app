import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { missions, missionScreenings, missionStatusHistory } from './missions';
import { outboxEvents } from './outbox';
import { taxonomyNodes } from './taxonomy';
import { users } from './users';

const fks = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((f) => ({
    column: f.reference().columns[0]?.name,
    target: f.reference().foreignTable,
    onDelete: f.onDelete,
  }));

/**
 * The delete behaviour of a mission's keys is a retention property as much as a relational
 * one (docs/compliance/retention.md): nothing here may disappear as a side effect of deleting
 * something else.
 */
describe('what a mission is attached to', () => {
  it('keeps a mission when its customer’s account is deleted', () => {
    // restrict, not cascade. A mission carries history, and later quotes and money; removing
    // one goes through the retention workflow, never through an account deletion.
    expect(fks(missions)).toContainEqual({
      column: 'customer_id',
      target: users,
      onDelete: 'restrict',
    });
  });

  it('keeps a mission when its category is deprecated', () => {
    // Taxonomy nodes are deprecated, never deleted (ADR-0007). A mission filed under one two
    // years ago must stay valid.
    expect(fks(missions)).toContainEqual({
      column: 'taxonomy_node_id',
      target: taxonomyNodes,
      onDelete: 'restrict',
    });
  });

  it.each([
    ['mission_status_history', missionStatusHistory],
    ['mission_screenings', missionScreenings],
  ] as const)('holds %s against the mission being removed', (_name, table) => {
    // Append-only records of what happened. A cascade here would let deleting a mission erase
    // the evidence that it was screened and moved.
    expect(fks(table)).toContainEqual({
      column: 'mission_id',
      target: missions,
      onDelete: 'restrict',
    });
  });

  it('gives outbox events no foreign key at all', () => {
    // An event is a fact about something that happened, and it must outlive the row it
    // describes — the same reason audit_logs holds no key to users.
    expect(fks(outboxEvents)).toEqual([]);
  });
});

describe('the mission table’s own defaults', () => {
  const columns = Object.fromEntries(getTableConfig(missions).columns.map((c) => [c.name, c]));

  it('starts every mission as a private draft', () => {
    // Nothing chooses a starting status. A mission that began anywhere else would have skipped
    // the state machine entirely.
    expect(columns['status']?.default).toBe('DRAFT');
    expect(columns['status']?.notNull).toBe(true);
  });

  it('starts the version at 1, so the first optimistic write has something to match', () => {
    expect(columns['version']?.default).toBe(1);
  });

  it('leaves every content field nullable, so a draft can be saved incomplete', () => {
    for (const name of ['taxonomy_node_id', 'title', 'description', 'country_code', 'purpose']) {
      expect(columns[name]?.notNull, name).toBe(false);
    }
  });

  it('records the lawful-purpose confirmation as a time, not a flag', () => {
    // When it was confirmed is what a review needs; a boolean cannot say that.
    expect(columns['lawful_purpose_confirmed_at']?.notNull).toBe(false);
    expect(columns['lawful_purpose_confirmed_at']?.getSQLType()).toContain('timestamp');
  });
});
