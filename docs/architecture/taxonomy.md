# Taxonomy

One tree of kinds of investigation, drawn from by missions and by investigator specialties
(ADR-0007). This note describes what is built; the decision and its reasoning are in the ADR.

## What is built (T-053)

| Piece | Where |
|---|---|
| `taxonomy_nodes` — stable id, permanent slug, parent, position, status, risk band | `database/schema/taxonomy.ts` (T-007, T-010) |
| `taxonomy_node_labels` — label and description per locale (`en`, `ru`, `hy`) | migration 0017 |
| Reading the tree, and one node by id | `GET /api/v1/taxonomy`, `GET /api/v1/taxonomy/nodes/:id` |
| Staff maintenance | `POST /taxonomy/nodes`, `PATCH /taxonomy/nodes/:id`, `PUT /taxonomy/nodes/:id/labels/:locale` |
| Matching — the tree walked in both directions, as a hard SQL filter | `modules/search` (T-011) |
| Moderation by band — HIGH and above to priority review | `modules/mission-policy` (T-010) |

## Rules, and what holds each one

| Rule | Checked by the service | Held by the database |
|---|---|---|
| Nodes are never deleted | — | DELETE is not granted to the runtime role |
| A slug and a parent are permanent | the edit DTO has no such fields | trigger `taxonomy_identity_fixed` |
| Slugs are lowercase kebab-case | DTO | check `taxonomy_nodes_slug_shape` |
| Every ACTIVE node sits under an ACTIVE parent | clear 422s: `CHILDREN_ACTIVE`, `PARENT_DEPRECATED` | triggers `taxonomy_no_child_of_deprecated`, `taxonomy_active_under_active` |
| Only TAXONOMY staff write | `requireStaffScope`, audited denial | RLS: writes admitted only under `app_platform_access()` |
| A retired node stays valid where it is used | profiles refuse only *newly added* retired nodes; missions refuse them for new drafts | — (nothing references status) |

The service checks exist to give a person a clear answer. The database checks exist because the
service is not the only thing that will ever write here.

## Platform data that staff maintain

The taxonomy is the first platform table the application writes. Until T-053 the runtime role held
SELECT on every platform table and nothing else, so the tree could change only by migration. The
two taxonomy tables are now marked `staffMaintained` in `table-classes.ts`, which means:

- the runtime role holds SELECT, INSERT and UPDATE — never DELETE;
- row-level security is enabled and forced, with a read-everything SELECT policy and INSERT and
  UPDATE policies of exactly `app_platform_access()`;
- `rls.spec.ts` asserts all three, and that every other platform table is still read-only.

A write outside PlatformContext is refused by policy on insert, and matches no row on update.

Because RLS is forced on the owner too, a migration that seeds the tree (T-131) runs its inserts
with `app.platform_access` set, like any other writer.

Writes are serialised with a transaction-scoped advisory lock: two staff members retiring a parent
and restoring its child at the same moment would each pass the other's check. The tree is small
and edited rarely, so nobody will notice the serialisation.

## Reading

`GET /taxonomy?locale=` returns ACTIVE nodes as a tree, ordered by position then slug. A label
missing in the requested locale falls back to English, and `labelLocale` says which was used; a
node with no label at all reports `null` rather than showing its slug. A node whose parent is not
ACTIVE is not shown at the top level — it is simply not reached.

`GET /taxonomy/nodes/:id` resolves any node, retired or not, with every locale's label.

## Not here

- **The seed** — T-131, after the domain and licensing review in `docs/product/taxonomy-draft.md`
  (ACTIONS-FOR-ME #2). Includes the per-node structured questions (plan.md §10).
- **Tags** — T-055, which specifies all of them: the vocabulary, suggestion and confirmation, and
  the test that a tag never affects eligibility.
- **The source axis** — T-132 (ADR-0008).
- **A console** — admin-web does not exist yet (T-014); the API is the whole surface for now.
