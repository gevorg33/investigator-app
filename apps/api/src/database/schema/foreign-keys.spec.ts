import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { userIdentities } from './identities';
import { userTokens } from './tokens';
import { userStaffScopes } from './staff-scopes';
import { taxonomyNodeLabels, taxonomyNodes } from './taxonomy';
import { assignments } from './assignments';
import { investigationSources } from './investigation-sources';
import { investigationNotes, investigationTasks } from './investigation-workspace';
import { aiSessionEntities, aiSessionSummaries } from './ai-context';
import { aiPlanSteps, aiPlans, aiToolResults } from './ai-plans';
import { aiMessages, aiSessions } from './ai-sessions';
import { tenants } from './tenants';
import { missions, savedMissionSearches } from './missions';
import { userBlocks } from './blocks';
import { notificationPreferences, notifications } from './notifications';
import { moneyDecisions, policyReviews } from './policy-reviews';
import { investigatorProfiles } from './profiles';
import { reviewTexts, reviews } from './reviews';
import { userRoles, users, userSessions } from './users';

/**
 * Rows that exist only because of a user. The cascade is a retention property as much as
 * a relational one: docs/compliance/retention.md says these go with the account.
 */
describe('rows that belong to a user', () => {
  it.each([
    ['user_roles', userRoles],
    ['user_sessions', userSessions],
    ['user_identities', userIdentities],
    ['user_tokens', userTokens],
  ] as Array<[string, PgTable]>)('%s references users and is removed with them', (_name, table) => {
    const fk = getTableConfig(table).foreignKeys.find((f) => f.reference().foreignTable === users);
    expect(fk?.reference().columns.map((c) => c.name)).toEqual(['user_id']);
    expect(fk?.onDelete).toBe('cascade');
  });
});

describe('staff scope grants', () => {
  const fks = getTableConfig(userStaffScopes).foreignKeys.map((f) => ({
    column: f.reference().columns[0]?.name,
    target: f.reference().foreignTable,
    onDelete: f.onDelete,
  }));

  it('removes a scope with the staff member who holds it', () => {
    expect(fks).toContainEqual({ column: 'user_id', target: users, onDelete: 'cascade' });
  });

  it.each(['granted_by', 'revoked_by'])(
    'keeps the grant history when the staff member in %s is deleted',
    (column) => {
      // Cascading here would erase who granted or revoked access the moment that person's
      // account went — and revoked grants are kept seven years precisely so an incident
      // review can ask who could see payments last March (docs/compliance/retention.md).
      expect(fks).toContainEqual({ column, target: users, onDelete: 'set null' });
    },
  );
});

describe('taxonomy labels', () => {
  it('belong to a node, and stop the node being removed — nodes are retired, never deleted', () => {
    // Restrict, not cascade: a node with labels is a node someone has used (ADR-0007 rule 1).
    const [fk] = getTableConfig(taxonomyNodeLabels).foreignKeys;
    expect(fk?.reference().foreignTable).toBe(taxonomyNodes);
    expect(fk?.reference().columns.map((c) => c.name)).toEqual(['node_id']);
    expect(fk?.onDelete).toBe('restrict');
  });
});

describe('investigation sources', () => {
  const fks = getTableConfig(investigationSources).foreignKeys.map((f) => ({
    columns: f.reference().columns.map((c) => c.name),
    target: f.reference().foreignTable,
    onDelete: f.onDelete,
  }));

  it('stay on their assignment, which cannot be deleted from under them (T-031)', () => {
    // Restrict, as for the assignment's own history: a source is part of the record of the work.
    expect(fks).toContainEqual({
      columns: ['assignment_id'],
      target: assignments,
      onDelete: 'restrict',
    });
    expect(fks).toContainEqual({
      columns: ['assignment_id', 'customer_tenant_id', 'supplier_tenant_id'],
      target: assignments,
      onDelete: 'restrict',
    });
  });

  it('keep who recorded them, even if that account goes', () => {
    expect(fks).toContainEqual({ columns: ['added_by'], target: users, onDelete: 'restrict' });
  });
});

