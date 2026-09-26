import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { assignments } from './assignments';
import { users } from './users';

/**
 * Who may read a note or a task besides the person who wrote it (plan.md §8).
 *
 * `PRIVATE` is the author alone — not the customer, not a colleague, not the agency's owner.
 * `SHARED` is the assignment's parties. Sharing is deliberate: unsharing takes it back out of
 * sight, but what was read was read.
 */
export const investigationVisibility = pgEnum('investigation_visibility', ['PRIVATE', 'SHARED']);

/** Where a task stands. Moved only through `task-transitions.ts`, never assigned directly. */
export const investigationTaskStatus = pgEnum('investigation_task_status', [
  'TODO',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
]);

/**
 * The investigator's working material inside an assignment (plan.md §8, T-032).
 *
 * **Mutable, unlike evidence.** No checksum, no chain of custody, no access grant: a note is
 * thinking in progress, edited as the thinking moves. Evidence semantics are deliberately absent,
 * and a spec keeps them out.
 *
 * **Private to its author by default**, and row-level security holds it: a private note is
 * readable by the person who wrote it and nobody else in any workspace — a customer reading a
 * hypothesis that was investigated and dismissed is exactly the FACT/INFERENCE failure
 * `evidence-integrity` exists to prevent.
 *
 * **Deleted softly, never removed.** The runtime role holds no DELETE, and the assignment cannot be
 * deleted from under it; retention is a policy a job enforces, not a cascade.
 */
export const investigationNotes = pgTable(
  'investigation_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    visibility: investigationVisibility('visibility').notNull().default('PRIVATE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Copied from the assignment by trigger, and never changed (T-076). */
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    // The parties must be the assignment's own, or a note could be readable where its assignment
    // is not.
    foreignKey({
      name: 'investigation_notes_parties_fk',
      columns: [t.assignmentId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [assignments.id, assignments.customerTenantId, assignments.supplierTenantId],
    }).onDelete('restrict'),
    index('investigation_notes_assignment_idx').on(t.assignmentId, t.createdAt),
    index('investigation_notes_supplier_tenant_idx').on(t.supplierTenantId),
    index('investigation_notes_customer_tenant_idx').on(t.customerTenantId),
  ],
);

/**
 * The work plan inside an assignment (plan.md §8, T-032) — what the Planning stage shows.
 *
 * Private to whoever created it by default, like a note; some investigators will want to show
 * progress, and that is their choice. Its status moves along the edges in `task-transitions.ts`,
 * which a trigger holds in the database too.
 */
export const investigationTasks = pgTable(
  'investigation_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    status: investigationTaskStatus('status').notNull().default('TODO'),
    /** A day, not an instant: "by Friday" means Friday wherever the investigator is. */
    dueOn: date('due_on', { mode: 'string' }),
    /** Where it sits in its creator's list; ties fall back to when it was created. */
    position: integer('position').notNull().default(0),
    visibility: investigationVisibility('visibility').notNull().default('PRIVATE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    foreignKey({
      name: 'investigation_tasks_parties_fk',
      columns: [t.assignmentId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [assignments.id, assignments.customerTenantId, assignments.supplierTenantId],
    }).onDelete('restrict'),
    index('investigation_tasks_assignment_idx').on(t.assignmentId, t.position, t.createdAt),
    index('investigation_tasks_supplier_tenant_idx').on(t.supplierTenantId),
    index('investigation_tasks_customer_tenant_idx').on(t.customerTenantId),
  ],
);
