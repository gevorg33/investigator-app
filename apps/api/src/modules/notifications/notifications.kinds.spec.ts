import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assignmentPlan, CATEGORY_OF, hrefFor, missionPlan, NOTIFICATION_KINDS } from './kinds';
import { readUnsubscribeToken, unsubscribeToken } from './unsubscribe';

/** What each status change tells whom (T-036) — and what it tells nobody. */
describe('what a status change means', () => {
  it.each([
    [{ from: 'UNDER_REVIEW', to: 'QUOTED' }, [{ kind: 'mission_published', to: 'customer' }]],
    [{ from: 'UNDER_REVIEW', to: 'DRAFT' }, [{ kind: 'mission_returned', to: 'customer' }]],
    [{ from: 'UNDER_REVIEW', to: 'REJECTED' }, [{ kind: 'mission_rejected', to: 'customer' }]],
    [{ from: 'PAID', to: 'ASSIGNED' }, [{ kind: 'assignment_new', to: 'investigator' }]],
    // The customer's own moves: nobody else to tell, and they know.
    [{ from: 'DRAFT', to: 'SUBMITTED' }, []],
    [{ from: 'SUBMITTED', to: 'UNDER_REVIEW' }, []],
    [{ from: 'DRAFT', to: 'CANCELLED' }, []],
  ])('a mission %j', (change, plans) => {
    expect(missionPlan(change)).toEqual(plans);
  });

  it.each([
    [
      { from: 'PENDING_ACCEPTANCE', to: 'ACCEPTED' },
      [{ kind: 'assignment_accepted', to: 'customer' }],
    ],
    [
      { from: 'PENDING_ACCEPTANCE', to: 'CANCELLED', actorKind: 'INVESTIGATOR' },
      [{ kind: 'assignment_declined', to: 'customer' }],
    ],
    [
      { from: 'IN_PROGRESS', to: 'REPORT_SUBMITTED' },
      [{ kind: 'assignment_report_ready', to: 'customer' }],
    ],
    // Withdrawn by the customer, or the window closing: not a decline.
    [{ from: 'PENDING_ACCEPTANCE', to: 'CANCELLED', actorKind: 'CUSTOMER' }, []],
    [{ from: 'PENDING_ACCEPTANCE', to: 'CANCELLED', actorKind: 'SYSTEM' }, []],
    [{ from: 'PENDING_ACCEPTANCE', to: 'CANCELLED' }, []],
    [{ from: 'ACCEPTED', to: 'IN_PROGRESS' }, []],
  ])('an assignment %j', (change, plans) => {
    expect(assignmentPlan(change)).toEqual(plans);
  });

  it('leads a customer to the mission, and an investigator to Missions until assignments have a screen', () => {
    expect(hrefFor('customer', 'm-1')).toBe('/missions/m-1');
    expect(hrefFor('investigator', 'm-1')).toBe('/missions');
  });

  it('files every kind under a category a person can stop', () => {
    expect(NOTIFICATION_KINDS.map((k) => CATEGORY_OF[k])).toEqual(
      NOTIFICATION_KINDS.map(() => 'activity'),
    );
  });
});

describe('an unsubscribe token', () => {
  const secret = 's'.repeat(32);
  const target = {
    userId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    membershipId: '33333333-3333-4333-8333-333333333333',
    category: 'activity' as const,
  };

  it('names exactly its person, workspace, membership and category, and verifies', () => {
    expect(readUnsubscribeToken(unsubscribeToken(target, secret), secret)).toEqual(target);
  });

  it.each([
    ['another key', (t: string) => t, 'x'.repeat(32)],
    ['a changed body', (t: string) => `a${t}`, secret],
    ['a changed signature', (t: string) => `${t.slice(0, -2)}xx`, secret],
    ['no signature', (t: string) => t.split('.')[0]!, secret],
    ['an extra part', (t: string) => `${t}.more`, secret],
    ['something too long to be one', (t: string) => t.padEnd(600, 'a'), secret],
  ])('is refused with %s', (_label, change, key) => {
    expect(readUnsubscribeToken(change(unsubscribeToken(target, secret)), key)).toBeNull();
  });

  it.each([
    ['not a string', 42],
    ['a body that is not JSON', 'bm90IGpzb24'],
    ['three parts', ['a', 'b', 'c']],
    ['an id that is not one', ['user', target.tenantId, target.membershipId, 'activity']],
    ['another category', [target.userId, target.tenantId, target.membershipId, 'marketing']],
  ])('is refused when signed but %s', (_label, parts) => {
    const body =
      typeof parts === 'string' ? parts : Buffer.from(JSON.stringify(parts)).toString('base64url');
    const key = createHmac('sha256', secret).update('notifications.unsubscribe.v1').digest();
    const token =
      typeof parts === 'number'
        ? parts
        : `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
    expect(readUnsubscribeToken(token, secret)).toBeNull();
  });
});
