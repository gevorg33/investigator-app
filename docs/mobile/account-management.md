# Account management — store requirements

Both stores treat account control as a hard requirement. These are the most common avoidable
rejections, and they are cheap to get right from the start.

## Required flow

```
Sign up
  ↓  Privacy Policy + Terms shown and accepted here (legal-consent)
Authentication
  ↓
Application
  ↓
Profile / Settings
  ├── Privacy Policy         always reachable
  ├── Terms & Conditions     always reachable
  ├── Account settings
  ├── Sign out               ONE LEVEL DEEP, plainly labelled
  └── Delete account         in-app, complete
```

## Sign out

- One level deep from the main navigation, in Profile or Settings
- Labelled "Sign out" or "Log out" — not hidden behind an icon, not inside a submenu
- Clears the session server-side, not only locally
- **Clears the query cache and any in-memory sensitive state** — see the `mobile-screen` skill
- Available whenever a session exists, including mid-flow

Burying sign-out is a documented rejection cause and there is no upside to it.

## Delete account

**Apple 5.1.1(v):** apps allowing account creation must let the user **initiate deletion from
inside the app**. Deactivation alone is a rejection. The customer-service exception applies
only to highly regulated industries — **we do not rely on it**.

**Google Play** additionally requires a **web-accessible deletion route** for users who no
longer have the app installed, declared in the Play Console.

Our implementation:

1. In-app entry point in Settings, reachable without contacting support
2. A confirmation step explaining consequences — **one** step, not a maze
3. Explains plainly what is deleted and what is legally retained (financial records, evidence
   within a completed assignment, consent records) and why
4. Blocks deletion with an explanation where a live assignment or an open dispute exists,
   offering the path to resolve it — a block with a reason is acceptable; a silent failure is not
5. Executes through the deletion workflow (T-022 / legal hold), never by direct record edits
6. Confirms completion to the user
7. A parallel web route at the same standard

**Deletion must reach personal data**, not merely disable sign-in. A "deleted" account that
still resolves is a data-protection problem as well as a store one.

## Legal documents

Reachable in two places, both required:

- **During registration**, before acceptance — `legal-consent` records which version and which
  locale the user was shown
- **From Settings**, permanently, without needing to sign out

Links must resolve to the real published documents, not placeholders. A broken or `TODO` policy
URL is an immediate rejection at both stores and is checked in CI (T-043).

## Contact and support

Both stores require a working support route. An address that bounces or a page that 404s fails
review.

## Store forms

The Apple App Privacy labels and the Play Data Safety form must match actual behaviour.
Declaring less than the app collects is the serious failure — repeated, it becomes an
account-level problem, not a single rejection.

Both are reviewed as part of the pre-submission audit whenever data collection changes.
