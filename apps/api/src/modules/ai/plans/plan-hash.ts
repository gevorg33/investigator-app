import { createHash } from 'node:crypto';

/**
 * JSON with its keys sorted at every depth, so the same value always hashes the same — whatever
 * order a model, a parser or PostgreSQL's `jsonb` put its keys in. `undefined` is left out, as
 * `JSON.stringify` leaves it out, so an optional argument that was never given and one stored
 * without it are the same plan.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    // Keys are unique, so no two compare equal; code-unit order, the same in every locale.
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** A digest of what a write tool observed — the state a confirmation is checked against. */
export function digestObservation(observed: unknown): string {
  return sha256(canonicalJson(observed ?? null));
}

export interface HashedStep {
  readonly ordinal: number;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly observed: string;
}

/**
 * The hash a person confirms (T-048, ADR-0012): the plan's id, its session, and every step — tool,
 * exact arguments and the state it saw. Change any of them and it is a different plan, which a
 * confirmation of this one does not cover. Versioned, so the recipe can change without an old hash
 * ever matching a new plan.
 */
export function planHash(plan: {
  id: string;
  sessionId: string;
  steps: readonly HashedStep[];
}): string {
  const steps = [...plan.steps]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((s) => ({
      ordinal: s.ordinal,
      tool: s.tool,
      arguments: s.arguments,
      observed: s.observed,
    }));
  return sha256(canonicalJson({ v: 1, id: plan.id, sessionId: plan.sessionId, steps }));
}
