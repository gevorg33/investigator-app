# Assistant tools and investigator discovery

How the assistant reaches live business data. Built in T-018. Procedures:
`.claude/skills/ai-tool-registry/SKILL.md` and `.claude/skills/investigator-discovery/SKILL.md`.
The search it calls is `discovery.md`; the knowledge answer beside it is `knowledge.md`.

## The rule it exists to keep

"Who can help me" has a correct answer, and it is in PostgreSQL. Answering it from documentation,
or from embeddings of profiles, gives approximate answers to exact questions, goes stale, and lets a
well-written but unverified profile through. So discovery is **structured tools over SQL and
PostGIS**, never RAG, and the model never writes a sentence about an investigator.

```
Database → tool (as the caller) → typed result → rendered reasons → the person
                     ↑
        the model proposes typed filters, and nothing else
```

## Tools

A tool is a class in `apps/api/src/modules/ai/tools/**`. It declares the nine registry fields —
`name`, `description`, `requiredRoles`, `resourceScope`, `operation`, `confirmation`, `input`,
`output`, `auditEvent`, `rateLimit` — plus `auditArguments` (what of the arguments may be
recorded) and `execute`.

`assertRegistrable` checks every declaration when the module starts, so a bad tool stops the
application rather than reaching a user. It refuses:

| Declaration | Why |
|---|---|
| A missing or malformed field | The contract is the nine fields, all of them |
| `operation: 'write'`, confirmed or not | Writes need a confirmation the model never sees, bound to exact arguments and used once. That flow is T-048; until it exists no write tool registers |
| An input that is not a **strict** object | An argument the tool does not name must be refused, not ignored |
| An input field named `actor…`, `user…`, `tenant…`, `workspace…` or `membership…` | Who is acting, and where, come from the session and the execution context (ADR-0011). A model-supplied one is an impersonation vector |
| An audit event outside `ai.tool.<snake_case>` | So every tool call is findable by one prefix |

`ToolRunner.invoke` is the only way a tool runs, and runs every step every time:

```
registered (by identity, not just name) → account ACTIVE → inside a workspace
  → one of the tool's roles, as the actor holds it now → rate limit per tool per account
  → input parsed strictly → execute (as the caller) → output parsed (unnamed fields stripped)
  → audit: actor, event, redacted arguments, outcome
```

The service a tool calls authorizes again. The assistant having decided to call something proves
nothing.

### `searchInvestigators`

Calls `SearchService` — the same service as `POST /search/investigators`, so filters, eligibility
and geography are one implementation. Eligibility (published, VERIFIED, accepting work, account
ACTIVE and not deleted) is in the SQL `WHERE`; `ST_DWithin` filters and `ST_Distance` sorts.

| Input | Meaning |
|---|---|
| `place` | Country (ISO alpha-2), region, city — matched against service areas |
| `near` | `{ lon, lat, radiusKm }`. Real coordinates from the person's device or a map pin — never from the model |
| `taxonomyNodeIds` | Any of them, walking the tree both ways (ADR-0007) |
| `languages` | All of them |
| `availableDuring` | A weekly window; declared hours must overlap it |
| `relevanceHint` | Free text. **Only reorders** — see below |
| `locale`, `limit` | Label language; how many to show (default 5, maximum 10) |

Output, per investigator: id, display name, headline, years of experience, languages, declared
specialties (labelled), declared weekly hours, `verificationStatus: VERIFIED`, a distance rounded
up to whole kilometres, `matchedOn` and `notMatched`. Plus `hasMore` and `orderedBy`
(`distance` · `relevance` · `experience`).

**Deliberately absent:** price (a price is a quote, and the assistant does not state one), bio
(prose is where capabilities get inferred, and capabilities are declared specialties only),
contact details, user id, coordinates and service-area geometry. The output schema names what
may leave; anything else a future change passes along is stripped on the way out.

**Relevance** is lexical: how many of the hint's words the headline and bio contain, compared on
their first five letters. It reorders a pool of up to 50 investigators the search already
returned, in the search's own order, and keeps that order on ties. It has no way to add anyone,
which is how "a highly relevant profile description" is kept from surfacing an ineligible one. When
a point was given, distance decides and the hint is not applied.

### `listTaxonomy`

The ACTIVE taxonomy, flattened with parents and labelled in the locale asked for (English where a
label is missing). Read from the database every call: the categories a request can be matched to
are curated data, never a list written into a prompt.

## `matchedOn` and `notMatched`

`matchedOn` holds only what was asked for and met: the declared specialties that satisfied the
taxonomy filter, the requested languages, the place filters, the window asked for.

`notMatched` holds the **requested specialties this investigator does not reach**. Only the
taxonomy can have a gap, because its nodes are alternatives — any one of them admits an
investigator. Every other filter must be met in full, or the investigator would not be in the
result. "Matches on due diligence, but does not offer surveillance" is more honest than silence
about it. A requested node that does not exist is not something anyone lacks.

`notMatched` is computed by `SearchService`, so the HTTP search returns it too.

## The discovery answer — `POST /api/v1/ai/discovery/answer`

