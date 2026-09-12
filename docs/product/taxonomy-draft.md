# Taxonomy — top two levels (draft for review)

Feeds **T-053**. Per ADR-0007 this single tree is used by both sides: a mission declares the
node it falls under, an investigator declares the nodes they practise in, and matching is an
exact join that walks descendants.

**This is a draft for review by someone with private-investigation domain and licensing
knowledge.** The structure and the risk banding are the parts I am confident about. Which
services are lawful and licensable in each launch jurisdiction is not something to take from
this document.

## The taxonomy is a policy instrument

A node that exists is an invitation to post that kind of mission. The tree therefore does two
jobs: it makes matching work, and it shapes what people ask for.

Each level-2 node carries a **risk band** that drives moderation queue ordering (T-051) and the
structured questions asked at mission creation (`plan.md` §10).

| Band | Meaning |
|---|---|
| `standard` | Ordinary commercial work. Normal review |
| `elevated` | Involves an identifiable private individual, or sensitive records. Additional questions; prioritised in the queue |
| `high` | Locating or observing a private individual. **Lawful basis must be stated and is reviewed every time** |

---

## 1. `corporate` — Corporate and commercial

| Node | Band |
|---|---|
| `due-diligence` — pre-acquisition, counterparty, vendor, investor | `standard` |
| `fraud` — internal, procurement, financial statement | `standard` |
| `internal-investigation` — misconduct, grievance, whistleblower | `elevated` |
| `ip-protection` — counterfeiting, trade-secret misuse, brand abuse | `standard` |
| `business-intelligence` — company profiles, ownership structures, market entry | `standard` |

`internal-investigation` is `elevated` because the subject is an identifiable employee, and
employment and data-protection law constrains it heavily.

## 2. `legal-support` — Litigation and legal support

| Node | Band |
|---|---|
| `litigation-support` — evidence gathering for proceedings | `elevated` |
| `witness` — locating and interviewing witnesses | `high` |
| `service-of-process` — serving legal documents | `high` |
| `records-research` — court, land registry, corporate filings | `standard` |
| `expert-sourcing` — identifying and vetting expert witnesses | `standard` |

`witness` and `service-of-process` are `high` because both involve locating a private
individual — legitimate with a legal basis, and exactly the shape of a prohibited request
without one.

## 3. `insurance` — Insurance and claims

| Node | Band |
|---|---|
| `claim-investigation` — validity, documentation, circumstances | `elevated` |
| `claim-fraud` — suspected fraudulent claims | `elevated` |
| `claim-surveillance` — observation in support of a claim | `high` |
| `incident-reconstruction` — accident and incident analysis | `standard` |

`claim-surveillance` is `high`. Insurance surveillance is a mainstream, lawful service in many
jurisdictions and it is also surveillance of a private individual. It needs the instructing
party's standing established every time.

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
| `asset-search` — lawful asset identification | `elevated` |
| `judgment-enforcement` — supporting enforcement of a judgment | `elevated` |
| `financial-profiling` — for litigation or transaction purposes | `elevated` |
| `crypto-tracing` — blockchain analysis | `standard` |

All `elevated` at minimum. Protected financial records are prohibited outright — see the Lawful
Use Policy — so the boundary between lawful asset search and unlawful records access must be in
the structured questions, not left to the investigator to discover mid-mission.

## 6. `digital` — Digital and open-source

| Node | Band |
|---|---|
| `osint` — open-source intelligence on companies or public figures | `standard` |
| `online-fraud` — scams, fraudulent sellers, impersonation | `standard` |
| `reputation` — defamation, coordinated attacks, brand damage | `elevated` |
| `digital-footprint` — publicly available online presence of an individual | `high` |

`digital-footprint` is `high` and is the most likely node on this tree to be misused. Compiling
a person's online presence is trivially the groundwork for stalking, and it looks identical to
legitimate pre-litigation research. Strong questions, and it may be worth deferring this node
entirely until the moderation flow has been running for a while.

## 7. `personal` — Personal and family

**The highest-risk branch on the tree.** Every node involves an identifiable private
individual, and every one has a legitimate use and an abusive one that reads almost the same in
a mission description.

| Node | Band |
|---|---|
| `missing-person` — locating a missing individual | `high` |
| `family-law` — supporting custody or family proceedings | `high` |
| `reunification` — adoption, estranged family, with consent pathways | `high` |

All `high`, all requiring a stated legal basis and relationship to the subject, all routed to a
moderator every time regardless of queue configuration.

## 8. `security` — Security and protective

| Node | Band |
|---|---|
| `threat-assessment` — assessing a threat against a client | `elevated` |
| `counter-surveillance` — detecting surveillance against a client (TSCM) | `standard` |
| `security-audit` — physical and procedural review | `standard` |

This branch is *defensive* — the client is the subject. `counter-surveillance` is the mirror
image of the stalkerware concern and is a useful category to have visible, including for app
store reviewers.

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

## Open questions for review

1. **Licensing.** Which nodes require a specific licence in each launch jurisdiction? This
   determines what an investigator may declare, not merely what they say they do.
2. **`digital-footprint`** — include at launch with strong questions, or defer?
3. **`personal` branch** — launch with it, or start commercial-only and add it once moderation
   is proven? Starting narrower is easier than withdrawing a category later.
4. **Depth.** Is two levels enough for matching, or do the level-2 nodes need children before
   launch? Investigators declare precisely; customers choose coarsely. Two may be sufficient
   initially.
5. **Structured questions per node** — `plan.md` §10 requires them and the `high` band is
   meaningless without them.
6. **Slug stability.** These slugs become permanent ids (ADR-0007: never deleted, only
   deprecated). Worth getting the naming right before seeding.
