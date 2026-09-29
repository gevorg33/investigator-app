# Notifications (T-036)

A person is told when something happens that concerns them and that they did not do themselves: in
the app (the notification centre) and by email. What is built today is the delivery core and the
centre's API; the centre's screen, browser push and most event types are follow-ups (see
[Not built](#not-built)).

## What is sent, to whom

Every notification comes from an outbox event (`jobs.md`). `modules/notifications/kinds.ts` decides
what each status change means; nothing else does.

| Event | Change | Kind | To |
|---|---|---|---|
| `mission.status_changed` | `UNDER_REVIEW → QUOTED` | `mission_published` | customer |
| `mission.status_changed` | `UNDER_REVIEW → DRAFT` | `mission_returned` | customer |
| `mission.status_changed` | `* → REJECTED` | `mission_rejected` | customer |
| `mission.status_changed` | `* → ASSIGNED` | `assignment_new` | investigator |
| `assignment.status_changed` | `PENDING_ACCEPTANCE → ACCEPTED` | `assignment_accepted` | customer |
| `assignment.status_changed` | `* → CANCELLED`, by the investigator | `assignment_declined` | customer |
| `assignment.status_changed` | `* → REPORT_SUBMITTED` | `assignment_report_ready` | customer |

A person's own moves tell nobody — they know. The outbox payload carries `actorKind` so a decline
by the investigator can be told apart from a cancellation by anyone else.

**A notification says what kind of thing happened and links to it — never the thing.** No mission
title, no reason text, no names: an email is read on lock screens, forwarded and archived by
providers we do not control. The row holds a kind, the subject's id and a relative `href`
(`notifications_href_relative` refuses anything else), and the email says the same as the row.

## How it travels

```
outbox event ─► outbox.deliver (producer's context)
                  NotificationTrigger ─► notifications.fan_out   (system job, key <event>-fan-out)
                                           reads both parties; each ACTIVE member ─►
                                         notifications.deliver   (as the recipient, in their workspace)
                                           INSERT notification (unique per event, recipient)
                                           email not turned off? ─►
                                         notifications.email     (as the recipient)
                                           address confirmed? ─► Mailer.send, idempotency key = job key
```

- **Fan-out is a system job.** The producer's context cannot answer "who else is concerned" — a
  moderator cannot read the customer's rows, and should not. The fan-out reads only ids.
- **Everything after it runs as the recipient**, in the recipient's workspace, re-read when the job
  runs (T-082). Someone who has left that workspace is not notified there.
- **Idempotent per (event, recipient, channel).** Each hop is its own job with its own key, claimed in
  `job_runs` with its effect; the centre row is also unique on `(tenant_id, event_id, recipient_id)`;
  the email's job key is sent to Resend as `Idempotency-Key`. A job key is unique **per workspace,
  not per command** — the fan-out's key is `<event>-fan-out` because `outbox.deliver` has already
  claimed the bare event id in the same system context.
- The queue is `notifications`, alongside `events`, in the same worker process.

## Email

`common/mail`: templates are the `email` namespace of `@investigator/i18n` (en, ru, hy), rendered by
`renderEmail` in the recipient's `users.locale`; unknown locales fall back to English. Account mail
(verification, password reset, invitations) now uses the same templates and locale.

| Setting | |
|---|---|
| `RESEND_API_KEY` | Sends through Resend. Unset: the development transport writes mail to the log and sends nothing |
| `MAIL_FROM_ADDRESS` | The one sender for every email. Required with the key. In Resend's sandbox it must be `onboarding@resend.dev` until the domain is verified |
| `REVIEW_REQUEST_EMAIL_OVERRIDE` | Every email goes to this address instead. For the sandbox, which only delivers to the account owner. **The API refuses to start with it in production** |

The API logs which transport it chose at boot (`Mail` context).

**Transactional vs activity.** Account mail is transactional: it always goes, and its footer says so.
Notification mail is `activity`: its footer and the `List-Unsubscribe` / `List-Unsubscribe-Post`
headers (RFC 8058 one-click) carry a link that turns the category off. An address not yet confirmed
receives no notification mail.

## Preferences and unsubscribe

`notification_preferences` holds only choices that were made; no row means the default, **on**.
In-app is always on — it is the centre — so only `email` is stored, and the only category is
`activity`. Both are CHECK-constrained; a new category or channel is a migration.

The unsubscribe link is `GET /api/v1/notifications/unsubscribe?token=…`. The token is the
recipient's user, workspace and membership ids and the category, signed with HMAC-SHA256 under a key
derived from `SESSION_SECRET` for this purpose alone. It is not stored and does not expire — a link in
last year's email must still work. It can do exactly one thing: turn one category of one person's
email off in one workspace.

- **GET only asks.** Mail scanners open links before people do; opening changes nothing. The page's
  button POSTs, as does a mail client's one-click unsubscribe.
- **POST re-reads the person's membership** (`WorkspaceResolver.forJob`) and writes the preference
  as them, audited `notifications.unsubscribed`. A link that does not verify, or whose person has left
  the workspace, does nothing and says so.
- The pages are the API's own: localized to the person, `no-store`, `no-referrer`, `noindex`, and a
  CSP of `default-src 'none'`.

## API

All behind `ActorGuard`, in the request's workspace, and only ever the caller's own rows — row-level
security shows a person their notifications and nobody else's, not even another member of their
agency.

| Route | |
|---|---|
| `GET /notifications?cursor=` | Newest first, 20 a page (cursor rule: `docs/api/pagination.md`) |
| `GET /notifications/unread` | `{ count }` |
| `POST /notifications/:id/read` | 204. Another person's id is `NOT_FOUND`, as one that does not exist |
| `POST /notifications/read-all` | 204 |
| `GET /notifications/preferences` | Every preference, defaults included |
| `PUT /notifications/preferences` | `{ category, channel, enabled }`, audited `notifications.preference_changed` |

## Data

| Table | Class | Policy |
|---|---|---|
| `notifications` | Tenant-owned, own user | `own_notifications`: `tenant_id` and `recipient_id` are the context's own, or platform access |
| `notification_preferences` | Tenant-owned, own user | `own_preferences`: the same on `user_id` |

Retention: `docs/compliance/retention.md`.

## What holds it

- `notifications.kinds.spec.ts` — every status change and what it tells whom; the unsubscribe token.
- `notifications.jobs.spec.ts` — fan-out to active members only; delivery once, as the recipient;
  email off and unconfirmed addresses; untrusted payloads refused for good; end to end through Redis.
- `notifications.service.spec.ts` — paging, counts, marking, another's id, defaults, audit,
  unsubscribe done / invalid / left the workspace.
- `notifications.controller.spec.ts` — guards, validation, the unsubscribe pages and their headers.
- `email.spec.ts` — every template in every locale, escaping, Resend's request, the transport choice.
- The isolation matrix covers both tables.

## Not built

- The notification centre's screen and email settings in the app — T-169.
- Browser push — T-170.
- Notifications for quotes received, new messages, reports and expiring verification — T-171.
