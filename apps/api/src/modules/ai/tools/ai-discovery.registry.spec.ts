import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testActor } from '../../../../test/actor';
import type { AuditEvent, AuditService } from '../../../common/audit/audit.service';
import { AuthzService } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { runInContext, type ExecutionContext } from '../../../common/context/execution-context';
import type { SearchService } from '../../search/search.service';
import type { TaxonomyService } from '../../taxonomy/taxonomy.service';
import {
  MemoryRateLimitStore,
  RateLimitService,
  type RateLimitStore,
} from '../../auth/rate-limit.service';
import { assertRegistrable, type AssistantTool } from './assistant-tool';
import { ListTaxonomyTool } from './discovery/list-taxonomy.tool';
import { SearchInvestigatorsTool } from './discovery/search-investigators.tool';
import { ToolRunner } from './tool-runner';

const CONTEXT: ExecutionContext = {
  tenantId: 'tenant-1',
  tenantKind: 'PERSONAL',
  userId: 'u1',
  membershipId: 'm1',
  sessionId: 's1',
  permissions: [],
};

/** A read tool that echoes, and tries to leak a field its output schema does not name. */
const echo = (over: Partial<AssistantTool<{ q?: string }, { said: string }>> = {}) =>
  ({
    name: 'echoThing',
    description: 'Echoes.',
    requiredRoles: ['CUSTOMER'],
    resourceScope: 'public_projection',
    operation: 'read',
    confirmation: 'none',
    input: z.strictObject({ q: z.string().max(5).optional() }),
    output: z.object({ said: z.string() }),
    auditEvent: 'ai.tool.echo_thing',
    rateLimit: { perMinute: 2 },
    auditArguments: (input: { q?: string }) => `q=${input.q === undefined ? 'no' : 'yes'}`,
    execute: async (_actor: Actor, input: { q?: string }) =>
      ({ said: input.q ?? '', contactPhone: '555-0199' }) as { said: string },
    ...over,
  }) as AssistantTool<{ q?: string }, { said: string }>;

const build = (tools: AssistantTool[], store: RateLimitStore = new MemoryRateLimitStore()) => {
  const events: AuditEvent[] = [];
  const audit = { record: vi.fn(async (e: AuditEvent) => void events.push(e)) };
  const runner = new ToolRunner(
    new AuthzService(audit as unknown as AuditService),
    audit as unknown as AuditService,
    new RateLimitService(store),
    tools,
  );
  return { runner, events };
};

const req = { correlationId: 'c1', ip: '203.0.113.1', userAgent: 'spec' };
const customer = testActor({ userId: 'u1' });
const inside = <T>(fn: () => Promise<T>) => runInContext(CONTEXT, fn);

