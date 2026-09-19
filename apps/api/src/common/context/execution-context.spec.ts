import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/context';
import { currentContext, freeze, runInContext } from './execution-context';

describe('the execution context', () => {
  const ctx = testContext({ userId: 'u1' }, { permissions: ['teams.read'] });

  it('is absent outside any request or job', () => {
    expect(currentContext()).toBeUndefined();
  });

  it('is present for everything the wrapped code awaits, and gone after', async () => {
    const seen = await runInContext(ctx, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentContext()?.tenantId;
    });
    expect(seen).toBe(ctx.tenantId);
    expect(currentContext()).toBeUndefined();
  });

  it('is frozen, permission list included, so nothing downstream can edit it', () => {
    runInContext(ctx, () => {
      const c = currentContext()!;
      expect(Object.isFrozen(c)).toBe(true);
      expect(() => (c.permissions as string[]).push('billing.manage')).toThrow();
      expect(() => Object.assign(c, { tenantId: 'someone-else' })).toThrow();
    });
  });

  it('copies rather than aliases the caller’s permission list', () => {
    const permissions = ['teams.read'];
    const frozen = freeze({ ...ctx, permissions });
    permissions.push('billing.manage');
    expect(frozen.permissions).toEqual(['teams.read']);
  });

  it('keeps an inner context separate from the outer one', () => {
    const inner = testContext({ userId: 'u2' });
    runInContext(ctx, () => {
      runInContext(inner, () => expect(currentContext()?.userId).toBe('u2'));
      expect(currentContext()?.userId).toBe('u1');
    });
  });
});
