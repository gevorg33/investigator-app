import type { Tx } from '../../database/database.module';
import { currentContext } from '../context/execution-context';

/**
 * A unit of background work as it travels (T-082, tenancy.md §9): **ids, never permissions**.
 *
 * `tenantId`, `userId` and `membershipId` say whose work it is — the context it was queued in —
 * and are re-read when it runs, so a job queued by someone since removed does not run with their
 * old authority. All three are null for a system job, which runs in the audited system context and
 * no workspace. `key` is what the job is idempotent on, within its workspace; `jobId` is the queue's
 * own id, stable for the same work so a second enqueue of it is the same job.
 */
export interface JobEnvelope<P = unknown> {
  readonly jobId: string;
  readonly key: string;
  readonly command: string;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly membershipId: string | null;
  readonly payload: P;
}

/** Queues by latency class and blast radius (background-jobs): one per kind of work. */
export const QUEUES = ['events'] as const;
export type QueueName = (typeof QUEUES)[number];

/**
 * What a command does. `parse` refuses a payload that is not what the command takes — a job whose
 * data cannot be trusted fails for good rather than retrying. `run` gets the transaction the runner
 * opened in the job's context: the job's effect and the record that it happened commit together.
 */
export interface JobHandler<P = unknown> {
  readonly command: string;
  readonly queue: QueueName;
  parse(payload: unknown): P;
  run(payload: P, tx: Tx, envelope: JobEnvelope<P>): Promise<void>;
}

/** The handlers the runner dispatches on, provided as one list. */
export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

/**
 * A failure retrying cannot fix: a refused context, a command nobody handles, a payload that is not
 * what the command takes. The job goes straight to the dead letters.
 */
export class PermanentJobError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PermanentJobError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOrNull = (v: unknown) => v === null || (typeof v === 'string' && UUID.test(v));
const text = (v: unknown) => typeof v === 'string' && v !== '' && v.length <= 200;

/**
 * Whether `value` is an envelope — checked on the way out of the queue, since what comes back from
 * Redis is data, not a type. The three ids are all present or all null: a workspace job names its
 * whole context, and a system job none of it.
 */
export function isEnvelope(value: unknown): value is JobEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  const ids = [e['tenantId'], e['userId'], e['membershipId']];
  return (
    text(e['jobId']) &&
    text(e['key']) &&
    text(e['command']) &&
    'payload' in e &&
    ids.every(idOrNull) &&
    (ids.every((id) => id === null) || ids.every((id) => id !== null))
  );
}

/**
 * An envelope for work queued now, in the context the caller runs in — the only way a producer
 * names whose work it is. Outside a workspace it is a system job.
 */
export function envelopeFor<P>(
  command: string,
  key: string,
  payload: P,
  jobId = `${command}-${key}`,
): JobEnvelope<P> {
  const context = currentContext();
  return {
    jobId,
    key,
    command,
    tenantId: context?.tenantId ?? null,
    userId: context?.userId ?? null,
    membershipId: context?.membershipId ?? null,
    payload,
  };
}