```
actor ACTIVE → workspace → model configured (503) → rate limit
  → lawful-use rules over the request and any stated purpose → refused?
  → listTaxonomy (tool) → the model proposes filters → parsed strictly
  → the model's relevance hint screened by the same rules
  → at most one question, only if it changes the answer
  → searchInvestigators (tool) → reasons rendered from matchedOn / notMatched → audit
```

### What the model does, and does not

It receives the request, the stated purpose if any, and the taxonomy — all delimited and escaped,
as data. It returns one JSON object in a closed shape: intent, specialty refs (and whether they
are alternatives), languages, a named place, whether "nearest" was meant, a weekly window, a
relevance hint, and a policy concern flag.

- A ref it was not given, a malformed value or anything that is not the shape: **not
  understood**. Nothing is searched on a guess, and one invented ref distrusts the whole reply.
- Anything else it writes — an "answer", a user id, "include unverified" — is dropped unread.
- It never sees coordinates, profiles or results.
- **It writes nothing the person reads.** The answer is the search result plus reasons rendered
  by `explainMatch`, which is passed only `matchedOn`, `notMatched` and the distance. So the
  assistant cannot state a price, an availability window or a capability the data does not hold.

The reasons are codes with data (`matched.specialty`, `matched.languages`, `matched.place`,
`matched.distance`, `matched.availability`, `not_matched.specialty`), for the client to phrase in
the reader's language. Specialty labels arrive in the requested locale.

### Lawful use: rules decide, the model only asks

The request and any stated purpose run through `matchingTextRules` — the same deterministic
detector that screens missions (`mission-policy.rules.ts`) — **before any model call**. A match
is `refused`, pointing to `kb-policy-prohibited-requests`; nothing is searched. The rule and
ruleset version go to the audit row and not to the caller, because naming the rule that fired is a
map of how to word around it. The model's relevance hint is screened the same way.

The rules are a phrase list, so they can be wrong in both directions. A false positive costs a
refused search that the person can still reach by posting a mission, which a moderator reads. A
false negative is still bounded: discovery lists public profiles only, and every mission is
moderated before any investigator sees it.

The model's `policyConcern` **never refuses anyone** (non-negotiable 4). It asks one question —
what the search is for — and only when no purpose has been given. The stated purpose is then
screened by the rules like the request. The concern is recorded in the audit row beside the
outcome, for review.

### Clarification only when it changes the answer

At most one question, in this order:

| Question | Asked when | Not asked when |
|---|---|---|
| `purpose` | The model is concerned and no purpose was given | A purpose was given |
| `location` | "Nearest" was meant and there is neither a point nor a named place | A point or a place exists — or "nearest" was not meant: then everywhere is searched and `assumptions: ['location.anywhere']` says so |
| `specialty` | The model marked the specialties as alternatives, and **someone shown lacks one of them** — so choosing would change who is listed. Options are the alternatives, labelled | Everyone shown offers every alternative; or the person already picked (`taxonomyNodeIds` in the request) |

The specialty check is judged on the results shown: if every one of them offers every
alternative, picking any alternative lists the same people.

### Statuses

`results` · `no_results` (a search ran; `searchedFor` states what) · `clarification` · `refused` ·
`not_discovery` (not a request to find anyone — ask the knowledge assistant) · `not_understood`.

### Audit

One row per tool call (`ai.tool.list_taxonomy`, `ai.tool.search_investigators`) with the filter
**names** used — never their values, since a place or a point can be the subject's — and one
`assistant.discovery_answered` row with the outcome, counts, any policy concern or rule ids, the
model and the prompt version (`discovery-proposal-v1`). Never the request, the purpose or the
results.

### Request

`question` (3–2000), and optionally `locale`, `near` (`{ lon, lat }`, in the body — never a URL),
`radiusKm` (0–100, default 0: a service area must cover the point), `taxonomyNodeIds` (the
specialty picked from a clarification) and `purpose` (the answer to a purpose question). The
request is stateless and is not stored; the question and purpose are sent to the model provider
(see `kb-customer-ai-assistant`).

## Tenancy

Tools run in the caller's execution context; `ToolRunner` refuses outside one. No tool input names
a workspace, tenant, user or membership — `assertRegistrable` refuses the declaration, and the
strict input refuses the argument. Investigator profiles are tenant-owned with a public
projection (`tenancy.md`), so a search returns the same public results from any workspace.
Showing each profile's agency waits for agency-owned profiles (T-087).

## Not built here

- `getInvestigatorProfile` and `checkAvailability`, listed in the discovery skill, have no caller
  yet. They arrive with the first flow that needs them — the conversational orchestrator (T-048,
  T-095) — rather than as tools nothing calls.
- Routing one conversation between knowledge and discovery. Two endpoints for now;
  `not_discovery` tells the client to use the knowledge answer.
- Semantic relevance. Profiles have no embeddings; the lexical ranker is explainable and cannot
  add anyone, and an embedding ranker would have to keep both properties.
- Quality ranking (rating, response time): no inputs exist until reviews (T-037).
