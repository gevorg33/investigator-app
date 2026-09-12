# Taxonomy — top two levels (draft for review)

Feeds **T-053**. Per ADR-0007 this single tree is used by both sides: a mission declares the
node it falls under, an investigator declares the nodes they practise in, and matching is an
exact join that walks descendants.

**Revised for the narrowed scope** — public and authorised information only, no surveillance.
All 35 nodes are retained; what changed is what each one *means*. One rename:
`claim-surveillance` → `claim-verification`.

**This is a draft for review by someone with private-investigation domain and licensing
knowledge.** The structure and the risk banding are the parts I am confident about. Which
services are lawful and licensable in each launch jurisdiction is not something to take from
this document.

## The taxonomy is a policy instrument

A node that exists is an invitation to post that kind of mission. The tree therefore does two
jobs: it makes matching work, and it shapes what people ask for.

Each level-2 node carries a **risk band** that drives moderation queue ordering (T-051) and the
structured questions asked at mission creation (`plan.md` §10).

Because method is now fixed — public or authorised information only — the bands grade by
**who the subject is and how sensitive the data is**, not by how intrusive the technique is.

| Band | Meaning |
|---|---|
| `standard` | Subject is a company, or a public figure acting in a public capacity |
| `elevated` | Subject is an identifiable private individual, or the data is sensitive |
| `high` | Subject is a private individual **and the customer must demonstrate standing** — a legal interest, proceedings, or an authorising relationship |

## Two sources, one scope

Every node draws on one or both:

- **Public information** — registers, filings, court records, published material, openly
  available online content
- **Authorised information** — material the requesting party is legally entitled to provide and
  use, including access to **their own** premises, systems, records and property

The second limb is why security and counter-surveillance work remains in scope: a client
commissioning inspection of their own site authorises it by definition. The subject is the
client.

---

## 1. `corporate` — Corporate and commercial

| Node | Band |
|---|---|
| `due-diligence` — pre-acquisition, counterparty, vendor, investor | `standard` |
| `fraud` — internal, procurement, financial statement | `standard` |
| `internal-investigation` — misconduct, grievance, whistleblower, from employer records and authorised interviews | `elevated` |
| `ip-protection` — counterfeiting, trade-secret misuse, brand abuse | `standard` |
| `business-intelligence` — company profiles, ownership structures, market entry | `standard` |

`internal-investigation` is `elevated` because the subject is an identifiable employee, and
employment and data-protection law constrains it heavily.

## 2. `legal-support` — Litigation and legal support

| Node | Band |
|---|---|
| `litigation-support` — records and documentary evidence for proceedings | `elevated` |
| `witness` — locating witnesses from public records; consensual interviews | `high` |
| `service-of-process` — locating a recipient from public records to support service | `high` |
| `records-research` — court, land registry, corporate filings | `standard` |
| `expert-sourcing` — identifying and vetting expert witnesses | `standard` |

`witness` and `service-of-process` are `high` because both locate a private individual.
Locating from public records is in scope; the standing that justifies looking is what the band
requires the customer to demonstrate.

## 3. `insurance` — Insurance and claims

| Node | Band |
|---|---|
| `claim-investigation` — validity and circumstances from records and declarations | `elevated` |
| `claim-fraud` — records, filings and pattern analysis across claims | `elevated` |
| `claim-verification` — corroborating a claim against public and authorised records | `elevated` |
| `incident-reconstruction` — accident and incident analysis | `standard` |

**`claim-surveillance` was renamed `claim-verification`, and it is a different service.**
Observation of claimants is out of scope. What remains is corroborating a claim against public
records and against material the insurer is authorised to hold — a real and substantial
service, but not the field surveillance the old name promised.

The rename is deliberate. A node called `claim-surveillance` that delivers records work
misleads customers, attracts investigators who are not a fit, and reads badly to an app store
reviewer regardless of its description.

## 4. `screening` — Background and screening

| Node | Band |
|---|---|
| `pre-employment` — candidate verification within employment law | `elevated` |
| `tenancy` — prospective tenant checks | `elevated` |
| `counterparty` — business partners, suppliers, franchisees | `standard` |
| `credential-verification` — qualifications, licences, professional standing | `standard` |

Screening is consent-dependent almost everywhere. The structured questions must capture whether
the subject has consented, and the absence of consent should block rather than merely flag.

## 5. `financial` — Financial and asset

| Node | Band |
|---|---|
| `asset-search` — asset identification from public registers and filings | `high` |
| `judgment-enforcement` — records research supporting enforcement | `high` |
| `financial-profiling` — from public filings and authorised disclosure | `elevated` |
| `crypto-tracing` — blockchain analysis | `standard` |

`asset-search` and `judgment-enforcement` move to `high`: both target a private individual's
finances, and both require the customer to show standing — a judgment, proceedings, or a
recognised legal interest.

Protected financial records remain prohibited outright. The boundary between a public register
and a restricted record must be in the structured questions, not left to the investigator to
discover mid-mission.

## 6. `digital` — Digital and open-source

| Node | Band |
|---|---|
| `osint` — open-source intelligence on companies or public figures | `standard` |
| `online-fraud` — scams, fraudulent sellers, impersonation | `standard` |
| `reputation` — defamation, coordinated attacks, brand damage | `elevated` |
| `digital-footprint` — publicly available online presence of an individual | `high` |

