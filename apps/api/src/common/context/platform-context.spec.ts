import { describe, expect, it } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { testContext } from '../../../test/context';
import { databaseSettings } from '../../database/scoped-client';
import { runInContext } from './execution-context';
import { currentPlatformAccess, PlatformContext } from './platform-context';

/**
 * Who may cross workspaces, and what the database is told when they do (T-077).
 *
 * The entry check is deliberately a second one: the services here have already asked
 * `AuthzService` and audited the refusal. This one exists so that a path that forgets to ask
 * cannot widen what the database shows.
 */
describe('platform access', () => {
  const reviewer = testActor({
    userId: 'staff-1',
    roles: ['STAFF'],
    staffScopes: ['VERIFICATION'],
  });

  it('is absent until it is entered', () => {
    expect(currentPlatformAccess()).toBeUndefined();
    expect(databaseSettings()).toBeUndefined();
  });

  it('lets a reviewer holding the scope in, and says so to the database', async () => {
    const seen = await PlatformContext.asStaff(
      reviewer,
      'VERIFICATION',
      'verification.review',
      () => Promise.resolve({ access: currentPlatformAccess(), settings: databaseSettings() }),
    );
    expect(seen.access).toEqual({
      scope: 'VERIFICATION',
      purpose: 'verification.review',
      actorId: 'staff-1',
    });
    expect(seen.settings).toMatchObject({ platformAccess: 'on', userId: '' });
    expect(currentPlatformAccess()).toBeUndefined();
  });

  it('keeps the workspace the request is in, and adds access to it', async () => {
    const context = testContext({ userId: 'staff-1' });
    const settings = await runInContext(context, () =>
      PlatformContext.asStaff(reviewer, 'VERIFICATION', 'verification.review', () =>
        Promise.resolve(databaseSettings()),
      ),
    );
    expect(settings).toEqual({
      tenantId: context.tenantId,
      userId: 'staff-1',
      membershipId: context.membershipId,
      platformAccess: 'on',
    });
  });

  it('refuses someone who is not staff', async () => {
    const customer = testActor({ userId: 'c-1', roles: ['CUSTOMER'] });
    await expect(
      PlatformContext.asStaff(customer, 'VERIFICATION', 'verification.review', () =>
        Promise.resolve('reached'),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses staff who do not hold that scope', async () => {
    const other = testActor({ userId: 'staff-2', roles: ['STAFF'], staffScopes: ['SUPPORT'] });
    await expect(
      PlatformContext.asStaff(other, 'VERIFICATION', 'verification.review', () =>
        Promise.resolve('reached'),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses staff who are working as something else right now', async () => {
    // Someone who is both staff and an investigator does not carry review access into the
    // investigator side of their account.
    const narrowed = testActor({
      userId: 'staff-3',
      roles: ['STAFF', 'INVESTIGATOR'],
      staffScopes: ['VERIFICATION'],
      activeRole: 'INVESTIGATOR',
    });
    await expect(
      PlatformContext.asStaff(narrowed, 'VERIFICATION', 'verification.review', () =>
        Promise.resolve('reached'),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('runs a system operation with no user and no workspace', async () => {
    const seen = await PlatformContext.asSystem('assignment.create_from_payment', () =>
      Promise.resolve({ access: currentPlatformAccess(), settings: databaseSettings() }),
    );
    expect(seen.access).toEqual({
      scope: 'SYSTEM',
      purpose: 'assignment.create_from_payment',
      actorId: null,
    });
    expect(seen.settings).toEqual({
      tenantId: '',
      userId: '',
      membershipId: '',
      platformAccess: 'on',
    });
  });

  it('hands out a frozen record, so nothing downstream can rewrite why it is here', async () => {
    await PlatformContext.asSystem('probe', async () => {
      const access = currentPlatformAccess()!;
      expect(Object.isFrozen(access)).toBe(true);
      expect(() => Object.assign(access, { purpose: 'something else' })).toThrow();
    });
  });
});
