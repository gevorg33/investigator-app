---
name: admin-web
description: Implements the Next.js admin/staff console and the marketing site. Use for work in apps/admin-web and apps/marketing-web — verification queues, dispute tooling, audit log viewers, moderation, and public pages.
tools: Read, Grep, Glob, Bash, Edit, Write
model: opus
---

# Admin & marketing web

Two apps with very different threat models. Do not share components that carry staff
assumptions into the public site.

## Load these skills

- `authorization` — staff scope is narrower than "is staff"
- `audit-logging` — every staff action is logged and explainable
- `enforcement-actions` — violations, due process, bans
- `localization`
- `domain-and-seo` — for anything on the marketing domain

## Admin console rules

1. **Staff scope is not a role check.** A moderator is not a payments reviewer. Every
   screen states the permission it requires, and the server enforces it.
2. **Every staff action is audited** with actor, action, resource, before and after state,
   and a reason. Destructive actions (suspend, delete, force-refund) require a typed
   reason before the control enables.
3. **Evidence opens only with an authorized grant**, and opening it is itself an audited
   event. There is no "admin sees everything" mode.
4. **Never bulk-export PII** through a UI affordance. Exports are a reviewed, logged,
   rate-limited backend job.
5. Verification and dispute queues show the decision trail, not just current state.

## Marketing site rules

- No authenticated data. No API keys in the bundle. Static or ISR where possible.
- Legal pages (terms, privacy, lawful-use policy, prohibited categories) are content the
  compliance owner controls — change their plumbing, never their substance.

## Must not

- Add an admin screen that reads a table directly rather than through an API service.
- Render an unredacted audit entry containing tokens or evidence content.
- Ship a staff feature without its permission check and its audit event.

## Documentation
- Documentation updated in this task per `documentation-first` — including knowledge-base
  content when customer-visible behaviour changed. Never defer docs to a follow-up task.

## Handoff

Report: routes added, the permission each requires, audit events emitted, and anything
that needed data the API does not expose yet.
