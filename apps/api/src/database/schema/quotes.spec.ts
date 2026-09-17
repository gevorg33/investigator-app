import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { investigatorProfiles } from './profiles';
import { missions } from './missions';
import { quotes } from './quotes';

const config = getTableConfig(quotes);
const columns = Object.fromEntries(config.columns.map((c) => [c.name, c]));
const fks = config.foreignKeys.map((f) => ({
  column: f.reference().columns[0]?.name,
  target: f.reference().foreignTable,
  onDelete: f.onDelete,
}));

/**
 * What a quote is attached to, and what happens to it when those things go.
 *
 * The delete behaviour is a retention property as much as a relational one: a quote is the
 * record of what was offered, and "what is not in it was not agreed" — so it must not vanish
 * as a side effect of removing something else.
 */
describe('what a quote is attached to', () => {
  it('keeps the quote when its mission is removed', () => {
    expect(fks).toContainEqual({ column: 'mission_id', target: missions, onDelete: 'restrict' });
  });

  it('keeps the quote when the investigator’s profile is removed', () => {
    // restrict, not cascade: the offer outlives the storefront that made it, because a dispute
    // about an assignment turns on the quote it came from.
    expect(fks).toContainEqual({
      column: 'investigator_profile_id',
      target: investigatorProfiles,
      onDelete: 'restrict',
    });
  });
});

describe('the quote table’s own rules', () => {
  it('starts every offer live', () => {
    expect(columns['status']?.default).toBe('SUBMITTED');
    expect(columns['status']?.notNull).toBe(true);
  });

  it('requires everything a dispute would turn on', () => {
    // The fields the investigator article calls out by name: price, duration, scope,
    // deliverables, cancellation terms and an expiry.
    for (const name of [
      'price_minor',
      'currency',
      'estimated_duration_days',
      'scope',
      'deliverables',
      'cancellation_terms',
      'expires_at',
    ]) {
      expect(columns[name]?.notNull, name).toBe(true);
    }
  });

  it('leaves assumptions and exclusions optional', () => {
    // Recommended, not required: "writing exclusions feels pessimistic and saves you
    // repeatedly" is advice, and the platform does not refuse a quote without them.
    expect(columns['assumptions']?.notNull).toBe(false);
    expect(columns['exclusions']?.notNull).toBe(false);
  });

  it('records acceptance and withdrawal as instants, not flags', () => {
    // When it happened is what a review needs; a boolean cannot say that.
    expect(columns['accepted_at']?.notNull).toBe(false);
    expect(columns['withdrawn_at']?.notNull).toBe(false);
    expect(columns['accepted_at']?.getSQLType()).toContain('timestamp');
  });

  it('holds money as an integer in minor units', () => {
    expect(columns['price_minor']?.getSQLType()).toBe('integer');
  });
});