describe('investigation notes and tasks (T-032)', () => {
  it.each([
    ['investigation_notes', investigationNotes, 'author_id'],
    ['investigation_tasks', investigationTasks, 'created_by'],
  ] as Array<[string, PgTable, string]>)(
    '%s neither go with their assignment nor lose who wrote them',
    (_name, table, writer) => {
      const fks = getTableConfig(table).foreignKeys.map((f) => ({
        columns: f.reference().columns.map((c) => c.name),
        target: f.reference().foreignTable,
        onDelete: f.onDelete,
      }));
      // Retention is a policy a job enforces (plan.md §8), never a cascade.
      expect(fks).toContainEqual({
        columns: ['assignment_id'],
        target: assignments,
        onDelete: 'restrict',
      });
      expect(fks).toContainEqual({
        columns: ['assignment_id', 'customer_tenant_id', 'supplier_tenant_id'],
        target: assignments,
        onDelete: 'restrict',
      });
      expect(fks).toContainEqual({ columns: [writer], target: users, onDelete: 'restrict' });
    },
  );
});

describe('assistant sessions (T-045)', () => {
  const fks = (t: PgTable) =>
    getTableConfig(t).foreignKeys.map((f) => ({
      columns: f.reference().columns.map((c) => c.name),
      target: f.reference().foreignTable,
      onDelete: f.onDelete,
    }));

  it('belong to one user in one workspace, neither of which can be deleted from under them', () => {
    // Restrict: a person or workspace with conversations is removed by the retention workflow,
    // which erases the conversations first — never as a side effect of a cascade.
    expect(fks(aiSessions)).toEqual(
      expect.arrayContaining([
        { columns: ['tenant_id'], target: tenants, onDelete: 'restrict' },
        { columns: ['user_id'], target: users, onDelete: 'restrict' },
      ]),
    );
  });

  it('keep their messages until the session is erased on purpose', () => {
    // Restrict, not cascade: deleting a session erases its messages explicitly, in the same
    // transaction, and a tombstone stays — the session row itself is never deleted.
    expect(fks(aiMessages)).toEqual([
      { columns: ['session_id'], target: aiSessions, onDelete: 'restrict' },
    ]);
  });

  it('keep plans, their steps and stored results until the session is erased on purpose (T-048)', () => {
    // Restrict, as messages: session deletion erases each explicitly — steps before their plan —
    // and nothing a person confirmed disappears as the side effect of a cascade.
    expect(fks(aiPlans)).toEqual([
      { columns: ['tenant_id'], target: tenants, onDelete: 'restrict' },
      { columns: ['user_id'], target: users, onDelete: 'restrict' },
      { columns: ['session_id'], target: aiSessions, onDelete: 'restrict' },
    ]);
    expect(fks(aiPlanSteps)).toEqual([
      { columns: ['plan_id'], target: aiPlans, onDelete: 'restrict' },
      { columns: ['session_id'], target: aiSessions, onDelete: 'restrict' },
    ]);
    expect(fks(aiToolResults)).toEqual([
      { columns: ['session_id'], target: aiSessions, onDelete: 'restrict' },
    ]);
  });

  it('keep summaries and session state until the session is erased on purpose (T-046)', () => {
    // As messages: erased by session deletion (SESSION_CONTENT), never by a cascade.
    for (const table of [aiSessionSummaries, aiSessionEntities]) {
      expect(fks(table)).toEqual([
        { columns: ['session_id'], target: aiSessions, onDelete: 'restrict' },
      ]);
    }
  });
});

describe('policy reviews and money decisions (T-050)', () => {
  const fks = (t: PgTable) =>
    getTableConfig(t).foreignKeys.map((f) => ({
      columns: f.reference().columns.map((c) => c.name),
      target: f.reference().foreignTable,
      onDelete: f.onDelete,
    }));

  it('keep a review with its assignment, its mission and both people in it', () => {
    // Restrict throughout: a review is part of the record of the work and of an investigator's
    // standing, and nothing it names may disappear from under it.
    expect(fks(policyReviews)).toEqual(
      expect.arrayContaining([
        { columns: ['assignment_id'], target: assignments, onDelete: 'restrict' },
        { columns: ['mission_id'], target: missions, onDelete: 'restrict' },
        { columns: ['raised_by'], target: users, onDelete: 'restrict' },
        { columns: ['decided_by'], target: users, onDelete: 'restrict' },
      ]),
    );
  });

  it('keep a money decision with its assignment, its review and who made it', () => {
    expect(fks(moneyDecisions)).toEqual(
      expect.arrayContaining([
        { columns: ['assignment_id'], target: assignments, onDelete: 'restrict' },
        { columns: ['policy_review_id'], target: policyReviews, onDelete: 'restrict' },
        { columns: ['decided_by'], target: users, onDelete: 'restrict' },
      ]),
    );
  });
});

