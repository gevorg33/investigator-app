import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * A notification in someone's in-app centre (T-036, plan.md §13): written in the recipient's own
 * workspace, visible to them alone — not to other members of an agency — and **references only**:
 * what happened (`kind`), to what (`subject_type`, `subject_id`) and where to look. The words are
 * the recipient's catalog's, at reading time; no content of the mission, message or evidence it is
 * about is ever copied here.
 *
 * One per (event, recipient): however often an event is delivered, it is one notification.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .default(sql`app_current_user()`)
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The outbox event it came from. */
    eventId: uuid('event_id').notNull(),
    kind: text('kind').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** A path on the app, relative. */
    href: text('href').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('notifications_event_recipient_unique').on(t.tenantId, t.eventId, t.recipientId),
    // Serves the centre: the recipient's newest first, and their unread count.
    index('notifications_recipient_idx').on(
      t.tenantId,
      t.recipientId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

/**
 * Whether a person wants a category of notification on a channel, in a workspace (T-036). A row
 * exists only once they chose; absent means the default, which is on. In-app is always on — it is
 * the centre itself — so only channels that reach outside the app are stored.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .default(sql`app_current_user()`)
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.category, t.channel] })],
);
