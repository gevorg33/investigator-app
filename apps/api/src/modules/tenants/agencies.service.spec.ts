import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';

import { personalContext, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { runInContext } from '../../common/context/execution-context';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import * as schema from '../../database/schema';
import {
  auditLogs,
  legalDocuments,
  membershipRoles,
  roles,
  tenantMemberships,
  tenants,
  userConsents,
} from '../../database/schema';
import { LegalService } from '../legal/legal.service';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceResolver } from '../../common/context/workspace.resolver';
import { AgenciesService } from './agencies.service';
import type { CreateAgencyDto } from './agencies.dto';

/**
 * Creating an agency (T-083): the workspace, its owner and the terms they accepted, together or
 * not at all.
 */
describe('agency registration', () => {
  let app: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let agencies: AgenciesService;
  let workspaces: WorkspacesService;
  let agreementId: string;

  const req = () => ({ ip: '198.51.100.12', userAgent: 'vitest', correlationId: randomUUID() });

  /**
   * A complete agency, with overrides. An override of `undefined` means "the client left this
   * out", so the key is removed rather than sent as undefined — which is what a request that
   * omits the field actually looks like.
   */
  const complete = (
    over: { [K in keyof CreateAgencyDto]?: CreateAgencyDto[K] | undefined } = {},
  ): CreateAgencyDto => {
    const dto: Record<string, unknown> = {
      name: `Agency ${randomUUID().slice(0, 8)}`,
      countryCode: 'AM',
      businessEmail: `hello-${randomUUID()}@agency.test`,
      timezone: 'Asia/Yerevan',
      currency: 'AMD',
      agreementDocumentId: agreementId,
      ...over,
    };
    for (const key of Object.keys(dto)) if (dto[key] === undefined) delete dto[key];
    return dto as unknown as CreateAgencyDto;
  };

  beforeAll(() => {
    app = testPool({ max: 3 });
    ownerSql = testPool({ max: 3, role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    const db = scopedDb(app);
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    const legal = new LegalService(db, audit);
    agencies = new AgenciesService(db, authz, audit, new IdempotencyService(), legal);
    workspaces = new WorkspacesService(db, authz, audit, new WorkspaceResolver(db, authz));
  });

  afterAll(async () => {
    await app.end();
    await ownerSql.end();
  });

  afterEach(async () => {
    await clear();
  });

  const clear = async () => {
    await ownerSql`
      DELETE FROM user_consents WHERE legal_document_id IN
        (SELECT id FROM legal_documents WHERE type = 'AGENCY_AGREEMENT')`;
    await ownerSql`DELETE FROM legal_documents WHERE type = 'AGENCY_AGREEMENT'`;
  };

  /** The agency terms in force. Published by the compliance owner in reality (ACTIONS #20). */
  beforeEach(async () => {
    await clear();
    const [document] = await ownerDb
      .insert(legalDocuments)
      .values({
        type: 'AGENCY_AGREEMENT',
        version: 1,
        locale: 'en',
        title: 'Agency agreement',
        content: `Draft agency terms ${randomUUID()}`,
        contentHash: 'computed-by-the-database',
        status: 'CURRENT',
        isAuthoritativeLocale: true,
        publishedAt: new Date(),
        effectiveFrom: new Date(),
      })
      .returning();
    agreementId = document!.id;
  });

  /** A signed-in person, acting in their own Personal workspace as a request would. */
  const person = async (): Promise<{
    actor: Actor;
    inWorkspace: <T>(fn: () => Promise<T>) => Promise<T>;
  }> => {
    const { actor } = await member(ownerSql);
    const context = await personalContext(ownerSql, actor.userId);
    return { actor, inWorkspace: (fn) => runInContext(context, fn) };
  };

  const agencyRow = (id: string) =>
    ownerDb
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .then((rows) => rows[0]);

  describe('what it creates', () => {
    it('makes an ACTIVE agency when the minimum is complete, with the creator as OWNER', async () => {
      const { actor, inWorkspace } = await person();
      const created = await inWorkspace(() =>
        agencies.create(actor, complete({ name: 'Northlight' }), randomUUID(), req()),
      );

      expect(created).toMatchObject({
        name: 'Northlight',
        status: 'ACTIVE',
        countryCode: 'AM',
        currency: 'AMD',
        missing: [],
      });

      const row = await agencyRow(created.id);
      expect(row).toMatchObject({ kind: 'AGENCY', status: 'ACTIVE', createdBy: actor.userId });

      const [membership] = await ownerDb
        .select()
        .from(tenantMemberships)
        .where(eq(tenantMemberships.tenantId, created.id));
      expect(membership).toMatchObject({ userId: actor.userId, status: 'ACTIVE' });

      const held = await ownerDb
        .select({ key: roles.key })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(eq(membershipRoles.membershipId, membership!.id));
      expect(held.map((r) => r.key)).toEqual(['OWNER']);
    });

    it('leaves it CREATING when something is missing, and says what', async () => {
      const { actor, inWorkspace } = await person();
      const created = await inWorkspace(() =>
        agencies.create(
          actor,
          complete({ countryCode: undefined, businessEmail: undefined, currency: undefined }),
          randomUUID(),
          req(),
        ),
      );
      expect(created).toMatchObject({
        status: 'CREATING',
        countryCode: null,
        businessEmail: null,
        missing: ['countryCode', 'businessEmail', 'currency'],
      });
      expect((await agencyRow(created.id))?.status).toBe('CREATING');
    });

    it('takes the time zone from the creator when they do not give one', async () => {
      const { actor } = await member(ownerSql);
      await ownerSql`UPDATE users SET timezone = 'Europe/Berlin' WHERE id = ${actor.userId}`;
      const context = await personalContext(ownerSql, actor.userId);
      const created = await runInContext(context, () =>
        agencies.create(actor, complete({ timezone: undefined }), randomUUID(), req()),
      );
      expect(created.timezone).toBe('Europe/Berlin');
    });

    it('records the terms the creator accepted, in the same transaction', async () => {
      const { actor, inWorkspace } = await person();
      const created = await inWorkspace(() =>
        agencies.create(actor, complete(), randomUUID(), req()),
      );

      const [consent] = await ownerDb
        .select()
        .from(userConsents)
        .where(eq(userConsents.userId, actor.userId));
      expect(consent).toMatchObject({
        legalDocumentId: agreementId,
        documentType: 'AGENCY_AGREEMENT',
        action: 'ACCEPTED',
        context: 'AGENCY_CREATION',
      });
      expect(created.id).toBeTruthy();
    });

    it('audits the creation', async () => {
      const { actor, inWorkspace } = await person();
      const r = req();
      const created = await inWorkspace(() => agencies.create(actor, complete(), randomUUID(), r));
      // Two entries share the correlation id — the consent acceptance and this one — which is
      // the point of them being separate facts.
      const [entry] = await ownerDb
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.correlationId, r.correlationId), eq(auditLogs.action, 'agency.created')),
        );
      expect(entry).toMatchObject({
        actorId: actor.userId,
        action: 'agency.created',
        resourceType: 'tenant',
        resourceId: created.id,
      });
    });

    it('appears in the creator’s workspace list at once', async () => {
      const { actor, inWorkspace } = await person();
      const created = await inWorkspace(() =>
        agencies.create(actor, complete({ name: 'Visible' }), randomUUID(), req()),
      );
      const listed = await inWorkspace(() => workspaces.list(actor, req()));
      expect(listed.find((w) => w.id === created.id)).toMatchObject({
        kind: 'AGENCY',
        name: 'Visible',
        roles: ['OWNER'],
      });
    });
  });

  describe('the terms are the gate', () => {
    it('refuses when nothing is published, rather than creating an agency that agreed to nothing', async () => {
      await ownerSql`DELETE FROM legal_documents WHERE type = 'AGENCY_AGREEMENT'`;
      const { actor, inWorkspace } = await person();
      await expect(
        inWorkspace(() => agencies.create(actor, complete(), randomUUID(), req())),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await ownerDb.select().from(tenants).where(eq(tenants.createdBy, actor.userId)),
      ).toEqual([]);
    });

    it('refuses a version that is not the one in force', async () => {
      const { actor, inWorkspace } = await person();
      await expect(
        inWorkspace(() =>
          agencies.create(
            actor,
            complete({ agreementDocumentId: randomUUID() }),
            randomUUID(),
            req(),
          ),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('writes nothing at all when the terms step fails', async () => {
      const { actor, inWorkspace } = await person();
      const name = `Rolled back ${randomUUID().slice(0, 8)}`;
      await expect(
        inWorkspace(() =>
          agencies.create(
            actor,
            complete({ name, agreementDocumentId: randomUUID() }),
            randomUUID(),
            req(),
          ),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await ownerDb.select().from(tenants).where(eq(tenants.name, name))).toEqual([]);
    });
  });

  describe('retrying', () => {
    it('returns the first agency rather than making a second', async () => {
      const { actor, inWorkspace } = await person();
      const key = randomUUID();
      const dto = complete({ name: 'Only once' });
      const first = await inWorkspace(() => agencies.create(actor, dto, key, req()));
      const second = await inWorkspace(() => agencies.create(actor, dto, key, req()));

      expect(second).toEqual(first);
      const all = await ownerDb.select().from(tenants).where(eq(tenants.createdBy, actor.userId));
      expect(all).toHaveLength(1);
    });
  });

  describe('what the client cannot decide', () => {
    it('ignores a status, a kind or a verification state sent in the body', async () => {
      // There is no field for them on the DTO; this is what a hostile client posting anyway gets.
      const { actor, inWorkspace } = await person();
      const created = await inWorkspace(() =>
        agencies.create(
          actor,
          {
            ...complete({ countryCode: undefined }),
            status: 'ACTIVE',
            kind: 'PERSONAL',
            verificationStatus: 'VERIFIED',
          } as CreateAgencyDto,
          randomUUID(),
          req(),
        ),
      );
      expect(created.status).toBe('CREATING');
      expect((await agencyRow(created.id))?.kind).toBe('AGENCY');
    });

    it('cannot create an agency owned by somebody else', async () => {
      // The row's `created_by` is the caller's, so the policy has nothing to argue with: a
      // request naming another person is simply not expressible.
      const { actor, inWorkspace } = await person();
      const other = await member(ownerSql);
      const created = await inWorkspace(() =>
        agencies.create(actor, complete(), randomUUID(), req()),
      );
      expect((await agencyRow(created.id))?.createdBy).toBe(actor.userId);
      expect((await agencyRow(created.id))?.createdBy).not.toBe(other.actor.userId);
    });

    it('refuses a suspended account', async () => {
      const { actor } = await member(ownerSql);
      const context = await personalContext(ownerSql, actor.userId);
      await expect(
        runInContext(context, () =>
          agencies.create({ ...actor, status: 'SUSPENDED' }, complete(), randomUUID(), req()),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});
