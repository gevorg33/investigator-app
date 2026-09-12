# Mobile privacy requirements

Companion to the Privacy Policy in `docs/compliance/`. That document is the legal authority;
this one records what the **stores** additionally require and how the app satisfies it.

## Apple

**Privacy manifest** — `PrivacyInfo.xcprivacy` is required, declaring required-reason API use
and data collection. In Expo SDK 50+ it is configured as `expo.ios.privacyManifests` in
`app.json` and written during prebuild.

It is needed even for a simple app: the React Native runtime itself touches required-reason
APIs — `UserDefaults` via AsyncStorage, file timestamps via image caching, system boot time via
some networking libraries. Third-party SDKs must ship their own manifests; most major ones do.

**App Privacy labels** — declared in App Store Connect, must match real behaviour.

**App Tracking Transparency** — required only if we track users across apps or share data with
data brokers. **We do neither.** If that ever changes, ATT becomes mandatory and the answer
here changes with it.

## Google

**Data Safety form** — declared in the Play Console: what is collected, why, whether it is
shared, whether it is encrypted in transit, and whether deletion can be requested. Must match
real behaviour.

**Target API level** — new apps and updates must target **Android 16 (API 36)** as of
**31 August 2026**; extensions ran to 1 November 2026. This changes annually — verify the
current requirement before every release.

## What the app actually collects

Declared consistently across both stores and the Privacy Policy:

| Data | Why | Shared? |
|---|---|---|
| Account identifiers (email, name) | Authentication, the marketplace relationship | No |
| Messages | Assignment communication | With the other assignment participant only |
| Photos, video, files | Evidence the investigator captures | With the other assignment participant only |
| Coarse/precise location | Tagging where evidence was captured, where lawful | Attached to the evidence only |
| Device and diagnostic data | Crash reporting, security | Processor only |

**Not collected:** contacts, calendar, health, browsing history, advertising identifiers.
**No advertising SDKs. No cross-app tracking. No data brokers.**

## Third parties who see data

The payment provider (payments), the media provider (private file storage), error monitoring,
and infrastructure. Each is a processor under contract, listed in the Privacy Policy, and
declared in both store forms.

## Third-party data — the unusual part of this product

Evidence and mission descriptions contain personal data about people who are **not users** and
have no relationship with the platform. This is the most significant privacy issue in the
product and it is not something the store forms have a field for.

It is handled in the Privacy Policy and is an open question for counsel — see
`docs/compliance/counsel-brief.md` §3 and questions 8–11. The store declarations describe data
collected **from the app's user**; they do not and cannot resolve the third-party position.

## In-app disclosures

- Permission purpose strings say what the data is used for, in the user's language
- The privacy policy link is reachable during registration and from Settings
- Evidence is stored privately with no public URL and served only through short-lived
  authorised links (`cloudinary-media`)
- Notification content reveals nothing sensitive
