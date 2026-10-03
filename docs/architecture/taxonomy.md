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

## Tags (T-055)

Tags refine a mission on top of the tree — "remote work", "court use", "urgent". They are a
**curated, flat vocabulary**, not customer free text: free text in three locales cannot be matched,
and a customer-authored word on a public listing is something to moderate.

| Piece | Where |
|---|---|
| `tags` — stable id, permanent slug, status, `merged_into_id` | `database/schema/tags.ts`, migration 0039 |
| `tag_labels` — one label per locale (`en`, `ru`, `hy`) | migration 0039 |
| `mission_tags` — mission, tag, when suggested, when and by whom confirmed | migration 0039 |
| Reading the vocabulary | `GET /api/v1/tags?locale=` — ACTIVE tags, label order, English fallback with `labelLocale` |
| Staff maintenance | `POST /tags`, `PUT /tags/:id/labels/:locale`, `POST /tags/:id/deprecate`, `POST /tags/:id/merge` |
| Suggesting | `tagIds` on `POST /missions` and `PATCH /missions/:id`, while DRAFT |
| Confirming | `tagIds` on a PUBLISHED moderation decision (`docs/architecture/missions.md`) |
| Filtering and ranking | `tagIds` on `POST /search/missions` (T-054) |

### Who does what

1. **Staff** with the TAXONOMY scope keep the vocabulary, exactly as they keep the tree: inside
   PlatformContext (route purposes `tag.create`, `tag.set_label`, `tag.deprecate`, `tag.merge`),
   one write at a time under an advisory lock, every write audited as `<what changed> — <why>`.
2. **A customer** suggests up to eight ACTIVE tags while the mission is a draft. Suggesting again
   replaces the set. Once submitted, the suggestions are frozen with the rest of the brief.
3. **A moderator** sees the suggestions in the brief and, on publishing, confirms the tags the
   mission is published with — the suggestions they keep, and any they add. Nothing is confirmed on
   a return or a rejection; the API refuses `tagIds` with any outcome but PUBLISHED.
4. **Investigators** browsing open missions see and filter by **confirmed** tags only. A suggestion
   nobody confirmed changes nothing anyone else sees.
5. **The customer** reads both on their own mission (T-194): `tagIds` is what they suggested,
   `confirmedTagIds` what it was published with — each as the tag it has since been merged into,
   once, since that is what investigators now find it under. Their mission page shows the suggestions, labelled
   as such, until it is published, then the confirmed tags as "Investigators find it under" — none
   if it was published with none (`app-web.md`).

### Rules, and what holds each one

| Rule | Checked by the service | Held by the database |
|---|---|---|
| No free-text tags | `tagIds` are UUIDs of existing ACTIVE tags; 422 `error.validation.tags.unknown` / `.deprecated` | FK to `tags` |
| A customer touches tags only on their own draft, and never a confirmed one | the draft-only edit path | RLS `customer_suggests`, `customer_withdraws`: own tenant, unconfirmed, mission DRAFT |
| Only a moderator confirms | the moderation decision | RLS `staff_confirms`: UPDATE only under `app_platform_access()` |
| Tags are never deleted; a slug is permanent | no DELETE route | DELETE not granted on `tags`; trigger `keep_tag_identity` (`tag_slug_fixed`) |
| A merge happens once, into an ACTIVE tag, never into itself, and retires the old tag | 409 / 422 `error.validation.tags.merge_target` | `tag_merged_once`, `tag_merge_target_active`, checks `tags_merged_is_deprecated`, `tags_not_merged_into_self` |
| At most eight tags per mission | DTO `ArrayMaxSize` | — |

### Merging keeps every mission

Merging retires the old tag and records the tag it became. **No mission is rewritten.** Browsing
by a tag searches its *merge closure* — the tag plus every tag merged into it, at any depth (a
recursive query over `merged_into_id`, `modules/search/tag-closure.ts`) — so a filter on the
survivor still finds every mission that carried the old one, and the old row stays as evidence of
what the moderator confirmed at the time.

### Tags never affect eligibility

Eligibility is the taxonomy, the service area and the languages, as a hard SQL filter (T-011,
`investigator-discovery`). A tag only does two things, both inside the already-eligible set:

- **narrows** a browse: with several tags, a mission must carry all of them (confirmed);
- **ranks** a text search: confirmed tag labels are part of the searched text at weight A, above
  the title and description.

`mission-tags.spec.ts` proves it: a mission browse would not show — already hired, the
investigator's own, still under review — stays hidden however it is tagged and whatever tags are
asked for, and the same browse without a tag filter shows exactly the same set. Screening is
unaffected too: the same mission screens the same, tagged or not. An investigator profile has no
tags at all, so there is nothing a tag could be matched against.

## Not here

- **The seed** — T-131, after the domain and licensing review in `docs/product/taxonomy-draft.md`
  (ACTIONS-FOR-ME #2). Includes the per-node structured questions (plan.md §10).
- **The source axis** — T-132 (ADR-0008).
- **A console** — admin-web exists (T-014) but has no screens yet (T-070 onwards); the API is the
  whole surface for now.
