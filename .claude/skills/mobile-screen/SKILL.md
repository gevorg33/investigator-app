---
name: mobile-screen
description: The screen scaffold for the Expo companion app — Expo Router route, TanStack Query, React Hook Form + Zod, secure storage, i18n keys, and required loading/empty/error states. Use when adding a screen in apps/mobile. Mobile is a companion; workspace surfaces are web (ADR-0004).
---

# Mobile screen

**Scope check first.** Mobile is a companion (ADR-0004) — capture, notifications, messaging,
quick updates, location-aware actions. If the screen you are about to build is a workspace
surface (evidence review, report authoring, a dashboard, a timeline, a graph), stop: it
belongs on the web.

Share design tokens with web. Never import a DOM component library — shadcn, Cult UI and
React Bits do not run in React Native.

## Layout

```
apps/mobile/app/(role)/<area>/<screen>.tsx     # route, thin
apps/mobile/src/features/<area>/
├── api/          # query + mutation hooks
├── components/
├── hooks/
└── schemas.ts    # re-exports from packages/validation — never redeclares
```

The route file wires things together. Logic lives in the feature folder, so it stays
testable and the router stays readable.

## Data

Server state is TanStack Query. Always. Zustand holds UI state only — a filter panel's
open/closed, a draft not yet submitted.

```ts
export function useMission(id: string) {
  return useQuery({
    queryKey: ['mission', id],
    queryFn: () => api.missions.get(id),
    staleTime: 30_000,
  });
}
```

Query keys are structured and consistent: `['mission', id]`, `['missions', filters]`. On
role switch, invalidate everything — a cached customer view must not persist into the
investigator role.

## Forms

Shared Zod schema from `packages/validation`. Do not redeclare the shape the API defines;
a drifted client schema produces errors the user cannot act on.

```ts
const form = useForm<CreateMissionInput>({
  resolver: zodResolver(CreateMissionSchema),
  defaultValues: { preferredLocales: ['en'] },
});
```

Validation messages are translation keys resolved at render.

## Required states

Every screen that loads data handles four, explicitly:

| State | Requirement |
|---|---|
| Loading | Skeleton or spinner; never a blank screen |
| Empty | Explains what would fill it and the next action |
| Error | What failed, whether it is retryable, a retry control. Never a raw error string |
| Success | The content |

A screen missing empty or error states is incomplete, not "to be polished later".

## Security

- Tokens in platform secure storage. Never AsyncStorage, never a state store.
- No PII or evidence in logs, analytics events or crash reports.
- Evidence and private media: request a short-lived authorized URL, do not persist it, do
  not write the file to disk cache.
- Hiding a control is UX, not authorization. The server enforces; assume a hostile client
  will call the endpoint anyway.
- On sign-out and on role switch: clear the query cache and any in-memory sensitive state.

## Navigation

Expo Router file conventions. Role-specific routes live under the role group. Deep links
must handle the unauthenticated case, the wrong-role case, and the not-found case — a deep
link into an assignment the user cannot access shows a clean message, not a crash or a
partial render.

## Checklist

- [ ] Server state in TanStack Query; Zustand for UI only
- [ ] Shared Zod schema reused, not redeclared
- [ ] All four states handled
- [ ] Every string is a translation key in all three locales
- [ ] Tokens in secure storage
- [ ] Private media via short-lived authorized URL, not persisted
- [ ] Cache invalidated on role switch and sign-out
- [ ] Deep link handles unauthenticated, wrong-role and not-found