describe('reviews (T-037)', () => {
  const fks = (t: PgTable) =>
    getTableConfig(t).foreignKeys.map((f) => ({
      columns: f.reference().columns.map((c) => c.name),
      target: f.reference().foreignTable,
      onDelete: f.onDelete,
    }));

  it('keep a rating with its assignment, both its parties, the investigator and who removed it', () => {
    // Restrict throughout: a review is part of an investigator's standing, and a removed one is
    // kept with who removed it and why.
    expect(fks(reviews)).toEqual(
      expect.arrayContaining([
        { columns: ['assignment_id'], target: assignments, onDelete: 'restrict' },
        {
          columns: ['assignment_id', 'customer_tenant_id', 'supplier_tenant_id'],
          target: assignments,
          onDelete: 'restrict',
        },
        {
          columns: ['investigator_profile_id'],
          target: investigatorProfiles,
          onDelete: 'restrict',
        },
        { columns: ['removed_by'], target: users, onDelete: 'restrict' },
      ]),
    );
  });

  it('keep words with their review, its parties, their author and who moderated or reported them', () => {
    expect(fks(reviewTexts)).toEqual(
      expect.arrayContaining([
        { columns: ['review_id'], target: reviews, onDelete: 'restrict' },
        {
          columns: ['review_id', 'customer_tenant_id', 'supplier_tenant_id'],
          target: reviews,
          onDelete: 'restrict',
        },
        { columns: ['author_id'], target: users, onDelete: 'restrict' },
        { columns: ['moderated_by'], target: users, onDelete: 'restrict' },
        { columns: ['reported_by'], target: users, onDelete: 'restrict' },
      ]),
    );
  });
});

describe('saved mission searches (T-054)', () => {
  it('belong to one user in one workspace, and go only by the retention workflow', () => {
    const fks = getTableConfig(savedMissionSearches).foreignKeys.map((f) => ({
      columns: f.reference().columns.map((c) => c.name),
      target: f.reference().foreignTable,
      onDelete: f.onDelete,
    }));
    expect(fks).toEqual(
      expect.arrayContaining([
        { columns: ['tenant_id'], target: tenants, onDelete: 'restrict' },
        { columns: ['user_id'], target: users, onDelete: 'restrict' },
      ]),
    );
  });
});

describe('notifications and their preferences', () => {
  it.each([
    ['notifications', notifications, 'recipient_id'],
    ['notification_preferences', notificationPreferences, 'user_id'],
  ] as Array<[string, PgTable, string]>)(
    '%s go with their person, and never let a workspace be deleted from under them (T-036)',
    (_name, table, person) => {
      const fks = getTableConfig(table).foreignKeys.map((f) => ({
        columns: f.reference().columns.map((c) => c.name),
        target: f.reference().foreignTable,
        onDelete: f.onDelete,
      }));
      // A notification is about its recipient and nobody else; retention.md removes it with them.
      expect(fks).toContainEqual({ columns: [person], target: users, onDelete: 'cascade' });
      expect(fks).toContainEqual({ columns: ['tenant_id'], target: tenants, onDelete: 'restrict' });
    },
  );
});

describe('blocks', () => {
  const fks = getTableConfig(userBlocks).foreignKeys.map((f) => ({
    columns: f.reference().columns.map((c) => c.name),
    target: f.reference().foreignTable,
    onDelete: f.onDelete,
  }));

  it.each(['blocker_id', 'blocked_id'])(
    'go with either person — %s — since a block is about the two of them (T-052)',
    (column) => {
      expect(fks).toContainEqual({ columns: [column], target: users, onDelete: 'cascade' });
    },
  );

  it('outlive the investigator profile they point to, and never hold a workspace in place', () => {
    expect(fks).toContainEqual({
      columns: ['blocked_profile_id'],
      target: investigatorProfiles,
      onDelete: 'set null',
    });
    expect(fks).toContainEqual({ columns: ['tenant_id'], target: tenants, onDelete: 'restrict' });
  });
});
