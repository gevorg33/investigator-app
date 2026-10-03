import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import type { Actor } from '../../common/authz/contract';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { RoutePurpose } from '../../common/context/platform-access';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { tagLabels, tags, TAXONOMY_LOCALES, type TaxonomyLocale } from '../../database/schema';
import { isActiveTag } from './tag-rules';
import type { CreateTagDto, DeprecateTagDto, MergeTagDto, SetTagLabelDto } from './tags.dto';

type TagRow = typeof tags.$inferSelect;
type LabelRow = typeof tagLabels.$inferSelect;

/** A tag as a picker offers it: its label in the locale asked for, English where untranslated. */
export interface TagOption {
  id: string;
  slug: string;
  label: string;
  /** Which locale the label came from, so a client can say "shown in English". */
  labelLocale: TaxonomyLocale;
}

/** A tag as staff maintain it: every locale's label, and what became of it. */
export interface TagView {
  id: string;
  slug: string;
  status: TagRow['status'];
  /** The tag it was merged into, if it was. */
  mergedIntoId: string | null;
  labels: Partial<Record<TaxonomyLocale, string>>;
}

/**
 * The curated tag vocabulary (T-055), maintained exactly as the taxonomy is (T-053).
 *
 * **Reading** is for everyone signed in: customers suggesting tags and investigators filtering by
 * them pick from the same ACTIVE list. **Writing** is for staff holding the TAXONOMY scope, inside
 * PlatformContext, and every write says why — row-level security admits a write to these tables
 * nowhere else.
 *
 * Nothing is deleted. Retiring a tag takes it out of every picker; **merging** one retires it and
 * records the tag it became, so a filter on the survivor still finds every mission that carried
 * the old one — no mission is rewritten (docs/architecture/taxonomy.md, "Tags").
 */
