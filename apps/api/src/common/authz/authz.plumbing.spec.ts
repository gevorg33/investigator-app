import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { users } from '../../database/schema';
import { testActor } from '../../../test/authz-cases';
import { ActorScopedRepository } from './actor-scoped.repository';
import { CONTEXT_KEY } from '../context/request-context-key';
import { testContext } from '../../../test/context';
import { ActorGuard } from './actor.guard';
import { ACTOR_KEY, actorFromRequest } from './actor.decorator';
import type { Actor } from './contract';
import { testPool } from '../../../test/db';


type UserRow = typeof users.$inferSelect;

/** A repository that scopes to the actor, for comparison with the one below. */
class ScopedUsers extends ActorScopedRepository<UserRow> {
  constructor(db: schema.Db) {
    super(db as never, users);
  }
  protected scopeFor(actor: Actor): SQL | undefined {
    return and(eq(users.id, actor.userId), isNull(users.deletedAt));
  }
}

/**
 * A repository that deliberately returns no predicate.
 *
 * `undefined` means "no restriction", which is a decision to expose every row. It is only
 * ever right for a staff scope that genuinely spans the table — covered here so the
 * branch is exercised rather than assumed.
 */
class UnscopedUsers extends ActorScopedRepository<UserRow> {
  constructor(db: schema.Db) {
    super(db as never, users);
  }
  protected scopeFor(): SQL | undefined {
    return undefined;
  }
}

describe('an unscoped repository exposes everything, by design', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    sql = testPool({ max: 2 });
    db = drizzle(sql, { schema });
  });
  afterAll(async () => {
    await sql.end();
  });

  const seedUser = async (): Promise<string> => {
    const [row] = await db
      .insert(users)
      .values({ email: `plumb-${randomUUID()}@example.test` })
      .returning();
    return row?.id ?? '';
  };

  it('scoped: another actor cannot read the row', async () => {
    const repo = new ScopedUsers(db as never);
    const mine = await seedUser();
    const theirs = await seedUser();
    await expect(
      repo.findOneForActor(testActor({ userId: theirs }), mine),
    ).resolves.toBeUndefined();
  });

  it('unscoped: the same read returns the row', async () => {
    // The difference between the two classes is one method. That is the whole safety
    // margin, which is why `scopeFor` returning undefined deserves a comment where it
    // happens.
    const repo = new UnscopedUsers(db as never);
    const mine = await seedUser();
    const theirs = await seedUser();
    await expect(repo.findOneForActor(testActor({ userId: theirs }), mine)).resolves.toMatchObject(
      { id: mine },
    );
  });

  it('unscoped listing returns more than the actor’s own rows', async () => {
    await seedUser();
    const repo = new UnscopedUsers(db as never);
    const rows = await repo.findAllForActor(testActor({ userId: await seedUser() }));
    expect(rows.length).toBeGreaterThan(1);
  });

  it('scoped listing returns only the actor’s own', async () => {
    const repo = new ScopedUsers(db as never);
    const mine = await seedUser();
    await seedUser();
    const rows = await repo.findAllForActor(testActor({ userId: mine }));
    expect(rows.map((r) => r.id)).toEqual([mine]);
  });
});

describe('the CurrentActor decorator', () => {
  it('returns the actor the guard attached', () => {
    const actor = testActor({ userId: 'u1' });
    expect(actorFromRequest({ [ACTOR_KEY]: actor } as never)).toBe(actor);
  });

  it('refuses to run on a route with no guard, rather than handing back undefined', () => {
    // Otherwise deleting one decorator would leave the endpoint answering 200 to anyone.
    expect(() => actorFromRequest({} as never)).toThrow(/without ActorGuard/);
  });
});

describe('the guard', () => {
  const contextFor = (req: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;
  const resolved = testContext({ userId: 'u1' });
  const workspaces = () => ({ resolve: vi.fn().mockResolvedValue(resolved) });

  it('resolves the workspace from X-Workspace, and leaves it where the interceptor looks', async () => {
    // T-075, check 0. The header only chooses; the resolver intersects it with memberships.
    const actor = testActor({ userId: 'u1' });
    const actors = { fromRefreshToken: vi.fn().mockResolvedValue(actor) };
    const resolver = workspaces();
    const req: Record<string, unknown> = {
      cookies: { investigator_session: 'tok' },
      get: (h: string) => (h === 'x-workspace' ? 'ws-1' : undefined),
      ip: '198.51.100.9',
    };
    await new ActorGuard(actors as never, resolver as never).canActivate(contextFor(req));
    expect(resolver.resolve).toHaveBeenCalledWith(actor, 'ws-1', {
      correlationId: undefined,
      ipAddress: '198.51.100.9',
    });
    expect(req[CONTEXT_KEY]).toBe(resolved);
  });

  it('passes the cookie to actor resolution', async () => {
    const actors = { fromRefreshToken: vi.fn().mockResolvedValue(testActor({ userId: 'u1' })) };
    const req: Record<string, unknown> = { cookies: { investigator_session: 'tok' }, get: () => undefined };
    await new ActorGuard(actors as never, workspaces() as never).canActivate(contextFor(req));
    expect(actors.fromRefreshToken).toHaveBeenCalledWith('tok', undefined);
  });

  it('passes an empty token when the request carries no cookie', async () => {
    const actors = { fromRefreshToken: vi.fn().mockResolvedValue(testActor({ userId: 'u1' })) };
    const req: Record<string, unknown> = { get: () => undefined };
    await new ActorGuard(actors as never, workspaces() as never).canActivate(contextFor(req));
    // The service decides; the guard must not throw on a missing cookie.
    expect(actors.fromRefreshToken).toHaveBeenCalledWith('', undefined);
  });

  it('forwards the requested role so a workspace switch needs no new sign-in', async () => {
    const actors = { fromRefreshToken: vi.fn().mockResolvedValue(testActor({ userId: 'u1' })) };
    const req: Record<string, unknown> = {
      cookies: { investigator_session: 'tok' },
      get: (h: string) => (h === 'x-active-role' ? 'INVESTIGATOR' : undefined),
    };
    await new ActorGuard(actors as never, workspaces() as never).canActivate(contextFor(req));
    expect(actors.fromRefreshToken).toHaveBeenCalledWith('tok', 'INVESTIGATOR');
  });

  it('attaches the actor where the decorator looks for it', async () => {
    const actor = testActor({ userId: 'u1' });
    const actors = { fromRefreshToken: vi.fn().mockResolvedValue(actor) };
    const req: Record<string, unknown> = { get: () => undefined };
    await new ActorGuard(actors as never, workspaces() as never).canActivate(contextFor(req));
    expect(req[ACTOR_KEY]).toBe(actor);
  });
});
