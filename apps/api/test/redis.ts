import { randomUUID } from 'node:crypto';

/**
 * The Redis the job specs use (T-082): CI's service (`REDIS_URL` in pr.yml), or local compose's.
 * Each spec file takes its own key prefix, so runs and files never see each other's queues.
 */
export const TEST_REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

export const testQueuePrefix = (): string => `test-${randomUUID()}`;
