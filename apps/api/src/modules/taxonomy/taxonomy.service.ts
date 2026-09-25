import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import type { Actor } from '../../common/authz/contract';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  taxonomyNodeLabels,
  taxonomyNodes,
  TAXONOMY_LOCALES,
  type TaxonomyLocale,
} from '../../database/schema';
import type {
  CreateTaxonomyNodeDto,
  SetTaxonomyLabelDto,
  UpdateTaxonomyNodeDto,
} from './taxonomy.dto';

type NodeRow = typeof taxonomyNodes.$inferSelect;
type LabelRow = typeof taxonomyNodeLabels.$inferSelect;

/** A label as it is read: in the locale asked for where it exists, and in English where not. */
interface ResolvedLabel {
  label: string | null;
  description: string | null;
  /** Which locale the label actually came from, so a client can say "shown in English". */
  labelLocale: TaxonomyLocale | null;
}

export interface TaxonomyNodeView extends ResolvedLabel {
  id: string;
  slug: string;
  parentId: string | null;
  status: NodeRow['status'];
  riskBand: NodeRow['riskBand'];
  position: number;
  /** Every locale's label, for the staff member editing them. */
  labels: Partial<Record<TaxonomyLocale, { label: string; description: string | null }>>;
}

export interface TaxonomyTreeNode extends ResolvedLabel {
  id: string;
  slug: string;
  riskBand: NodeRow['riskBand'];
  position: number;
  children: TaxonomyTreeNode[];
}

/**
 * The shared taxonomy (ADR-0007, T-053).
 *
 * **Reading** is for everyone who is signed in: customers choosing where a mission belongs and
 * investigators declaring what they practise read the same tree. The tree holds ACTIVE nodes
 * only; a retired node is gone from every picker, and still resolves by id for every mission and
 * profile that already names it — never deleted, only deprecated (rule 1).
 *
 * **Writing** is for staff holding the TAXONOMY scope (rule 3), inside PlatformContext, because
 * the tree is platform data and row-level security admits a write to it nowhere else. Every
 * write says why. The rules that make the tree safe to change — a slug and parent are for good,
 * an ACTIVE node sits under an ACTIVE parent — are checked here to give a clear answer and held
 * by triggers so that no other writer can break them.
 */
