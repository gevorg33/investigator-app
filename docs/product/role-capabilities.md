# Role capabilities

What each role may do. The authoritative enforcement is the six-check procedure in
`.claude/skills/authorization/SKILL.md`; this is the product-level summary.

**A role check is never sufficient on its own.** "Is an investigator" does not mean "is *this*
assignment's investigator". Every capability below is additionally gated on resource
relationship and resource state.

## Customer

Manage own profile · create, edit and submit missions · view eligible investigator profiles ·
receive and compare quotes · accept a quote · pay · message the assigned investigator · upload
permitted documents · view authorised evidence and reports · request revisions · raise
disputes · review a completed assignment · export and delete own data.

Cannot: see another customer's mission, contact an unassigned investigator, see an
investigator's private notes or tasks, widen evidence access to a third party.

## Investigator

Manage professional profile · define service areas, specialties, services, languages and
availability · submit verification documents · discover eligible missions · submit quotes ·
accept assignments · update progress · create sources, notes, tasks and documents · upload
evidence · promote a document to evidence · author and version reports · message the customer
within assignment scope · view earnings and payout status.

Cannot: see missions they are not eligible for, see other investigators' quotes or prices, act
outside verified scope, delegate an assignment, share credentials, demote evidence to a
document.

**Both roles in one account.** Switching roles requires no new account and must not leak
cached data across the switch.

## Staff

Scoped, never blanket. A moderator is not a payments reviewer.

Review verification · review flagged missions · manage disputes · moderate profiles and
content · manage categories, translations and policies · review payments and payouts · suspend
accounts with an audited reason · access only data their specific scope permits.

Cannot: browse evidence without a recorded grant tied to a reason · edit evidence, reports,
audit entries or ledger rows · take an action outside their scope · act on an account where
they have a personal or commercial relationship.

**Staff evidence access is visible to the customer** in their access log. There is no
administrative mode that reads evidence silently.

## Visibility defaults

| Object | Default |
|---|---|
| Mission in `DRAFT` | Customer only |
| Mission after `QUOTED` | Eligible investigators; contact details withheld until assignment |
| Quote | Its investigator and the customer only |
| Evidence | Assignment participants, via an explicit grant |
| Report | Assignment participants; versions retained |
| Investigation notes | **Author only** unless deliberately shared |
| Investigation tasks | **Creator only** unless deliberately shared |
| Sources, documents | Assignment participants |
| Audit log | Staff within scope; the subject sees their own access log |

The two `private` defaults are deliberate. Working notes contain discarded lines of inquiry,
and a customer reading a dismissed hypothesis is the FACT/INFERENCE failure `evidence-integrity`
exists to prevent.
