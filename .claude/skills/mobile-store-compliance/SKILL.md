---
name: mobile-store-compliance
description: Apple App Store and Google Play review requirements for the companion app — the stalkerware policy risk specific to this product, account deletion, permissions, privacy manifests, target API levels, and the pre-submission audit. Use before implementing any mobile feature, adding a permission, touching auth or account management, and before every store submission.
---

# Mobile store compliance

> **DEFERRED (ADR-0009).** The mobile companion is not being built. Surveillance is in scope,
> which conflicts with Google Play's Stalkerware and Monitoring policy. This file is retained
> for if scope narrows again — do not start mobile work without checking ADR-0009 first.

Compliance is part of implementing a feature, not a stage before submission. A permission
added without a justification, or a sign-out buried two levels deep, becomes a rejection weeks
later and another review cycle.

**Official documentation is the source of truth.** Apple's App Review Guidelines and Google's
Developer Program Policy change. Third-party articles and this file both go stale — when a
requirement is unclear or looks changed, read the official page before deciding.

## The risk that matters most for this product

**Google Play's Stalkerware and Monitoring policy is the single largest rejection risk here,
and it is not obvious from a generic checklist.**

Play permits monitoring apps in **only two** categories: parental monitoring of children, and
enterprise device management. Everything else is prohibited — explicitly including tracking a
spouse **even with their knowledge and consent**. Apps must not present themselves as spying
or covert surveillance tools.

A reviewer seeing an app called "Investigator" with evidence-capture screenshots can
reasonably read it as surveillance tooling. What actually protects us:

1. **The app monitors nobody.** It is a marketplace companion — evidence capture by the
   investigator on their own device, notifications, messaging, status updates. It does not
   track a third party, install on a third party's device, or collect data from anyone but
   its own user.
2. **The platform prohibits exactly what the policy prohibits.** `plan.md` §1 and the lawful
   use policy ban stalking, unauthorised tracking, spyware and unlawful recording. Missions
   are screened. This is a compliance asset — link it in review notes.
3. **Metadata must not read as surveillance.** Store listing, screenshots, keywords and
   description describe hiring a licensed professional, never monitoring a person. Never use
   "track", "monitor", "spy", "surveillance" or "catch" in listing copy.
4. **No background location, ever.** Background location on this app would look exactly like
   what the policy bans. Foreground-only, while capturing evidence, with an explicit purpose
   string.

Write reviewer notes that state plainly what the app is and is not. Both stores read them.

## Account requirements — hard blockers

**Apple 5.1.1(v):** every app allowing account creation must let users **initiate account
deletion from inside the app**. Offering only deactivation is a rejection. Only
highly-regulated industries may route deletion through customer service — do not assume that
covers us. Build the full in-app flow.

**Google Play** requires account deletion too, including a **web-accessible deletion route**
for users who no longer have the app installed, declared in the Play Console.

Deletion must reach personal data, not just disable sign-in. What legally must be retained
(financial records, evidence in a completed assignment, consent records) is explained to the
user rather than silently kept — see the Privacy Policy and `legal-consent`.

**Sign out must be obvious.** Profile or Settings, one level deep, plainly labelled. Do not
bury it, and do not make sign-out require a confirmation maze.

Required navigation:

```
Profile / Settings
  ├── Privacy Policy          (link, always reachable)
  ├── Terms & Conditions      (link, always reachable)
  ├── Account settings
  ├── Sign out                ← obvious, one level deep
  └── Delete account          ← in-app, complete, not deactivation
```

Legal documents must also be reachable **during registration**, before acceptance —
`legal-consent` already requires recording which version and locale was shown.

## Permissions — least privilege, justified

Request nothing the app does not genuinely need, and request it **in context**, at the moment
of use, never in a startup sweep.

| Permission | Justified by | Rules |
|---|---|---|
| Camera | Evidence capture | Foreground only; requested at capture time |
| Photo library | Attaching existing evidence | Prefer a limited-selection picker over full-library access |
| Notifications | Assignment and message alerts | Ask after the user has reason to want them, not on first launch |
| Location | Tagging where evidence was captured | **Foreground only. Never background.** Coarse if it suffices |
| Microphone | Only if audio evidence ships | Do not request until the feature exists |

Every iOS purpose string says what the app does with the data, in the user's language, not a
placeholder. A generic purpose string is a rejection.

**Never request a permission for a feature that does not exist yet.** A declared permission
with no visible use is a review question you cannot answer well.

## Platform requirements with dates

- **Google Play target API level:** new apps and updates must target **Android 16 (API 36)**
  as of **31 August 2026**. Extensions were available to 1 November 2026. Verify the current
  requirement before a release — this changes annually.
- **Apple privacy manifest:** `PrivacyInfo.xcprivacy` is required, declaring required-reason
  API usage and data collection. In Expo SDK 50+ it is configured as
  `expo.ios.privacyManifests` in `app.json` and written during prebuild. The React Native
  runtime alone touches required-reason APIs (UserDefaults via AsyncStorage, file timestamps,
  system boot time), so the manifest is needed even for a simple app. Third-party SDKs must
  ship their own.
- **Apple App Privacy labels** and **Play Data Safety form** must both match what the app
  actually collects. A mismatch between the form and observed behaviour is a rejection and,
  repeated, an account-level problem.
- **App Tracking Transparency** applies only if we track across apps or share with data
  brokers. We should do neither — if that ever changes, ATT becomes mandatory.

## Before implementing any mobile feature, ask

```
Does this feature:
  collect user data?              → privacy labels, Data Safety, Privacy Policy
  require a permission?           → justification, purpose string, in-context request
  affect account management?      → deletion and sign-out flows still complete?
  affect payments?                → store payment rules — see below
  affect privacy disclosures?     → update both stores' declarations
  read as monitoring a person?    → stalkerware policy. Stop and reconsider
  need new legal documentation?   → docs/compliance, and re-acceptance if material
  change store metadata?          → listing, screenshots, age rating
```

If any answer is yes, handle it in the same task. Not later.

## Payments

Marketplace payments for real-world services rendered by a human are **not** in-app purchases,
and both stores permit external payment for them. Do not route investigator payments through
IAP.

The line matters: if we ever sell digital features, subscriptions, or unlockable in-app
content, those **do** require IAP on iOS. Keep the two clearly separate, and if a feature
blurs the line, resolve it before building.

## Pre-submission audit

Before every submission, run the audit in `docs/mobile/release-checklist.md`. It begins by
re-reading the current official requirements, because the previous submission's answers may
no longer be correct.

## Must not

- Request background location
- Present the app as monitoring, tracking or surveillance, in the product or its listing
- Ship deactivation in place of deletion
- Bury sign-out
- Declare a permission a feature does not use
- Let the privacy labels or Data Safety form drift from actual behaviour
- Rely on a third-party article over the official policy page