@Injectable()
export class TaxonomyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly platform: PlatformContext,
    private readonly audit: AuditService,
  ) {}

  /** The ACTIVE tree, ordered for display, labelled in `locale`. */
  async tree(locale: TaxonomyLocale = 'en'): Promise<TaxonomyTreeNode[]> {
    const nodes = await this.db
      .select()
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.status, 'ACTIVE'));
    const labels = await this.labelsFor(
      nodes.map((n) => n.id),
      [locale, 'en'],
    );

    const byParent = new Map<string | null, NodeRow[]>();
    for (const n of nodes) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);

    // Built from the roots down, so a node whose parent is not ACTIVE is never reached — it is
    // not shown at the top level as if it were a branch of its own.
    const build = (parentId: string | null): TaxonomyTreeNode[] =>
      (byParent.get(parentId) ?? []).sort(byDisplayOrder).map((n) => ({
        id: n.id,
        slug: n.slug,
        riskBand: n.riskBand,
        position: n.position,
        ...resolve(labels.get(n.id) ?? [], locale),
        children: build(n.id),
      }));
    return build(null);
  }

  /** One node, ACTIVE or not — a mission from two years ago still has to show its category. */
  async node(id: string, locale: TaxonomyLocale = 'en'): Promise<TaxonomyNodeView> {
    const [row] = await this.db.select().from(taxonomyNodes).where(eq(taxonomyNodes.id, id));
    if (row === undefined) throw AppError.notFound();
    const labels = (await this.labelsFor([id], TAXONOMY_LOCALES)).get(id) ?? [];
    return view(row, labels, locale);
  }

  /**
   * What each node is called in `locale`, falling back to English, ACTIVE or not — a specialty an
   * investigator declared before its node was retired still has a name. A node with no label, or
   * no row, is absent from the map rather than given a slug nobody should read.
   */
  async labels(
    ids: readonly string[],
    locale: TaxonomyLocale = 'en',
  ): Promise<Map<string, string>> {
    const found = await this.labelsFor([...new Set(ids)], [locale, 'en']);
    const named = new Map<string, string>();
    for (const [id, rows] of found) named.set(id, resolve(rows, locale).label!);
    return named;
  }

  async createNode(
    actor: Actor,
    dto: CreateTaxonomyNodeDto,
    req: RequestContext,
  ): Promise<TaxonomyNodeView> {
    const c = ctx('taxonomy.create_node', req);
    await this.requireCurator(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'TAXONOMY', purpose: 'taxonomy.create_node' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          await serialise(tx);

          if (dto.parentId !== undefined) {
            const [parent] = await tx
              .select({ status: taxonomyNodes.status })
              .from(taxonomyNodes)
              .where(eq(taxonomyNodes.id, dto.parentId));
            if (parent === undefined)
              throw invalid('parentId', 'UNKNOWN', 'error.validation.taxonomy.parent_unknown');
            if (parent.status !== 'ACTIVE') {
              throw invalid(
                'parentId',
                'DEPRECATED',
                'error.validation.taxonomy.parent_deprecated',
              );
            }
          }
          const [taken] = await tx
            .select({ id: taxonomyNodes.id })
            .from(taxonomyNodes)
            .where(eq(taxonomyNodes.slug, dto.slug));
          if (taken !== undefined)
            throw invalid('slug', 'TAKEN', 'error.validation.taxonomy.slug_taken');

          const [row] = await tx
            .insert(taxonomyNodes)
            .values({
              slug: dto.slug,
              parentId: dto.parentId ?? null,
              position: dto.position ?? 0,
              riskBand: dto.riskBand,
            })
            .returning();
          const [label] = await tx
            .insert(taxonomyNodeLabels)
            .values({
              nodeId: row!.id,
              locale: 'en',
              label: dto.label.trim(),
              description: dto.description ?? null,
            })
            .returning();

          await this.record(
            actor,
            c,
            'taxonomy.node.created',
            row!.id,
            `${dto.slug} (${dto.riskBand}) under ${dto.parentId ?? 'the root'}`,
            dto.reason,
            tx,
          );
          return view(row!, [label!], 'en');
        }),
    );
  }

  async updateNode(
    actor: Actor,
    id: string,
    dto: UpdateTaxonomyNodeDto,
    req: RequestContext,
  ): Promise<TaxonomyNodeView> {
    const c = ctx('taxonomy.update_node', req, id);
    await this.requireCurator(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'TAXONOMY', purpose: 'taxonomy.update_node' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          await serialise(tx);
          const [current] = await tx.select().from(taxonomyNodes).where(eq(taxonomyNodes.id, id));
          if (current === undefined) throw AppError.notFound();

          if (dto.status === 'DEPRECATED' && current.status === 'ACTIVE') {
            const [child] = await tx
              .select({ id: taxonomyNodes.id })
              .from(taxonomyNodes)
              .where(and(eq(taxonomyNodes.parentId, id), eq(taxonomyNodes.status, 'ACTIVE')))
              .limit(1);
            if (child !== undefined)
              throw invalid(
                'status',
                'CHILDREN_ACTIVE',
                'error.validation.taxonomy.children_active',
              );
          }
          if (dto.status === 'ACTIVE' && current.status === 'DEPRECATED' && current.parentId) {
            // The foreign key guarantees the parent exists; only its status is in question.
            const [parent] = await tx
              .select({ status: taxonomyNodes.status })
              .from(taxonomyNodes)
              .where(eq(taxonomyNodes.id, current.parentId));
            if (parent!.status !== 'ACTIVE') {
              throw invalid(
                'status',
                'PARENT_DEPRECATED',
                'error.validation.taxonomy.parent_deprecated',
              );
            }
          }

          const changes = [
            change('position', current.position, dto.position),
            change('riskBand', current.riskBand, dto.riskBand),
            change('status', current.status, dto.status),
          ].filter((x): x is string => x !== null);
          const labels = (await this.labelsFor([id], TAXONOMY_LOCALES, tx)).get(id) ?? [];
          // Nothing to change is not a change: no write, and nothing in the audit trail that
          // would read as though the band had been reconsidered when it had not.
          if (changes.length === 0) return view(current, labels, 'en');

          const [row] = await tx
            .update(taxonomyNodes)
            .set({
              position: dto.position ?? current.position,
              riskBand: dto.riskBand ?? current.riskBand,
              status: dto.status ?? current.status,
              updatedAt: new Date(),
            })
            .where(eq(taxonomyNodes.id, id))
            .returning();
          await this.record(
            actor,
            c,
            'taxonomy.node.updated',
            id,
            changes.join('; '),
            dto.reason,
            tx,
          );
          return view(row!, labels, 'en');
        }),
    );
  }

  async setLabel(
    actor: Actor,
    id: string,
    locale: TaxonomyLocale,
    dto: SetTaxonomyLabelDto,
    req: RequestContext,
  ): Promise<TaxonomyNodeView> {
    const c = ctx('taxonomy.set_label', req, id);
    await this.requireCurator(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'TAXONOMY', purpose: 'taxonomy.set_label' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          await serialise(tx);
          const [node] = await tx.select().from(taxonomyNodes).where(eq(taxonomyNodes.id, id));
          if (node === undefined) throw AppError.notFound();

          const before = ((await this.labelsFor([id], [locale], tx)).get(id) ?? [])[0];
          const label = dto.label.trim();
          const description = dto.description ?? null;
          await tx
            .insert(taxonomyNodeLabels)
            .values({ nodeId: id, locale, label, description })
            .onConflictDoUpdate({
              target: [taxonomyNodeLabels.nodeId, taxonomyNodeLabels.locale],
              set: { label, description, updatedAt: new Date() },
            });
          await this.record(
            actor,
            c,
            'taxonomy.label.set',
            id,
            `${locale}: ${before === undefined ? 'none' : JSON.stringify(before.label)} → ${JSON.stringify(label)}`,
            dto.reason,
            tx,
          );
          // Never empty: the label above was just written in this transaction.
          const labels = (await this.labelsFor([id], TAXONOMY_LOCALES, tx)).get(id)!;
          return view(node, labels, locale);
        }),
    );
  }

  private async requireCurator(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'STAFF', c);
    await this.authz.requireStaffScope(actor, 'TAXONOMY', c);
  }

  private async labelsFor(
    ids: string[],
    locales: readonly TaxonomyLocale[],
    tx?: Tx,
  ): Promise<Map<string, LabelRow[]>> {
    const byNode = new Map<string, LabelRow[]>();
    // No early return for an empty list: drizzle writes `IN ()` as `false`, which is the answer.
    const rows = await (tx ?? this.db)
      .select()
      .from(taxonomyNodeLabels)
      .where(
        and(
          inArray(taxonomyNodeLabels.nodeId, ids),
          inArray(taxonomyNodeLabels.locale, [...locales]),
        ),
      );
    for (const r of rows) byNode.set(r.nodeId, [...(byNode.get(r.nodeId) ?? []), r]);
    return byNode;
  }

  /** The change and the reason, as one line: what an auditor reads first. */
  private async record(
    actor: Actor,
    c: AuthzContext,
    action: string,
    resourceId: string,
    what: string,
    why: string,
    tx: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        actorRole: 'STAFF',
        staffScope: 'TAXONOMY',
        action,
        resourceType: 'taxonomy_node',
        resourceId,
        reason: `${what} — ${why.trim()}`,
      },
      tx,
    );
  }
}

