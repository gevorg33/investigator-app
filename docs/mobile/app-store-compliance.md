# App Store and Play compliance — position and decisions

> **DEFERRED (ADR-0009).** Surveillance is now in scope, which conflicts with Play's
> Stalkerware and Monitoring policy. The position recorded below was written for a
> records-only platform and **is no longer accurate**. Retained for if scope narrows again.

Working rules: `.claude/skills/mobile-store-compliance/SKILL.md`.
Official policy is the source of truth; this file records **our decisions**, which is what
official policy cannot tell us.

Last reviewed against official documentation: **2026-09-13**. Re-verify before each release.

## What the companion app is

Per ADR-0004, mobile is a **companion**, not the product. It carries evidence capture,
notifications, messaging, quick status updates and light role actions. The customer,
investigator and admin workspaces are on the web.

This scope is a compliance advantage and should stay narrow deliberately.

## The stalkerware question — our position

Google Play's Stalkerware and Monitoring policy permits monitoring apps in only two
categories: parental monitoring of children, and enterprise device management. Tracking any
other person is prohibited **even with their consent**.

**Our position, to be stated in reviewer notes for both stores:**

> This app is the companion to a marketplace where customers hire licensed private
> investigators. It performs no monitoring of any kind. It does not install on, collect from,
> or track any device other than its own user's. Investigators use it to capture evidence on
> their own device and to communicate with their client. The platform's terms prohibit
> stalking, unauthorised tracking, spyware and unlawful recording, and every engagement is
> screened against that policy before publication.

Supporting evidence to link in review notes: the public lawful use policy, and the prohibited
activities section of the Terms & Conditions.

**Decisions that follow:**

| Decision | Reason |
|---|---|
| No background location, ever | Indistinguishable from what the policy bans |
| No device-to-device anything | The app touches only its own user's device |
| Listing copy never says track, monitor, spy, surveil, or catch | Reads as surveillance tooling |
| Screenshots show hiring and case communication, not observation of a person | Same |
| Reviewer notes submitted every time | Both stores read them; silence invites the wrong assumption |

## Account management

- **In-app account deletion**, complete, not deactivation (Apple 5.1.1(v))
- **Web-accessible deletion route** for users without the app installed (Play), declared in
  the Play Console
- **Sign out one level deep** in Profile/Settings, plainly labelled
- Legal documents reachable during registration **and** from Settings
- Retained-by-law data explained to the user at deletion, never silently kept

## Permissions we request, and why

| Permission | Why | Constraint |
|---|---|---|
| Camera | Capturing evidence in the field | Foreground, at point of use |
| Photo library | Attaching existing evidence | Limited selection preferred |
| Notifications | Assignment and message alerts | Requested after the user has reason to want them |
| Location | Tagging evidence capture location where lawful | **Foreground only** |

Not requested: background location, contacts, calendar, microphone (until audio evidence
exists as a feature), health, Bluetooth.

## Payments

Investigator engagements are real-world services performed by a human, so they are outside
in-app purchase requirements on both platforms and are paid through the platform's payment
provider.

If a digital-only feature or subscription is ever added, it falls under IAP on iOS. Resolve
before building, not after.

## Open items

- Age rating and content rating — pending, must reflect that user-generated content and
  messaging exist
- Play Data Safety form and Apple App Privacy labels — completed at first submission, kept in
  sync with actual collection
- Whether private investigation counts as a "highly regulated industry" for Apple's
  customer-service-deletion exception — **do not rely on it**; the full in-app flow is built
  regardless
