import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationCategory } from './kinds';

/** Whose mail stops, in which workspace, for which category. Ids only. */
export interface UnsubscribeTarget {
  userId: string;
  tenantId: string;
  membershipId: string;
  category: NotificationCategory;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The key for unsubscribe links (T-036): derived from `SESSION_SECRET` under a label of its own, so
 * no new secret is needed, and a token for this can never pass for anything else.
 */
function keyFrom(secret: string): Buffer {
  return createHmac('sha256', secret).update('notifications.unsubscribe.v1').digest();
}

const sign = (secret: string, body: string) =>
  createHmac('sha256', keyFrom(secret)).update(body).digest('base64url');

/**
 * A token for an unsubscribe link: the target, and a signature over it. Not stored and not expiring:
 * an unsubscribe link in an email from last year still works, which is what the law and the
 * recipient both expect. What it can do is exactly one thing — turn one category of one person's
 * mail off in one workspace.
 */
export function unsubscribeToken(target: UnsubscribeTarget, secret: string): string {
  const body = Buffer.from(
    JSON.stringify([target.userId, target.tenantId, target.membershipId, target.category]),
  ).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

/** The target a token names, if its signature is ours; otherwise null. */
export function readUnsubscribeToken(token: unknown, secret: string): UnsubscribeTarget | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parts) || parts.length !== 4) return null;
  const [userId, tenantId, membershipId, category] = parts as unknown[];
  if (![userId, tenantId, membershipId].every((id) => typeof id === 'string' && UUID.test(id))) {
    return null;
  }
  if (category !== 'activity') return null;
  return {
    userId: userId as string,
    tenantId: tenantId as string,
    membershipId: membershipId as string,
    category,
  };
}
