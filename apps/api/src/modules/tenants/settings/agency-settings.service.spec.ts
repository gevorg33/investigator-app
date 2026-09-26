import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agencySettings } from '../../../../test/agency-fixtures';
import { testPool } from '../../../../test/db';
import { agencyContext, personalContext, scopedDb } from '../../../../test/workspace-context';
import { agency, member } from '../../../../test/workspace-fixtures';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { runInContext, type ExecutionContext } from '../../../common/context/execution-context';
import * as schema from '../../../database/schema';
import { auditLogs, tenantSettings } from '../../../database/schema';
import { AgencySettingsService } from './agency-settings.service';

describe('agency settings (T-084)', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let settings: AgencySettingsService;
  const req = () => ({ ip: '198.51.100.84', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    const db = scopedDb(sql);
    settings = new AgencySettingsService(
      db,
      new AuthzService(new AuditService(db)),
      new AuditService(db),
    );
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  interface Member {
    actor: Actor;
    context: ExecutionContext;
  }

  /** An agency: its owner, and one member in each role asked for. */
  const setUp = async (...roles: string[]) => {
    const people = await Promise.all([undefined, ...roles].map(() => member(ownerSql)));
    const { tenantId } = await agency(
      ownerSql,
      people.map((p, i) => ({ userId: p.actor.userId, ...(i > 0 && { role: roles[i - 1] }) })),
    );
    const members: Member[] = await Promise.all(
      people.map(async (p) => ({
        actor: p.actor,
        context: await agencyContext(ownerSql, p.actor.userId, tenantId),
      })),
    );
    return { tenantId, owner: members[0]!, others: members.slice(1) };
  };

  const as = <T>(m: Member, fn: () => Promise<T>) => runInContext(m.context, fn);
  const audited = async (correlationId: string) =>
    (await ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, correlationId)))[0];

  describe('reading', () => {
    it('gives every section, defaults where nothing was saved, at version 0', async () => {
      const a = await setUp();
      const view = await as(a.owner, () => settings.read(a.owner.actor, req()));
      expect(Object.keys(view)).toEqual([
        'general',
        'branding',
        'localisation',
        'notifications',
        'ai',
        'investigations',
        'employees',
        'security',
        'privacy',
        'integrations',
        'billing',
      ]);
      expect(view.branding).toEqual({
        version: 0,
        values: { accentColor: null, reportHeaderColor: null },
        derived: { accentText: null, reportHeaderText: null },
      });
      expect(view.security).toEqual({ version: 0, values: {}, derived: {} });
    });

    it('gives a saved section as saved, with a setting added since read as its default', async () => {
      const a = await setUp();
      await agencySettings(ownerSql, a.tenantId, { value: { accentColor: '#166534' }, version: 4 });
      const view = await as(a.owner, () => settings.read(a.owner.actor, req()));
      expect(view.branding).toEqual({
        version: 4,
        values: { accentColor: '#166534', reportHeaderColor: null },
        derived: { accentText: '#ffffff', reportHeaderText: null },
      });
    });

    it('shows each agency only its own', async () => {
      const a = await setUp();
      const b = await setUp();
      await agencySettings(ownerSql, a.tenantId, { value: { accentColor: '#166534' } });
      const seen = await as(b.owner, () => settings.read(b.owner.actor, req()));
      expect(seen.branding.version).toBe(0);
    });

    it('lets a manager read, and not a viewer', async () => {
      const a = await setUp('MANAGER', 'VIEWER');
      const [manager, viewer] = a.others as [Member, Member];
      await expect(as(manager, () => settings.read(manager.actor, req()))).resolves.toBeDefined();
      const r = req();
      await expect(as(viewer, () => settings.read(viewer.actor, r))).rejects.toMatchObject({
        status: 403,
      });
      expect(await audited(r.correlationId)).toMatchObject({ reason: 'permission_not_held' });
    });

    it('has nothing to give in a Personal workspace', async () => {
      const { actor } = await member(ownerSql);
      const r = req();
      await expect(
        runInContext(await personalContext(ownerSql, actor.userId), () => settings.read(actor, r)),
      ).rejects.toMatchObject({ status: 403 });
      expect(await audited(r.correlationId)).toMatchObject({ reason: 'workspace_kind_forbidden' });
    });
  });

  describe('changing', () => {
    it('saves a section for the first time at version 1, and audits it', async () => {
      const a = await setUp();
      const r = req();
      const saved = await as(a.owner, () =>
        settings.update(
          a.owner.actor,
          'branding',
          { version: 0, values: { accentColor: '#1D4ED8' } },
          r,
        ),
      );
      expect(saved).toEqual({
        version: 1,
        values: { accentColor: '#1d4ed8', reportHeaderColor: null },
        derived: { accentText: '#ffffff', reportHeaderText: null },
      });
      const [row] = await ownerDb
        .select()
        .from(tenantSettings)
        .where(
          and(eq(tenantSettings.tenantId, a.tenantId), eq(tenantSettings.section, 'branding')),
        );
      expect(row).toMatchObject({ version: 1, updatedBy: a.owner.actor.userId });
      expect(await audited(r.correlationId)).toMatchObject({
        action: 'agency.settings.updated',
        actorId: a.owner.actor.userId,
        reason: 'branding',
      });
    });

    it('changes only what it names, moving the version on', async () => {
      const a = await setUp('ADMIN');
      const admin = a.others[0]!;
      await agencySettings(ownerSql, a.tenantId, { value: { accentColor: '#166534' } });
      const saved = await as(admin, () =>
        settings.update(
          admin.actor,
          'branding',
          { version: 1, values: { reportHeaderColor: '#1e3a8a' } },
          req(),
        ),
      );
      expect(saved).toMatchObject({
        version: 2,
        values: { accentColor: '#166534', reportHeaderColor: '#1e3a8a' },
      });
    });

    it('refuses a change made against a version that is no longer current', async () => {
      const a = await setUp();
      await agencySettings(ownerSql, a.tenantId, { version: 3 });
      for (const version of [0, 2, 4]) {
        await expect(
          as(a.owner, () =>
            settings.update(
              a.owner.actor,
              'branding',
              { version, values: { accentColor: null } },
              req(),
            ),
          ),
        ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      }
    });

    it('lets exactly one of two first saves of a section through', async () => {
      const a = await setUp();
      const save = (colour: string) =>
        as(a.owner, () =>
          settings.update(
            a.owner.actor,
            'branding',
            { version: 0, values: { accentColor: colour } },
            req(),
          ),
        );
      const results = await Promise.allSettled([save('#166534'), save('#1d4ed8')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'STATE_CONFLICT' },
      });
    });

    it('refuses a first save that another first save reached the database ahead of', async () => {
      // The competing save has written its row and not yet committed: this one finds nothing to
      // lock, passes the version check, and then waits on the key — to find, once the other
      // commits, that it lost.
      const a = await setUp();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let written!: () => void;
      const inserted = new Promise<void>((resolve) => (written = resolve));
      const competing = ownerSql.begin(async (tx) => {
        await tx`INSERT INTO tenant_settings (tenant_id, section, value)
                 VALUES (${a.tenantId}, 'branding', '{}'::jsonb)`;
        written();
        await gate;
      });
      await inserted;
      const attempt = as(a.owner, () =>
        settings.update(a.owner.actor, 'branding', { version: 0, values: {} }, req()),
      );
      // Released only once this save is seen waiting on the competing row — a fixed pause lets
      // a loaded machine commit the competitor first, and the save then fails the version check
      // instead, which is a different refusal.
      for (let tries = 0; tries < 200; tries += 1) {
        const [waiting] = await ownerSql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND query ILIKE 'insert into "tenant_settings"%'`;
        if (waiting!.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      await competing;
      await expect(attempt).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    });

    it('refuses a colour nothing can be read on, and saves nothing', async () => {
      const a = await setUp();
      await expect(
        as(a.owner, () =>
          settings.update(
            a.owner.actor,
            'branding',
            { version: 0, values: { accentColor: '#fde68a' } },
            req(),
          ),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'values.accentColor', code: 'LOW_CONTRAST_SURFACE' }],
      });
      const rows = await ownerDb
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, a.tenantId));
      expect(rows).toEqual([]);
    });

    it('refuses a setting a section does not have', async () => {
      const a = await setUp();
      await expect(
        as(a.owner, () =>
          settings.update(a.owner.actor, 'ai', { version: 0, values: { enabled: false } }, req()),
        ),
      ).rejects.toMatchObject({ details: [{ field: 'values.enabled', code: 'UNKNOWN' }] });
    });

    it('lets a manager read settings but not change them', async () => {
      const a = await setUp('MANAGER');
      const manager = a.others[0]!;
      const r = req();
      await expect(
        as(manager, () =>
          settings.update(manager.actor, 'branding', { version: 0, values: {} }, r),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(await audited(r.correlationId)).toMatchObject({
        action: 'authz.denied.agency.settings.update',
        reason: 'permission_not_held',
      });
    });
  });
});