/**
 * One taxonomy write at a time. Two staff members retiring a parent and reviving its child at
 * the same moment would each pass the other's check; the tree is small and edited rarely, so
 * serialising every write costs nothing anyone will notice.
 */
const serialise = (tx: Tx) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('taxonomy'))`);

const ctx = (action: string, req: RequestContext, resourceId?: string): AuthzContext => ({
  action,
  resourceType: 'taxonomy_node',
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});

/** `messageKey` is written out at each call so the clients' catalog test can find it (T-135). */
const invalid = (field: string, code: string, messageKey: string): AppError =>
  AppError.validation([{ field, code, messageKey }]);

const change = <T>(name: string, from: T, to: T | undefined): string | null =>
  to === undefined || to === from ? null : `${name} ${String(from)} → ${String(to)}`;

const byDisplayOrder = (a: NodeRow, b: NodeRow): number =>
  a.position - b.position || a.slug.localeCompare(b.slug);

function resolve(labels: LabelRow[], locale: TaxonomyLocale): ResolvedLabel {
  const found = labels.find((l) => l.locale === locale) ?? labels.find((l) => l.locale === 'en');
  return {
    label: found?.label ?? null,
    description: found?.description ?? null,
    labelLocale: found?.locale ?? null,
  };
}

function view(row: NodeRow, labels: LabelRow[], locale: TaxonomyLocale): TaxonomyNodeView {
  return {
    id: row.id,
    slug: row.slug,
    parentId: row.parentId,
    status: row.status,
    riskBand: row.riskBand,
    position: row.position,
    ...resolve(labels, locale),
    labels: Object.fromEntries(
      labels.map((l) => [l.locale, { label: l.label, description: l.description }]),
    ),
  };
}