`digital-footprint` stays `high` and remains the most likely node here to be misused. Public
sources do not make it safe: compiling a person's scattered online presence into a profile is
itself a regulated processing activity, and it is trivially the groundwork for stalking while
reading identically to legitimate pre-litigation research.

Narrowing the scope to public data does **not** resolve this node. If anything it raises its
prominence, since it is now squarely within the methodology rather than at the edge of it.

## 7. `personal` — Personal and family

**The highest-risk branch on the tree.** Every node involves an identifiable private
individual, and every one has a legitimate use and an abusive one that reads almost the same in
a mission description.

| Node | Band |
|---|---|
| `missing-person` — records-based tracing | `high` |
| `family-law` — records and authorised documents for active proceedings | `high` |
| `reunification` — records tracing with consent pathways | `high` |

All `high`, all requiring stated standing and a relationship to the subject, all routed to a
moderator every time regardless of queue configuration.

Under the narrowed scope this branch is **records-based tracing only**. That is a genuine
service and a much weaker one than customers expect: most real missing-person work involves
going and looking. The customer-facing copy must set that expectation before a mission is
submitted, not after a report disappoints.

## 8. `security` — Security and protective

| Node | Band |
|---|---|
| `threat-assessment` — assessing a threat against the client, from public sources | `elevated` |
| `counter-surveillance` — inspecting the client's own premises and devices (TSCM) | `standard` |
| `security-audit` — review of the client's own site and procedures | `standard` |

This branch is *defensive* — **the client is the subject**, and the client authorises
inspection of their own premises, devices and procedures. That is the "authorised information"
limb of the scope, not an exception to it.

`counter-surveillance` is the mirror image of the stalkerware concern and is a useful category
to have visible, including for app store reviewers.

---

## Deliberately absent

Not oversights. Each maps to something the Lawful Use Policy prohibits, and creating the node
would invite the request:

- **Infidelity, partner investigation, loyalty tests.** Excluded, and now stated as a position
  in the Lawful Use Policy rather than left as an absence. Three reasons, and the first is
  decisive: Google Play's stalkerware policy prohibits tracking a partner **even with their
  consent**, so the category and the mobile app cannot both exist. It would also contradict our
  own prohibition on surveillance without lawful basis — a platform cannot ban stalking on one
  page and sell partner monitoring on another. And a mission description cannot distinguish a
  genuine concern from coercive control; both read identically.

  Legitimate adjacent work is **not** excluded: where there are actual proceedings — divorce,
  custody, financial disclosure, enforcement — the customer has standing and the work belongs
  under `personal/family-law` with that basis stated. The test is standing, not the
  relationship
- **Locating a person** as a general service — only via `missing-person`, `witness`,
  `service-of-process` or `judgment-enforcement`, each of which establishes standing
- **Phone, financial, medical or telecommunications records** — prohibited outright
- **Device, account or communications access** — prohibited outright
- **Covert monitoring or tracking of a person** — prohibited outright, and would also breach
  Google Play policy (`mobile-store-compliance`)

## What the revision changed

The categories survive because the coverage areas are still real; the **subtext** changed. Each
node now describes work done from public records or from information the requesting party is
authorised to provide — including access to their own premises and systems.

| Kind of change | Nodes |
|---|---|
| Renamed, because the name promised a method we do not offer | `claim-surveillance` → `claim-verification` |
| Redefined as records-based | `witness`, `service-of-process`, `claim-investigation`, `claim-fraud`, `litigation-support`, `internal-investigation`, `missing-person`, `family-law`, `reunification`, `financial-profiling`, `threat-assessment` |
| Reband, on the new axis | `asset-search` and `judgment-enforcement` → `high`; `claim-verification` → `elevated` |
| Clarified as client-authorised, not an exception | `counter-surveillance`, `security-audit` |

Two consequences worth carrying into the product, not just the tree:

**`personal` is now the weakest branch**, and it is where consumer demand actually concentrates.
Records-based tracing is a genuine service and a much smaller one than customers imagine.
Expectation-setting belongs in the mission form, before submission.

**`digital` is now the methodology, not a side branch.** `osint` and `digital-footprint`
describe how most work on this platform is done. That may justify restructuring the tree around
sources — records, corporate, online — rather than leaving OSINT as one domain among eight.

## Open questions for review

1. **Licensing.** Which nodes require a specific licence in each launch jurisdiction? This
   determines what an investigator may declare, not merely what they say they do.
2. **`digital-footprint`** — include at launch with strong questions, or defer?
3. **`personal` branch** — launch with it, or start commercial-only and add it once moderation
   is proven? Starting narrower is easier than withdrawing a category later.
4. **Depth.** Is two levels enough for matching, or do the level-2 nodes need children before
   launch? Investigators declare precisely; customers choose coarsely. Two may be sufficient
   initially.
4a. **Should `digital` be promoted or the tree restructured by source?** Under the narrowed
   scope, OSINT is the method for most nodes rather than a category beside them.
4b. **Does `personal` launch at all**, given how much weaker records-only tracing is than what
   customers expect from that branch?
5. **Structured questions per node** — `plan.md` §10 requires them and the `high` band is
   meaningless without them.
6. **Slug stability.** These slugs become permanent ids (ADR-0007: never deleted, only
   deprecated). Worth getting the naming right before seeding.
