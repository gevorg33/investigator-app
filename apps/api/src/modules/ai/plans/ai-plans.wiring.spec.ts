import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { JOB_HANDLERS } from '../../../common/jobs/job';
import type { JobQueue } from '../../../common/jobs/job-queue';
import { EVENT_SUBSCRIBERS } from '../../../common/jobs/outbox-delivery.handler';
import { WorkerModule } from '../../../common/jobs/worker';
import { AiModule } from '../ai.module';
import { ASSISTANT_TOOLS } from '../tools/assistant-tool';
import { ExecutePlanHandler, PlanConfirmedTrigger } from './execute-plan.handler';
import { PlanExecutor } from './plan-executor';
import { WRITE_TOOLS } from './write-tools';

interface Provider {
  provide?: unknown;
  inject?: unknown[];
  useFactory?: (...args: unknown[]) => unknown;
}
const providers = (module: object) =>
  (Reflect.getMetadata('providers', module) as Array<Provider | (new () => unknown)>) ?? [];
const provider = (module: object, token: unknown) =>
  providers(module).find((p) => typeof p === 'object' && p.provide === token) as Provider;

/**
 * A plan proposed in the API runs in the worker (T-048), so both must hold every write tool: one the
 * worker lacked would leave a confirmed plan that could never run. The worker must also have what
 * runs a plan, and the trigger that hands it a confirmed one.
 */
describe('plans are wired into both processes', () => {
  it('registers every write tool in the API and in the worker', () => {
    for (const module of [AiModule, WorkerModule]) {
      const tools = provider(module, ASSISTANT_TOOLS);
      expect(tools.inject).toEqual(expect.arrayContaining([...WRITE_TOOLS]));
      for (const tool of WRITE_TOOLS) expect(providers(module)).toContain(tool);
    }
    // The worker holds only what a plan can: no read tool, and nothing the services behind reads need.
    expect(provider(WorkerModule, ASSISTANT_TOOLS).inject).toEqual([...WRITE_TOOLS]);
  });

  it('gives the worker the executor, its job handler and the confirmation trigger', () => {
    expect(providers(WorkerModule)).toEqual(
      expect.arrayContaining([PlanExecutor, ExecutePlanHandler]),
    );
    expect(provider(WorkerModule, JOB_HANDLERS).inject).toContain(ExecutePlanHandler);
    const subscribers = provider(WorkerModule, EVENT_SUBSCRIBERS).useFactory!(
      {} as JobQueue,
    ) as unknown[];
    expect(subscribers.filter((s) => s instanceof PlanConfirmedTrigger)).toHaveLength(1);
  });
});
