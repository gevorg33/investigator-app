# Mobile permissions

Least privilege. Each permission is requested in context, at the moment of use, with a purpose
string that says what we do with the data.

## Principles

1. **Never request a permission for a feature that does not exist.** A declared permission
   with no visible use is a review question with no good answer.
2. **Request in context**, never in a startup sweep. A permission prompt before the user
   understands why is denied, and a denied permission is hard to recover.
3. **Degrade gracefully.** Every denial has a working path: the feature explains what it
   cannot do and offers an alternative. Never a dead end, never a nag loop.
4. **Least capable variant.** Coarse location over precise if coarse suffices. Limited photo
   selection over full library access.

## Requested

### Camera — evidence capture
- Requested when the investigator first captures evidence, not at launch
- Foreground only
- iOS `NSCameraUsageDescription`: states that photos and video are captured as case evidence
  and stored privately against the assignment
- Denial path: attach from library instead

### Photo library — attaching existing evidence
- Prefer the **limited selection** picker; full-library access only if genuinely required
- iOS `NSPhotoLibraryUsageDescription` / Android scoped media access
- Denial path: capture with the camera instead

### Notifications — assignment and message alerts
- Requested **after** the user has a reason to want them — a first assignment or first message,
  never on first launch
- Notification content reveals nothing sensitive: "a new message", never the message body,
  never evidence content (see T-036)
- Denial path: in-app notification centre still works

### Location — tagging where evidence was captured
- **Foreground only. Background location is never requested.** See the stalkerware position in
  `app-store-compliance.md`
- Requested at capture time, and only where lawful and relevant to the mission
- Coarse precision unless the finding genuinely depends on precise location
- iOS `NSLocationWhenInUseUsageDescription`: states the location is attached to evidence the
  investigator captures, on their own device
- Denial path: evidence is captured without a location tag, which is fully supported

## Not requested

Background location · contacts · calendar · microphone (until audio evidence is a real
feature) · health · Bluetooth · phone state · SMS.

Adding any of these requires a decision recorded here and a re-check against the stalkerware
policy first.

## Purpose strings

Written in plain language, localised for en/ru/hy, and never a placeholder. A generic string
is a rejection.

They are user-facing copy and therefore translation keys like any other string — see
`localization`.
