import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { Tx } from '../../database/database.module';
import { idempotencyKeys } from '../../database/schema';
import { stableFingerprint } from '../hash/stable-fingerprint';

export interface IdempotencyScope {
  actorId: string;
  /** The logical operation, e.g. `quote.accept`. Scope is per actor, per endpoint. */
  endpoint: string;
  key: string;
  /** The request body. Hashed, never stored: a key must not execute a different request. */
  request: unknown;
}

/** The work has not run before and this caller owns it. */
export interface Claimed {
  status: 'CLAIMED';
}

/** The work ran before, under this key and this body. Return what it returned. */
export interface Replay {
  status: 'REPLAY';
  responseStatus: number | null;
  responseBody: unknown;
}

/**
 * Client-supplied idempotency keys, enforced by a unique constraint (docs/api/idempotency.md).
 *
 * **Not a read-then-write check.** That has a race window and loses under exactly the
 * concurrency it exists to handle. The claim is an INSERT: whoever wins the unique index does
 * the work, and everyone else is a replay or a conflict.
 *
 * The key row and the effect commit in the **same transaction**, so a key recorded for work
 * that rolled back cannot block a legitimate retry, and an effect cannot exist without its key.
 */
@Injectable()
export class IdempotencyService {
  /**
   * Claims the key, or reports what the first call did.
   *
   * A simultaneous second call does not race: its INSERT blocks on the unique index until the
   * first transaction commits or rolls back, and it then sees either a finished row to replay
   * or no row at all. Serialisation is the database's job here, not the caller's.
   */
  async claim(tx: Tx, scope: IdempotencyScope): Promise<Claimed | Replay> {
    const fingerprint = stableFingerprint(scope.request);

    const inserted = await tx
      .insert(idempotencyKeys)
      .values({
        actorId: scope.actorId,
        endpoint: scope.endpoint,
        key: scope.key,
        requestFingerprint: fingerprint,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (inserted.length > 0) return { status: 'CLAIMED' };

    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.actorId, scope.actorId),
          eq(idempotencyKeys.endpoint, scope.endpoint),
          eq(idempotencyKeys.key, scope.key),
        ),
      );
    // The row was there a moment ago and is not now: the first call rolled back, so this one
    // is free to be the first call. Retrying the claim keeps that path honest.
    if (existing === undefined) return this.claim(tx, scope);

    // A key bound to one request must never execute a different one.
    if (existing.requestFingerprint !== fingerprint) {
      throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED);
    }

    // Still running. Refused as retryable rather than queued behind it or executed alongside.
    if (existing.completedAt === null) throw AppError.stateConflict();

    return {
      status: 'REPLAY',
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
    };
  }

  /** Records what the work returned, in the same transaction as the work itself. */
  async complete(
    tx: Tx,
    scope: Pick<IdempotencyScope, 'actorId' | 'endpoint' | 'key'>,
    response: { status: number; body: unknown },
  ): Promise<void> {
    await tx
      .update(idempotencyKeys)
      .set({
        responseStatus: response.status,
        responseBody: response.body,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyKeys.actorId, scope.actorId),
          eq(idempotencyKeys.endpoint, scope.endpoint),
          eq(idempotencyKeys.key, scope.key),
        ),
      );
  }
}
