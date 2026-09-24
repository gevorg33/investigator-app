import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import { quotableMission } from '../../../test/quote-fixtures';
import { asRequests, inWorkspaceOf, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import { auditLogs, missions, taxonomyNodeLabels, taxonomyNodes } from '../../database/schema';
import { TABLE_CLASSES } from '../../database/table-classes';
import { TaxonomyService } from './taxonomy.service';

const REASON = 'Agreed at the taxonomy review, see minutes 12';

describe('the shared taxonomy (ADR-0007, T-053)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: TaxonomyService;
  let curator: Actor;
  const req = () => ({ ip: '198.51.100.53', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    curator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['TAXONOMY'] });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(
      new TaxonomyService(db, new AuthzService(audit), new PlatformContext(audit), audit),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const slug = (stem = 'node') => `${stem}-${randomUUID().slice(0, 8)}`;

  /** A node as staff would add it: through the service, with an English label. */
  const added = (over: Partial<Parameters<TaxonomyService['createNode']>[1]> = {}) =>
    service.createNode(
      curator,
      { slug: slug(), riskBand: 'STANDARD', label: 'Due diligence', reason: REASON, ...over },
      req(),
    );

  const retire = (id: string) =>
    service.updateNode(curator, id, { status: 'DEPRECATED', reason: REASON }, req());

  const auditOf = (resourceId: string, action: string) =>
    ownerDb
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, resourceId), eq(auditLogs.action, action)));

  describe('reading the tree', () => {
    it('nests active nodes under their parents, in display order', async () => {
      const root = await added({ slug: slug('root'), label: 'Corporate' });
      const second = await added({ parentId: root.id, position: 2, label: 'Second' });
      const first = await added({ parentId: root.id, position: 1, label: 'First' });

      const found = (await service.tree()).find((n) => n.id === root.id);
      expect(found?.label).toBe('Corporate');
      expect(found?.children.map((c) => c.id)).toEqual([first.id, second.id]);
    });

    it('leaves a retired node out of every picker', async () => {
      const root = await added();
      const kept = await added({ parentId: root.id });
      const gone = await added({ parentId: root.id });
      await retire(gone.id);

      const found = (await service.tree()).find((n) => n.id === root.id);
      expect(found?.children.map((c) => c.id)).toEqual([kept.id]);
    });

    it('labels in the locale asked for, and says so when it had to fall back to English', async () => {
      const root = await added({ label: 'Corporate' });
      await service.setLabel(
        curator,
        root.id,
        'hy',
        { label: 'Կորպորատիվ', reason: REASON },
        req(),
      );

      const hy = (await service.tree('hy')).find((n) => n.id === root.id);
      expect([hy?.label, hy?.labelLocale]).toEqual(['Կորպորատիվ', 'hy']);
      const ru = (await service.tree('ru')).find((n) => n.id === root.id);
      // No Russian label yet: English, marked as English, rather than a slug or nothing.
      expect([ru?.label, ru?.labelLocale]).toEqual(['Corporate', 'en']);
    });

    it('reports no label, rather than inventing one, for a node that has none', async () => {
      // Only a migration or a fixture can make one — staff cannot add a node without an English
      // label — but the tree must still render it honestly rather than fall over.
      const [bare] = await ownerDb
        .insert(taxonomyNodes)
        .values({ slug: slug('bare') })
        .returning();
      const read = await service.node(bare!.id, 'ru');
      expect([read.label, read.labelLocale, read.labels]).toEqual([null, null, {}]);

      const inTree = (await service.tree('ru')).find((n) => n.id === bare!.id);
      expect([inTree?.label, inTree?.labelLocale]).toEqual([null, null]);

      // And staff can still re-band it, which is how an unlabelled seed row gets fixed.
      const banded = await service.updateNode(
        curator,
        bare!.id,
        { riskBand: 'ELEVATED', reason: REASON },
        req(),
      );
      expect([banded.riskBand, banded.labels]).toEqual(['ELEVATED', {}]);
    });

    it('names nodes in the locale asked for, English where not, retired ones too — and never by slug', async () => {
      const both = await added({ label: 'Due diligence' });
      await service.setLabel(curator, both.id, 'ru', { label: 'Проверка', reason: REASON }, req());
      const english = await added({ label: 'Surveillance' });
      await retire(english.id);
      const unlabelled = await added();
      await owner`DELETE FROM taxonomy_node_labels WHERE node_id = ${unlabelled.id}`;

      const names = await service.labels([both.id, english.id, unlabelled.id, both.id], 'ru');
      expect([...names]).toEqual(
        expect.arrayContaining([
          [both.id, 'Проверка'],
          [english.id, 'Surveillance'],
        ]),
      );
      expect(names.size).toBe(2);
      expect((await service.labels([both.id])).get(both.id)).toBe('Due diligence');
    });

    it('still resolves a retired node by id — rule 1: never deleted, only deprecated', async () => {
      const node = await added({ label: 'Asset tracing' });
      await retire(node.id);
      const read = await service.node(node.id);
      expect([read.status, read.label]).toEqual(['DEPRECATED', 'Asset tracing']);
    });

    it('answers 404 for a node that does not exist', async () => {
      await expect(service.node(randomUUID())).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('retired nodes stay valid where they are already used (rule 1)', () => {
    it('keeps a mission filed under a node that is later retired', async () => {
      const node = await added();
      const { missionId } = await quotableMission(ownerDb);
      await ownerDb
        .update(missions)
        .set({ taxonomyNodeId: node.id })
        .where(eq(missions.id, missionId));

      await retire(node.id);

      const [mission] = await ownerDb.select().from(missions).where(eq(missions.id, missionId));
      expect(mission?.taxonomyNodeId).toBe(node.id);
      // And the category still reads: the mission page names what it was filed under.
      expect((await service.node(node.id)).label).toBe('Due diligence');
    });
  });

  describe('staff maintain it', () => {
    it('adds a node with its English label and records who, what and why', async () => {
      const node = await added({ slug: slug('pre-acquisition'), riskBand: 'ELEVATED' });
      expect([node.status, node.riskBand, node.labels.en?.label]).toEqual([
        'ACTIVE',
        'ELEVATED',
        'Due diligence',
      ]);

      const [entry] = await auditOf(node.id, 'taxonomy.node.created');
      expect(entry?.actorId).toBe(curator.userId);
      expect(entry?.staffScope).toBe('TAXONOMY');
      expect(entry?.reason).toContain('(ELEVATED)');
      expect(entry?.reason).toContain(REASON);
    });

    it('enters PlatformContext to do it, which is itself recorded', async () => {
      const before = await ownerDb
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'platform.access'), eq(auditLogs.actorId, curator.userId)));
      await added();
      const after = await ownerDb
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'platform.access'), eq(auditLogs.actorId, curator.userId)));
      expect(after.length).toBe(before.length + 1);
      expect(after.map((a) => a.resourceId)).toContain('taxonomy.create_node');
    });

    it('re-bands a node and records the band it had', async () => {
      const node = await added({ riskBand: 'STANDARD' });
      const changed = await service.updateNode(
        curator,
        node.id,
        { riskBand: 'HIGH', reason: REASON },
        req(),
      );
      expect(changed.riskBand).toBe('HIGH');
      const [entry] = await auditOf(node.id, 'taxonomy.node.updated');
      expect(entry?.reason).toContain('riskBand STANDARD → HIGH');
    });

    it('records nothing when nothing changed', async () => {
      const node = await added({ riskBand: 'STANDARD' });
      await service.updateNode(curator, node.id, { riskBand: 'STANDARD', reason: REASON }, req());
      expect(await auditOf(node.id, 'taxonomy.node.updated')).toEqual([]);
    });

    it('retires a branch leaf first, and refuses it the other way round', async () => {
      const root = await added();
      const leaf = await added({ parentId: root.id });

      await expect(retire(root.id)).rejects.toMatchObject({
        status: 422,
        details: [expect.objectContaining({ code: 'CHILDREN_ACTIVE' })],
      });
      await retire(leaf.id);
      expect((await retire(root.id)).status).toBe('DEPRECATED');
    });

    it('will not restore a node under a retired parent', async () => {
      const root = await added();
      const leaf = await added({ parentId: root.id });
      await retire(leaf.id);
      await retire(root.id);

      await expect(
        service.updateNode(curator, leaf.id, { status: 'ACTIVE', reason: REASON }, req()),
      ).rejects.toMatchObject({
        details: [expect.objectContaining({ code: 'PARENT_DEPRECATED' })],
      });
    });

    it('restores a retired node whose parent is live, or which has none', async () => {
      const parent = await added();
      const leaf = await added({ parentId: parent.id });
      const root = await added();
      for (const node of [leaf, root]) {
        await retire(node.id);
        const back = await service.updateNode(
          curator,
          node.id,
          { status: 'ACTIVE', reason: REASON },
          req(),
        );
        expect(back.status).toBe('ACTIVE');
      }
    });

    it('refuses a parent that does not exist, or that is retired', async () => {
      await expect(added({ parentId: randomUUID() })).rejects.toMatchObject({
        details: [expect.objectContaining({ field: 'parentId', code: 'UNKNOWN' })],
      });
      const retired = await added();
      await retire(retired.id);
      await expect(added({ parentId: retired.id })).rejects.toMatchObject({
        details: [expect.objectContaining({ field: 'parentId', code: 'DEPRECATED' })],
      });
    });

    it('refuses a slug that is already taken — a slug names one node for good', async () => {
      const taken = slug('taken');
      await added({ slug: taken });
      await expect(added({ slug: taken })).rejects.toMatchObject({
        details: [expect.objectContaining({ field: 'slug', code: 'TAKEN' })],
      });
    });

    it('sets a label, then corrects it, recording what it said before', async () => {
      const node = await added();
      await service.setLabel(curator, node.id, 'ru', { label: 'Проверка', reason: REASON }, req());
      const fixed = await service.setLabel(
        curator,
        node.id,
        'ru',
        { label: 'Комплексная проверка', description: 'Перед сделкой', reason: REASON },
        req(),
      );
      expect(fixed.labels.ru).toEqual({
        label: 'Комплексная проверка',
        description: 'Перед сделкой',
      });
      expect([fixed.label, fixed.labelLocale]).toEqual(['Комплексная проверка', 'ru']);

      const entries = (await auditOf(node.id, 'taxonomy.label.set')).map((e) => e.reason);
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.stringContaining('ru: none → "Проверка"'),
          expect.stringContaining('ru: "Проверка" → "Комплексная проверка"'),
        ]),
      );
    });

    it('answers 404 for a node that is not there, whatever the edit', async () => {
      const missing = randomUUID();
      await expect(
        service.updateNode(curator, missing, { position: 1, reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.setLabel(curator, missing, 'en', { label: 'x', reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('reorders a node without touching anything else', async () => {
      const node = await added({ position: 0 });
      const moved = await service.updateNode(
        curator,
        node.id,
        { position: 7, reason: REASON },
        req(),
      );
      expect([moved.position, moved.riskBand, moved.status]).toEqual([7, 'STANDARD', 'ACTIVE']);
    });
  });

  describe('who may change it', () => {
    const create = (actor: Actor) =>
      service.createNode(
        actor,
        { slug: slug(), riskBand: 'STANDARD', label: 'x', reason: REASON },
        req(),
      );

    it('refuses a customer', async () => {
      await expect(create(await person(ownerDb, { roles: ['CUSTOMER'] }))).rejects.toMatchObject({
        status: 403,
      });
    });

    it('refuses staff holding another scope — being staff is never the check', async () => {
      const moderator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION'] });
      await expect(create(moderator)).rejects.toMatchObject({ status: 403 });

      // PlatformContext would refuse this too, but silently. The service's own check is the one
      // that says why, so a probe for the taxonomy by the wrong staff member shows in the log.
      const denials = await ownerDb
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.actorId, moderator.userId),
            eq(auditLogs.action, 'authz.denied.taxonomy.create_node'),
          ),
        );
      expect(denials.map((d) => d.reason)).toEqual(['staff_scope_not_held']);
    });

    it('refuses a suspended curator', async () => {
      const suspended = await person(ownerDb, {
        roles: ['STAFF'],
        staffScopes: ['TAXONOMY'],
        status: 'SUSPENDED',
      });
      await expect(create(suspended)).rejects.toMatchObject({ status: 403 });
    });

    it('refuses every write path, not only creation', async () => {
      const node = await added();
      const moderator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION'] });
      await expect(
        service.updateNode(moderator, node.id, { riskBand: 'STANDARD', reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.setLabel(moderator, node.id, 'en', { label: 'x', reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  /**
   * The rules hold without the service (T-053). The service checks them to give a clear answer;
   * these are the checks that stand when something else writes — a script, a console, a bug.
   */
  describe('the database holds the rules itself', () => {
    // Awaited inside the context: a drizzle query is lazy, and one handed back un-awaited runs
    // after the context has ended — with no workspace at all, so a refusal would prove nothing
    // about the policy. Found while writing T-031; this helper had that bug in T-053.
    const asApp = <T>(userId: string, fn: (db: ReturnType<typeof scopedDb>) => Promise<T>) =>
      inWorkspaceOf(owner, userId, async () => await fn(scopedDb(sql)));

    /** drizzle wraps the database's refusal; the policy's own words are on `cause`. */
    const refusedByPolicy = {
      cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
    };

    it('refuses the application a write outside PlatformContext', async () => {
      const node = await added();
      const customer = await person(ownerDb, { roles: ['CUSTOMER'] });
      await expect(
        asApp(customer.userId, (db) => db.insert(taxonomyNodes).values({ slug: slug('sneaked') })),
      ).rejects.toMatchObject(refusedByPolicy);
      // An update outside platform access matches no row at all: the policy hides it, so it
      // changes nothing rather than failing.
      const updated = await asApp(customer.userId, (db) =>
        db
          .update(taxonomyNodes)
          .set({ riskBand: 'RESTRICTED' })
          .where(eq(taxonomyNodes.id, node.id))
          .returning(),
      );
      expect(updated).toEqual([]);
      expect((await service.node(node.id)).riskBand).toBe('STANDARD');
      await expect(
        asApp(customer.userId, (db) =>
          db.insert(taxonomyNodeLabels).values({ nodeId: node.id, locale: 'ru', label: 'x' }),
        ),
      ).rejects.toMatchObject(refusedByPolicy);
    });

    it('never lets the application delete, even inside PlatformContext', async () => {
      const node = await added();
      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT set_config('app.platform_access', 'on', true)`;
          await tx`DELETE FROM taxonomy_nodes WHERE id = ${node.id}`;
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it('keeps a slug and a parent for good', async () => {
      const root = await added();
      const other = await added();
      const leaf = await added({ parentId: root.id });
      await expect(
        owner`UPDATE taxonomy_nodes SET slug = ${slug('renamed')} WHERE id = ${leaf.id}`,
      ).rejects.toThrow(/keeps its slug and parent/);
      await expect(
        owner`UPDATE taxonomy_nodes SET parent_id = ${other.id} WHERE id = ${leaf.id}`,
      ).rejects.toThrow(/keeps its slug and parent/);
    });

    it('grows nothing under a retired node', async () => {
      const root = await added();
      await retire(root.id);
      await expect(
        owner`INSERT INTO taxonomy_nodes (slug, parent_id) VALUES (${slug()}, ${root.id})`,
      ).rejects.toThrow(/takes no new children/);
    });

    it('keeps every active node under an active parent, in both directions', async () => {
      const root = await added();
      const leaf = await added({ parentId: root.id });
      await expect(
        owner`UPDATE taxonomy_nodes SET status = 'DEPRECATED' WHERE id = ${root.id}`,
      ).rejects.toThrow(/active children first/);

      await owner`UPDATE taxonomy_nodes SET status = 'DEPRECATED' WHERE id = ${leaf.id}`;
      await owner`UPDATE taxonomy_nodes SET status = 'DEPRECATED' WHERE id = ${root.id}`;
      await expect(
        owner`UPDATE taxonomy_nodes SET status = 'ACTIVE' WHERE id = ${leaf.id}`,
      ).rejects.toThrow(/under a deprecated parent/);
    });

    it('holds slugs to one shape and labels to known locales', async () => {
      await expect(
        owner`INSERT INTO taxonomy_nodes (slug) VALUES ('Due Diligence')`,
      ).rejects.toThrow(/taxonomy_nodes_slug_shape/);
      const node = await added();
      await expect(
        owner`INSERT INTO taxonomy_node_labels (node_id, locale, label) VALUES (${node.id}, 'de', 'x')`,
      ).rejects.toThrow(/taxonomy_node_labels_locale_known/);
      await expect(
        owner`INSERT INTO taxonomy_node_labels (node_id, locale, label) VALUES (${node.id}, 'ru', '   ')`,
      ).rejects.toThrow(/taxonomy_node_labels_label_length/);
    });
  });

  it('has no Service entity — a service is a deeper node (ADR-0007)', () => {
    const tables = Object.keys(TABLE_CLASSES);
    expect(tables.filter((t) => /(^|_)services?$/.test(t))).toEqual([]);
  });
});
