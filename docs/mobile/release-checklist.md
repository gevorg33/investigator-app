# Mobile release checklist

Run in full before **every** submission to either store.

**Step zero, always:** re-read the current official requirements. Apple's App Review
Guidelines and Google's Developer Program Policy change, and the previous submission's answers
may no longer be correct. Do not run this checklist from memory or from a third-party summary.

---

## 0. Policy re-verification

- [ ] Apple App Review Guidelines re-read for changes since last submission
- [ ] Google Developer Program Policy re-read, **including Stalkerware and Monitoring**
- [ ] Current Play target API level requirement confirmed (annual change)
- [ ] Any policy change since last release recorded in `app-store-compliance.md`

## 1. The stalkerware position

The largest rejection risk for this product. See `app-store-compliance.md`.

- [ ] App performs no monitoring of any device but its own user's
- [ ] **No background location requested anywhere**
- [ ] Listing copy contains none of: track, monitor, spy, surveil, catch
- [ ] Screenshots show hiring and case communication, not observation of a person
- [ ] Reviewer notes submitted, stating what the app is and is not
- [ ] Lawful use policy and prohibited activities linked in review notes

## 2. Account management

- [ ] Sign out present, one level deep, plainly labelled
- [ ] Sign out clears the server session and the local cache
- [ ] **In-app account deletion**, complete — not deactivation (Apple 5.1.1(v))
- [ ] **Web deletion route** live and declared in the Play Console
- [ ] Retained-by-law data explained at deletion
- [ ] Deletion blocked with a clear reason during a live assignment or open dispute

## 3. Legal documents

- [ ] Privacy Policy URL resolves — not a placeholder, not a 404
- [ ] Terms URL resolves
- [ ] Both reachable **during registration** and from Settings
- [ ] Acceptance recorded with version and locale (`legal-consent`)
- [ ] Documents are the counsel-approved versions, not the drafts

## 4. Permissions

- [ ] Every declared permission maps to a shipped feature
- [ ] Each requested in context, at point of use
- [ ] Purpose strings specific, localised, no placeholders
- [ ] Denial path works for every permission; no dead ends, no nag loops
- [ ] Nothing requested from the "not requested" list in `permissions.md`

## 5. Privacy declarations

- [ ] `PrivacyInfo.xcprivacy` present and accurate (Expo `privacyManifests`)
- [ ] Third-party SDKs ship their own manifests
- [ ] Apple App Privacy labels match actual collection
- [ ] Play Data Safety form matches actual collection
- [ ] ATT: still not tracking across apps — if that changed, ATT is now required

## 6. Functionality

- [ ] No placeholder screens, dead links, or "coming soon"
- [ ] Offline and network-error states handled everywhere
- [ ] Works on the minimum supported OS version
- [ ] Deep links handle unauthenticated, wrong-role and not-found cases
- [ ] No crash on a fresh install with no data
- [ ] Demo account provided in review notes if any flow needs sign-in

## 7. User-generated content

Play's UGC policy applies: the app carries messaging, evidence and profile content. This is a
documented rejection cause and is easy to miss, because the requirements are about controls in
the app, not about the content itself.

- [ ] **In-app reporting** on messages, profiles, missions and assignments
- [ ] **Ability to block another user** — separate from reporting, and the one most often missing
- [ ] A moderation route exists and reports actually reach staff
- [ ] In-app content policy, or a link to it, reachable from the app
- [ ] Reports are acknowledged so the reporter knows the route works

## 8. Payments

- [ ] Investigator engagements are real-world services — **not** routed through IAP
- [ ] No digital-only purchase has been added that would require IAP
- [ ] Payment flows do not mislead about what is being bought

## 9. Accessibility and localisation

- [ ] Screen reader can operate every screen
- [ ] Dynamic type respected; no clipped text at large sizes
- [ ] Contrast meets AA
- [ ] All user-facing strings localised for en/ru/hy, purpose strings included

## 10. Build and configuration

- [ ] Play target API level meets the current requirement
- [ ] Bundle ID / package name correct for the environment
- [ ] **No development or staging URL in the production build**
- [ ] Production build points at production configuration
- [ ] No debug flags, verbose logging, or test credentials
- [ ] Version and build number incremented

## 11. Store listing

- [ ] Title, subtitle and description accurate and free of surveillance framing
- [ ] Screenshots current, correct sizes, no placeholder content
- [ ] Icon meets both stores' requirements
- [ ] Age rating and content rating reflect user-generated content and messaging
- [ ] Support URL and contact route work
- [ ] Keywords contain no surveillance terms

## 12. Security

- [ ] Tokens in platform secure storage
- [ ] No PII or evidence in device logs, analytics or crash reports
- [ ] Certificate/transport security not weakened for convenience
- [ ] Evidence reachable only via short-lived authorised links

---

## Outcome

Record the submission date, the build, what changed, and any policy question raised by the
reviewer. If a submission is rejected, record the reason here — a rejection reason is the
single most useful thing for the next release, and it is what stops the same cycle repeating.

| Date | Platform | Build | Outcome | Notes |
|---|---|---|---|---|
| _(none yet)_ | | | | |