@Injectable()
export class TagsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly platform: PlatformContext,
  ) {}

  /** The ACTIVE vocabulary, labelled in `locale`, in label order. */
  async list(locale: TaxonomyLocale = 'en'): Promise<TagOption[]> {
    const rows = await this.db.select().from(tags).where(eq(tags.status, 'ACTIVE'));
    const labels = await this.labelsFor(
      rows.map((r) => r.id),
      [locale, 'en'],
    );
    return rows
      .flatMap((r) => {
        const found = resolve(labels.get(r.id) ?? [], locale);
        // A tag with no English label cannot be created; one is never offered without a name.
        return found === undefined
          ? []
          : [{ id: r.id, slug: r.slug, label: found.label, labelLocale: found.locale }];
      })
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  }

  /**
   * What each tag is called in `locale`, falling back to English — retired or not, since a mission
   * from before a merge still carries its tag. An id with no label is absent from the map.
   */
  async labels(
    ids: readonly string[],
    locale: TaxonomyLocale = 'en',
  ): Promise<Map<string, string>> {
    const found = await this.labelsFor([...new Set(ids)], [locale, 'en']);
    const named = new Map<string, string>();
    for (const [id, rows] of found) named.set(id, resolve(rows, locale)!.label);
    return named;
  }

  async create(actor: Actor, dto: CreateTagDto, req: RequestContext): Promise<TagView> {
    return this.write(actor, 'tag.create', req, undefined, async (tx, c) => {
      const [taken] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, dto.slug));
      if (taken !== undefined) {
        throw AppError.validation([
          { field: 'slug', code: 'TAKEN', messageKey: 'error.validation.tags.slug_taken' },
        ]);
      }
      const [row] = await tx.insert(tags).values({ slug: dto.slug }).returning();
      const [label] = await tx
        .insert(tagLabels)
        .values({ tagId: row!.id, locale: 'en', label: dto.label.trim() })
        .returning();
      await this.record(actor, c, 'tag.created', row!.id, dto.slug, dto.reason, tx);
      return view(row!, [label!]);
    });
  }

  async setLabel(
    actor: Actor,
    id: string,
    locale: TaxonomyLocale,
    dto: SetTagLabelDto,
    req: RequestContext,
  ): Promise<TagView> {
    return this.write(actor, 'tag.set_label', req, id, async (tx, c) => {
      const row = await this.lock(tx, actor, id, c);
      const label = dto.label.trim();
      await tx
        .insert(tagLabels)
        .values({ tagId: id, locale, label })
        .onConflictDoUpdate({
          target: [tagLabels.tagId, tagLabels.locale],
          set: { label, updatedAt: sql`now()` },
        });
      await this.record(actor, c, 'tag.label_set', id, `${locale}: ${label}`, dto.reason, tx);
      // The label just written is there, so the tag has at least one.
      return view(row, (await this.labelsFor([id], TAXONOMY_LOCALES, tx)).get(id)!);
    });
  }

  /** Retires a tag: out of every picker, still on every mission that carries it. */
  async deprecate(
    actor: Actor,
    id: string,
    dto: DeprecateTagDto,
    req: RequestContext,
  ): Promise<TagView> {
    return this.write(actor, 'tag.deprecate', req, id, async (tx, c) => {
      const row = await this.lock(tx, actor, id, c);
      if (row.status !== 'ACTIVE') throw AppError.stateConflict();
      const [retired] = await tx
        .update(tags)
        .set({ status: 'DEPRECATED', updatedAt: sql`now()` })
        .where(eq(tags.id, id))
        .returning();
      await this.record(actor, c, 'tag.deprecated', id, row.slug, dto.reason, tx);
      return view(retired!, (await this.labelsFor([id], TAXONOMY_LOCALES, tx)).get(id) ?? []);
    });
  }

  /**
   * Merges a tag into another: the old one is retired and names the new, and every mission that
   * carried it is found under the new one from now on, without any of them being rewritten.
   */
  async merge(actor: Actor, id: string, dto: MergeTagDto, req: RequestContext): Promise<TagView> {
    return this.write(actor, 'tag.merge', req, id, async (tx, c) => {
      const row = await this.lock(tx, actor, id, c);
      if (row.mergedIntoId !== null || dto.intoId === id) throw AppError.stateConflict();
      if (!(await isActiveTag(tx, dto.intoId))) {
        throw AppError.validation([
          { field: 'intoId', code: 'NOT_ACTIVE', messageKey: 'error.validation.tags.merge_target' },
        ]);
      }
      const [merged] = await tx
        .update(tags)
        .set({ status: 'DEPRECATED', mergedIntoId: dto.intoId, updatedAt: sql`now()` })
        .where(eq(tags.id, id))
        .returning();
      await this.record(actor, c, 'tag.merged', id, `${row.slug} → ${dto.intoId}`, dto.reason, tx);
      return view(merged!, (await this.labelsFor([id], TAXONOMY_LOCALES, tx)).get(id) ?? []);
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** A staff write: the curator's checks, then PlatformContext, one tag write at a time. */
  private async write<T>(
    actor: Actor,
    purpose: Extract<RoutePurpose, `tag.${string}`>,
    req: RequestContext,
    resourceId: string | undefined,
    fn: (tx: Tx, c: AuthzContext) => Promise<T>,
  ): Promise<T> {
    const c = ctx(purpose, req, resourceId);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'STAFF', c);
    await this.authz.requireStaffScope(actor, 'TAXONOMY', c);
    return this.platform.asStaff(actor, { scope: 'TAXONOMY', purpose }, req, () =>
      this.db.transaction(async (tx) => {
        // Two staff merging into each other at once would each pass the other's check; the
        // vocabulary is small and edited rarely, so one write at a time costs nothing.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tags'))`);
        return fn(tx, c);
      }),
    );
  }

  private async lock(tx: Tx, actor: Actor, id: string, c: AuthzContext): Promise<TagRow> {
    const [row] = await tx.select().from(tags).where(eq(tags.id, id)).for('update');
    return this.authz.visible(actor, row, c);
  }

  private async labelsFor(
    ids: string[],
    locales: readonly TaxonomyLocale[],
    tx?: Tx,
  ): Promise<Map<string, LabelRow[]>> {
    const byTag = new Map<string, LabelRow[]>();
    // No early return for an empty list: drizzle writes `IN ()` as `false`, which is the answer.
    const rows = await (tx ?? this.db)
      .select()
      .from(tagLabels)
      .where(inArray(tagLabels.tagId, ids));
    for (const r of rows.filter((l) => locales.includes(l.locale))) {
      byTag.set(r.tagId, [...(byTag.get(r.tagId) ?? []), r]);
    }
    return byTag;
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
        resourceType: 'tag',
        resourceId,
        reason: `${what} — ${why.trim()}`,
      },
      tx,
    );
  }
}

const ctx = (action: string, req: RequestContext, resourceId?: string): AuthzContext => ({
  action,
  resourceType: 'tag',
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});

function resolve(
  labels: LabelRow[],
  locale: TaxonomyLocale,
): { label: string; locale: TaxonomyLocale } | undefined {
  const found = labels.find((l) => l.locale === locale) ?? labels.find((l) => l.locale === 'en');
  return found === undefined ? undefined : { label: found.label, locale: found.locale };
}

function view(row: TagRow, labels: LabelRow[]): TagView {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    mergedIntoId: row.mergedIntoId,
    labels: Object.fromEntries(labels.map((l) => [l.locale, l.label])),
  };
}
