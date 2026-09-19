import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test/db';
import { assertRuntimeRole, runtimeRoleProblems } from './runtime-role';

/**
 * The boot check, against real roles rather than stubs: each privileged shape is built inside an
 * owner transaction that is rolled back, entered with SET LOCAL ROLE, and checked.
 */
class RollbackSignal extends Error {}

describe('the runtime role check', () => {
  let app: postgres.Sql;
  let owner: postgres.Sql;

  beforeAll(() => {
    app = testPool({ max: 1 });
    owner = testPool({ max: 1, role: 'owner' });
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  /** Runs `check` as a freshly built role, then rolls everything back. */
  const asRole = async (
    build: (tx: postgres.TransactionSql, name: (label: string) => string) => Promise<string>,
  ): Promise<{ role: string; problems: string[] }> => {
    let result: { role: string; problems: string[] } | undefined;
    const suffix = randomUUID().slice(0, 8);
    const name = (label: string) => `t073_${label}_${suffix}`;
    await owner
      .begin(async (tx) => {
        const role = await build(tx, name);
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        result = await runtimeRoleProblems(tx);
        throw new RollbackSignal();
      })
      .catch((e: unknown) => {
        if (!(e instanceof RollbackSignal)) throw e;
      });
    return result!;
  };

  it('passes the runtime role: not a superuser, no BYPASSRLS, owns nothing', async () => {
    expect(await runtimeRoleProblems(app)).toEqual({ role: 'investigator_app', problems: [] });
    await expect(assertRuntimeRole(app)).resolves.toBeUndefined();
  });

  it('refuses the owner', async () => {
    const { problems } = await runtimeRoleProblems(owner);
    expect(problems[0]).toBe('is a superuser');
    await expect(assertRuntimeRole(owner)).rejects.toThrow(
      /Refusing to start: the database role "[^"]+" is a superuser.*DATABASE_URL must use the runtime role/,
    );
  });

  it('refuses a role with BYPASSRLS', async () => {
    const { problems } = await asRole(async (tx, name) => {
      await tx.unsafe(`CREATE ROLE ${name('bypass')} NOLOGIN BYPASSRLS`);
      return name('bypass');
    });
    expect(problems).toEqual(['has BYPASSRLS']);
  });

  it('refuses a role that owns a table', async () => {
    const { problems } = await asRole(async (tx, name) => {
      await tx.unsafe(`CREATE ROLE ${name('owns')} NOLOGIN`);
      await tx.unsafe(`CREATE TABLE public.${name('tbl')} (id int)`);
      await tx.unsafe(`ALTER TABLE public.${name('tbl')} OWNER TO ${name('owns')}`);
      return name('owns');
    });
    expect(problems).toEqual([
      expect.stringMatching(/^owns, or can act as the owner of, t073_tbl_/),
    ]);
  });

  it('counts the tables beyond the first five rather than listing them all', async () => {
    const { problems } = await asRole(async (tx, name) => {
      await tx.unsafe(`CREATE ROLE ${name('many')} NOLOGIN`);
      for (let i = 0; i < 7; i++) {
        await tx.unsafe(`CREATE TABLE public.${name(`t${i}`)} (id int)`);
        await tx.unsafe(`ALTER TABLE public.${name(`t${i}`)} OWNER TO ${name('many')}`);
      }
      return name('many');
    });
    expect(problems[0]).toMatch(/ and 2 more$/);
  });

  it('refuses a role that can SET ROLE into a table owner', async () => {
    const { problems } = await asRole(async (tx, name) => {
      await tx.unsafe(`CREATE ROLE ${name('owner')} NOLOGIN`);
      await tx.unsafe(`CREATE TABLE public.${name('tbl')} (id int)`);
      await tx.unsafe(`ALTER TABLE public.${name('tbl')} OWNER TO ${name('owner')}`);
      await tx.unsafe(`CREATE ROLE ${name('member')} NOLOGIN`);
      await tx.unsafe(`GRANT ${name('owner')} TO ${name('member')}`);
      return name('member');
    });
    expect(problems).toEqual([
      expect.stringMatching(/^owns, or can act as the owner of, t073_tbl_/),
    ]);
  });

  it('refuses a role that can SET ROLE into one that bypasses row-level security', async () => {
    const { problems } = await asRole(async (tx, name) => {
      await tx.unsafe(`CREATE ROLE ${name('bypass')} NOLOGIN BYPASSRLS`);
      await tx.unsafe(`CREATE ROLE ${name('member')} NOLOGIN`);
      await tx.unsafe(`GRANT ${name('bypass')} TO ${name('member')}`);
      return name('member');
    });
    expect(problems).toEqual([
      expect.stringMatching(/^can act as t073_bypass_\w+, which bypass row-level security$/),
    ]);
  });
});

/**
 * The two test pools really are the roles they claim. If `testPool()` ever fell back to the owner,
 * every isolation test after T-077 would pass for the wrong reason — so this is asserted, not assumed.
 */
describe('the test pools', () => {
  it('runs code under test as investigator_app, and fixtures as a role that is not it', async () => {
    const app = testPool({ max: 1 });
    const owner = testPool({ max: 1, role: 'owner' });
    try {
      const [a] = await app<{ u: string }[]>`SELECT current_user AS u`;
      const [o] = await owner<{ u: string }[]>`SELECT current_user AS u`;
      expect(a?.u).toBe('investigator_app');
      expect(o?.u).not.toBe('investigator_app');
    } finally {
      await app.end();
      await owner.end();
    }
  });
});
