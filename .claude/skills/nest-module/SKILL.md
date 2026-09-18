---
name: nest-module
description: Scaffold and conventions for a NestJS domain module in apps/api — file layout, entity, Zod DTOs, application service, controller, events, and tests. Use when creating a new module or adding an endpoint to an existing one.
---

# NestJS module

## Layout

```
apps/api/src/modules/<module>/
├── <module>.module.ts
├── domain/
│   ├── <entity>.entity.ts
│   ├── <entity>.rules.ts        # pure functions, no I/O, heavily tested
│   └── events.ts
├── application/
│   └── <module>.service.ts      # orchestration + authorization
├── infrastructure/
│   └── <module>.repository.ts   # the only place that touches the DB
├── api/
│   ├── <module>.controller.ts
│   └── dto/
└── __tests__/
    ├── <module>.rules.spec.ts
    ├── <module>.service.spec.ts
    └── <module>.authz.spec.ts   # mandatory
```

Rule of thumb: **domain has no imports from infrastructure.** If a business rule needs a
repository, it is not a business rule — it is orchestration, and belongs in the service.

## Schemas

Define the shape once in `packages/validation` as a Zod schema; derive the TypeScript type
from it; use it in the DTO, the mobile form, and the AI tool. One schema, three consumers.

```ts
export const CreateMissionSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().min(8).max(200),
  description: z.string().min(40).max(10_000),
  countryCode: z.string().length(2),
  preferredLocales: z.array(z.enum(['en', 'ru', 'hy'])).min(1),
  budgetMinMinor: z.number().int().nonnegative(),
  budgetMaxMinor: z.number().int().nonnegative(),
  lawfulPurposeConfirmed: z.literal(true),
}).refine(v => v.budgetMaxMinor >= v.budgetMinMinor, {
  message: 'budget.max_below_min', path: ['budgetMaxMinor'],
});
export type CreateMissionInput = z.infer<typeof CreateMissionSchema>;
```

Error messages are translation keys, not English sentences.

## Service

The service is where authorization and transactions live.

```ts
async submit(actor: Actor, missionId: string): Promise<Mission> {
  const mission = await this.repo.findDraftForCustomer(missionId, actor.id); // scoped query
  if (!mission) throw new NotFoundException();

  assertCanSubmit(mission);                    // pure rule, throws a domain error

  return this.uow.transaction(async (tx) => {
    const next = await this.transitions.apply(tx, mission, 'SUBMITTED', actor);
    await this.outbox.publish(tx, missionSubmitted(next));
    await this.audit.record(tx, { actor, action: 'mission.submit', resource: next });
    return next;
  });
}
```

Note what is in the transaction: the state change, the outbox row, and the audit entry.
All three or none.

## Controller

Thin. Validate, call the service, map the result. No business logic, no repository access,
no conditional authorization.

## Events

Emit through the outbox (see `background-jobs`), never by calling another module's service
inside your transaction. Name events past-tense and domain-specific:
`mission.submitted`, `quote.accepted`, `evidence.uploaded`.

## Tests

| File | Asserts |
|---|---|
| `*.rules.spec.ts` | Every branch of the pure rules, including every illegal transition |
| `*.service.spec.ts` | Orchestration, transaction boundaries, event emission |
| `*.authz.spec.ts` | The seven cases from the `authorization` skill |

## Checklist

- [ ] Domain imports nothing from infrastructure
- [ ] No `tenantId` parameter on any service, repository or domain method: the workspace comes from the execution context (`tenant-isolation`)
- [ ] Repository is the only DB caller
- [ ] Authorization in the service, actor-scoped queries
- [ ] State change, outbox and audit share one transaction
- [ ] Zod schema lives in `packages/validation` and is reused
- [ ] Error messages are translation keys
- [ ] `*.authz.spec.ts` exists and tests a different actor
