import { randomUUID } from 'node:crypto';
import type { TestInfo } from '@playwright/test';

/**
 * What makes one journey's accounts and names its own (T-196, T-199): twelve random hex characters,
 * drawn once per journey in `beforeAll`. Not the clock — journeys started together by parallel
 * workers or `--repeat-each` often share a millisecond, and two on one address share an account:
 * each sees the other's agencies, roles and profiles, and both sign in against one account's limit.
 */
export const journeyTag = (): string => randomUUID().replaceAll('-', '').slice(0, 12);

/** Each spec's own block of addresses, so no two specs count against one limit. */
const SPEC = { account: 1, agency: 2, blocks: 3, missions: 4, notifications: 5 } as const;

/**
 * The address a journey's browsers come from, sent as `X-Forwarded-For` — which the API takes from
 * the app's rewrite as it takes it from Caddy (T-138). One per spec, viewport, person and repeat,
 * so every registration and sign-in counts against that journey's own per-address limits (five
 * registrations an hour) rather than the run's. In 10.0.0.0/8: never a real reader's address, and
 * the API trusts only loopback as a proxy, so each is a client of its own.
 */
export function journeyAddress(info: TestInfo, spec: keyof typeof SPEC, person = 0): string {
  const viewport = info.project.name === 'mobile' ? 0 : 1;
  return `10.${SPEC[spec]}.${viewport * 10 + person}.${info.repeatEachIndex + 1}`;
}