describe('assistant tool registry (T-018)', () => {
  describe('a declaration that breaks the contract does not register', () => {
    it.each([
      ['a name that is not camelCase', { name: 'echo_thing' }],
      ['no description', { description: ' ' }],
      ['no roles', { requiredRoles: [] }],
      ['no resource scope', { resourceScope: 'everyone' }],
      ['no operation', { operation: 'maybe' }],
      ['no confirmation', { confirmation: 'sometimes' }],
      [
        'a write that does not require confirmation',
        { operation: 'write', confirmation: 'none', observe: async () => ({}) },
      ],
      [
        'a write that cannot say what it acts on, so a confirmation could not be re-checked (T-048)',
        { operation: 'write', confirmation: 'required' },
      ],
      ['an input that ignores unknown arguments', { input: z.object({ q: z.string() }) }],
      ['an input that is not an object', { input: z.string() }],
      ['an input naming the user', { input: z.strictObject({ userId: z.string() }) }],
      ['an input naming the workspace', { input: z.strictObject({ workspaceId: z.string() }) }],
      ['an input naming the tenant', { input: z.strictObject({ tenant_id: z.string() }) }],
      ['an input naming the membership', { input: z.strictObject({ membership: z.string() }) }],
      ['an input naming the actor', { input: z.strictObject({ actor: z.string() }) }],
      ['no output schema', { output: { parse: (x: unknown) => x } }],
      ['an audit event outside ai.tool.*', { auditEvent: 'echo' }],
      ['no rate limit', { rateLimit: undefined }],
      ['a rate limit of zero', { rateLimit: { perMinute: 0 } }],
      ['a fractional rate limit', { rateLimit: { perMinute: 1.5 } }],
    ])('%s', (_label, over) => {
      expect(() => assertRegistrable(echo(over as never) as AssistantTool)).toThrow(
        /cannot register/,
      );
    });

    it('refuses a name that is not a string at all, and two tools with one name', () => {
      expect(() => assertRegistrable(echo({ name: 42 as never }) as AssistantTool)).toThrow(
        /cannot register: name/,
      );
      expect(() => build([echo() as AssistantTool, echo() as AssistantTool])).toThrow(
        /registered twice/,
      );
    });

    it('accepts one that keeps it, read or confirmed write', () => {
      expect(() => assertRegistrable(echo() as AssistantTool)).not.toThrow();
      const write = echo({
        operation: 'write',
        confirmation: 'required',
        observe: async () => ({ version: 1 }),
      });
      expect(() => assertRegistrable(write as AssistantTool)).not.toThrow();
    });
  });

  it('every discovery tool keeps the contract: read-only, public, strict, and never told who is asking', () => {
    const tools = [
      new SearchInvestigatorsTool({} as SearchService, {} as TaxonomyService),
      new ListTaxonomyTool({} as TaxonomyService),
    ];
    const { runner } = build(tools as AssistantTool[]);
    expect(
      runner.tools().map((t) => [t.name, t.operation, t.confirmation, t.resourceScope]),
    ).toEqual([
      ['searchInvestigators', 'read', 'none', 'public_projection'],
      ['listTaxonomy', 'read', 'none', 'public_projection'],
    ]);
    for (const tool of runner.tools()) {
      for (const smuggled of ['userId', 'workspaceId', 'tenantId', 'membershipId', 'actorId']) {
        expect(tool.input.safeParse({ [smuggled]: 'someone-else' }).success).toBe(false);
      }
    }
  });

  describe('running a tool', () => {
    it('runs it as the caller, strips what the output does not name, and audits the redacted arguments', async () => {
      const { runner, events } = build([echo() as AssistantTool]);
      const tool = runner.tools()[0] as AssistantTool<{ q?: string }, { said: string }>;
      const out = await inside(() => runner.invoke(customer, tool, { q: 'zebra' }, req));
      expect(out).toEqual({ said: 'zebra' });
      expect(events).toEqual([
        expect.objectContaining({
          actorId: 'u1',
          action: 'ai.tool.echo_thing',
          resourceType: 'assistant_tool',
          reason: 'ok: q=yes',
          correlationId: 'c1',
          ipAddress: '203.0.113.1',
          userAgent: 'spec',
        }),
      ]);
      expect(JSON.stringify(events)).not.toContain('zebra');
    });

    it('refuses an argument the tool does not name — a model-supplied identity is not ignored', async () => {
      const { runner, events } = build([echo({ rateLimit: { perMinute: 100 } }) as AssistantTool]);
      const tool = runner.tools()[0]!;
      for (const args of [{ userId: 'someone-else' }, { q: 'far too long' }, null]) {
        await expect(inside(() => runner.invoke(customer, tool, args, req))).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
        });
      }
      await expect(
        inside(() => runner.invoke(customer, tool, { workspaceId: 'w2' }, req)),
      ).rejects.toMatchObject({
        details: [
          {
            field: 'arguments',
            code: 'INVALID',
            messageKey: 'error.validation.assistant_tool.invalid',
          },
        ],
      });
      await expect(
        inside(() => runner.invoke(customer, tool, { q: 'far too long' }, req)),
      ).rejects.toMatchObject({ details: [{ field: 'q' }] });
      expect(events.map((e) => e.reason)).toContain('rejected: invalid arguments');
    });

    it('will not run a tool it did not register, even one with a registered name', async () => {
      const { runner } = build([echo() as AssistantTool]);
      await expect(inside(() => runner.invoke(customer, echo(), {}, req))).rejects.toThrow(
        /not registered/,
      );
    });

    it('refuses outside a workspace, an inactive account, and a role the tool does not serve', async () => {
      const { runner, events } = build([echo() as AssistantTool]);
      const tool = runner.tools()[0]!;
      await expect(runner.invoke(customer, tool, {}, req)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        inside(() => runner.invoke({ ...customer, status: 'SUSPENDED' }, tool, {}, req)),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const investigator = testActor({ userId: 'u2', roles: ['INVESTIGATOR'] });
      await expect(inside(() => runner.invoke(investigator, tool, {}, req))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      // Holding the role is not enough when another one is active.
      const narrowed = testActor({
        userId: 'u3',
        roles: ['CUSTOMER', 'INVESTIGATOR'],
        activeRole: 'INVESTIGATOR',
      });
      await expect(inside(() => runner.invoke(narrowed, tool, {}, req))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(events.map((e) => [e.action, e.reason])).toEqual([
        ['authz.denied.ai.tool.echo_thing', 'workspace_not_available'],
        ['authz.denied.ai.tool.echo_thing', 'account_not_active'],
        ['authz.denied.ai.tool.echo_thing', 'role_not_held'],
        ['authz.denied.ai.tool.echo_thing', 'role_not_active'],
      ]);
    });

    it('lets any one of several roles through', async () => {
      const { runner } = build([
        echo({ requiredRoles: ['STAFF', 'INVESTIGATOR'] }) as AssistantTool,
      ]);
      const investigator = testActor({ userId: 'u2', roles: ['INVESTIGATOR'] });
      await expect(
        inside(() => runner.invoke(investigator, runner.tools()[0]!, {}, req)),
      ).resolves.toEqual({ said: '' });
    });

    it('limits calls per tool per account, at the tool’s declared rate', async () => {
      const { runner } = build([echo() as AssistantTool]);
      const tool = runner.tools()[0]!;
      await inside(() => runner.invoke(customer, tool, {}, req));
      await inside(() => runner.invoke(customer, tool, {}, req));
      await expect(inside(() => runner.invoke(customer, tool, {}, req))).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      // Another account has its own allowance.
      await expect(
        inside(() => runner.invoke(testActor({ userId: 'u9' }), tool, {}, req)),
      ).resolves.toBeDefined();
    });
  });

  describe('a write: proposed, never invoked; run only as a confirmed step (T-048)', () => {
    type Tally = { name: string; amount: number };
    const write = (seen: { executed: unknown[]; observed: number }) =>
      echo({
        name: 'addToTally',
        operation: 'write',
        confirmation: 'required',
        auditEvent: 'ai.tool.add_to_tally',
        rateLimit: { perMinute: 1 },
        input: z.strictObject({ name: z.string().max(10), amount: z.number().int() }) as never,
        auditArguments: ((i: Tally) => `amount=${i.amount}`) as never,
        observe: async () => {
          seen.observed += 1;
          return { version: seen.observed };
        },
        execute: (async (_a: Actor, i: Tally, _r: unknown, effect: unknown) => {
          seen.executed.push([i, effect]);
          return { said: i.name, secret: 'stripped' };
        }) as never,
      }) as AssistantTool;
    const setup = () => {
      const seen = { executed: [] as unknown[], observed: 0 };
      const built = build([write(seen), echo() as AssistantTool]);
      const [tally, read] = built.runner.tools() as [AssistantTool, AssistantTool];
      return { ...built, seen, tally, read };
    };

    it('finds a tool by name, and nothing by a name not registered', () => {
      const { runner, tally } = setup();
      expect(runner.find('addToTally')).toBe(tally);
      expect(runner.find('dropTables')).toBeUndefined();
    });

    it('refuses to invoke a write on the model’s call, and runs nothing', async () => {
      const { runner, tally, seen, events } = setup();
      await expect(
        inside(() => runner.invoke(customer, tally, { name: 'a', amount: 1 }, req)),
      ).rejects.toThrow(/runs only through a confirmed plan/);
      expect([seen.executed, seen.observed, events]).toEqual([[], 0, []]);
    });

    it('prepares a write without running it: arguments as parsed, what it observes, audited as proposed', async () => {
      const { runner, tally, seen, events } = setup();
      const step = await inside(() =>
        runner.prepare(customer, tally, { name: 'a', amount: 2 }, req),
      );
      expect(step).toEqual({ arguments: { name: 'a', amount: 2 }, observed: { version: 1 } });
      expect(seen.executed).toEqual([]);
      expect(events.map((e) => [e.action, e.reason])).toEqual([
        ['ai.tool.add_to_tally', 'proposed: amount=2'],
      ]);
      // The proposal spends the model's allowance for the tool.
      await expect(
        inside(() => runner.prepare(customer, tally, { name: 'a', amount: 2 }, req)),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('prepares only writes, as the caller holds a role now, with strict arguments', async () => {
      const { runner, tally, read, events } = setup();
      await expect(inside(() => runner.prepare(customer, read, {}, req))).rejects.toThrow(
        /is a read: it is run, not proposed/,
      );
      const investigator = testActor({ userId: 'u3', roles: ['INVESTIGATOR'] });
      await expect(
        inside(() => runner.prepare(investigator, tally, { name: 'a', amount: 1 }, req)),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        inside(() =>
          runner.prepare(
            testActor({ userId: 'u4' }),
            tally,
            { name: 'a', amount: 1, userId: 'x' },
            req,
          ),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(events.at(-1)).toMatchObject({ reason: 'rejected: invalid arguments' });
    });

    it('observes a stored step again, checking the caller and the arguments first', async () => {
      const { runner, tally, read } = setup();
      await expect(
        inside(() => runner.observe(customer, tally, { name: 'a', amount: 1 }, req)),
      ).resolves.toEqual({ version: 1 });
      await expect(inside(() => runner.observe(customer, read, {}, req))).rejects.toThrow(
        /is a read/,
      );
      await expect(
        inside(() => runner.observe(customer, tally, { name: 'a', amount: 'many' }, req)),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('runs a confirmed step with its key, strips the output, audits it — and spends no allowance', async () => {
      const { runner, tally, seen, events } = setup();
      const effect = { idempotencyKey: 'ai-plan:p:1' };
      for (const amount of [1, 2]) {
        await expect(
          inside(() => runner.runConfirmed(customer, tally, { name: 'a', amount }, req, effect)),
        ).resolves.toEqual({ said: 'a' });
      }
      expect(seen.executed).toEqual([
        [{ name: 'a', amount: 1 }, effect],
        [{ name: 'a', amount: 2 }, effect],
      ]);
      expect(events.map((e) => e.reason)).toEqual([
        'ok: confirmed: amount=1',
        'ok: confirmed: amount=2',
      ]);
    });

    it('re-authorizes a confirmed step: no workspace, or no role now, runs nothing', async () => {
      const { runner, tally, read, seen } = setup();
      const effect = { idempotencyKey: 'ai-plan:p:1' };
      await expect(
        runner.runConfirmed(customer, tally, { name: 'a', amount: 1 }, req, effect),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        inside(() =>
          runner.runConfirmed(
            testActor({ userId: 'u5', roles: [] }),
            tally,
            { name: 'a', amount: 1 },
            req,
            effect,
          ),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        inside(() => runner.runConfirmed(customer, read, {}, req, effect)),
      ).rejects.toThrow(/is a read/);
      expect(seen.executed).toEqual([]);
    });
  });
});
