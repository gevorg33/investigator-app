import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../src/database/schema';
import { customerAliasOf } from '../src/modules/missions/customer-alias';
import { TokenService } from '../src/modules/auth/token.service';
import { assignment } from './assignment-fixtures';
import { employeesApp } from './employees-harness';
import { customerProfile } from './profile-fixtures';
import { eligibleInvestigator, quotableMission, submittedQuote } from './quote-fixtures';

/**
 * Who may learn whose name, checked by walking the API rather than by a list someone has to keep up
 * to date: every route the application registers is called as one party — every GET, and the POST
 * queries under `/search` — with each path parameter filled by every id that party could hold, and
 * no successful answer may carry what the other party's identity is made of. A route added later is
 * walked the day it exists; a new kind of thing a party can hold (a conversation) also needs its id
 * in that walk's `ids`, or its view is walked with nothing in it.
 *
 * - **A customer is masked from investigators until hire (T-100).**
 * - **An investigator's legal name is never shown to customers (T-181)** — before hire or after:
 *   they are known by the pseudonym they chose.
 *
 * Neither party has a photo (no column holds one), so there is no avatar to look for; the day one is
 * added, its URL joins the markers.
 */
type Harness = Awaited<ReturnType<typeof employeesApp>>;
type Ids = Record<string, string>;

/** A signed-in session for an existing user: the cookie their browser would send. */
async function sessionFor(h: Harness, userId: string, role: 'CUSTOMER' | 'INVESTIGATOR') {
  await h.owner`UPDATE users SET email_verified_at = now() WHERE id = ${userId}`;
  await h.owner`INSERT INTO user_roles (user_id, role) VALUES (${userId}, ${role}) ON CONFLICT DO NOTHING`;
  const token = `masking-${randomUUID()}`;
  await h.owner`
    INSERT INTO user_sessions (user_id, refresh_token_hash, family_id, expires_at)
    VALUES (${userId}, ${new TokenService().fingerprint(token)}, ${randomUUID()},
            now() + interval '1 day')`;
  return `investigator_session=${token}`;
}

/** Every route the application has registered, read from the router itself. */
function routes(h: Harness) {
  type Layer = { route?: { path: string; methods: Record<string, boolean> } };
  const express = h.app.getHttpAdapter().getInstance() as {
    router?: { stack: Layer[] };
    _router?: { stack: Layer[] };
  };
  return (express.router ?? express._router)!.stack.flatMap((l) =>
    l.route === undefined
      ? []
      : Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })),
  );
}

/** Reads only: every GET, and the queries under /search that take their filters as a body. */
const isRead = (r: { method: string; path: string }) =>
  r.method === 'GET' || (r.method === 'POST' && r.path.startsWith('/api/v1/search/'));

/** A path with each `:param` filled by each id the caller could hold, every combination. */
function fillings(path: string, ids: Ids): string[] {
  let paths = [path];
  for (const p of path.match(/:\w+/g) ?? []) {
    paths = paths.flatMap((x) => Object.values(ids).map((id) => x.replace(p, id)));
  }
  return paths;
}

/**
 * A request to the app the harness already has listening (`listenOnce`), so a route that never
 * finishes (a stream) is cut off after five seconds rather than holding the run.
 */
async function call(h: Harness, cookie: string, method: string, path: string) {
  const { port } = h.app.getHttpServer().address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    // Cut off, or no answer at all: it said nothing, and it is no success.
    return { status: 0, text: String(e) };
  }
}

/** Walks every read as `cookie`; what leaked, and which routes answered at all. */
async function walk(h: Harness, cookie: string, ids: Ids, markers: Record<string, string>) {
  const reads = routes(h).filter(isRead);
  const leaks: string[] = [];
  const reached = new Set<string>();
  for (const route of reads) {
    for (const path of fillings(route.path, ids)) {
      const res = await call(h, cookie, route.method, path);
      if (res.status < 200 || res.status >= 300) continue;
      reached.add(`${route.method} ${route.path}`);
      for (const [what, m] of Object.entries(markers)) {
        if (res.text.includes(m)) leaks.push(`${route.method} ${path} → ${what}`);
      }
    }
  }
  return { walked: reads.length, leaks, reached: [...reached] };
}

describe('a customer is masked until hire (T-100)', () => {
  let h: Harness;
  const SURNAME = 'Zzyzxian';
  const PHONE = '555-0147';
  const email = `masking-${randomUUID()}@example.test`;
  let ids: Ids;
  let investigator: string;

  beforeAll(async () => {
    h = await employeesApp();
    const db = drizzle(h.owner, { schema });
    // The customer, with everything an investigator must not learn before hire.
    const mission = await quotableMission(db);
    await h.owner`
      UPDATE users SET display_name = ${`Anahit ${SURNAME}`}, email = ${email}
       WHERE id = ${mission.customerId}`;
    const profile = await customerProfile(db, { userId: mission.customerId, contactPhone: PHONE });
    // An investigator who may see the mission and has quoted on it — everything short of hire.
    const inv = await eligibleInvestigator(db);
    const quote = await submittedQuote(db, {
      missionId: mission.missionId,
      investigatorProfileId: inv.profileId,
    });
    investigator = await sessionFor(h, inv.userId, 'INVESTIGATOR');
    ids = {
      mission: mission.missionId,
      quote: quote.id,
      customerProfile: profile.profileId,
      customerUser: mission.customerId,
      investigatorProfile: inv.profileId,
      investigatorUser: inv.userId,
    };
  });

  afterAll(async () => {
    await h?.close();
  });

  it('walks every read, and none answers with the customer’s surname, email, phone or id', async () => {
    const { walked, leaks, reached } = await walk(h, investigator, ids, {
      surname: SURNAME,
      email,
      phone: PHONE,
      'user id': ids['customerUser']!,
    });
    // The walk is the claim: if it found nothing to walk, it proved nothing.
    expect(walked).toBeGreaterThan(40);
    expect(leaks).toEqual([]);
    // And the views that concern the customer were really read, not refused.
    expect(reached).toEqual(
      expect.arrayContaining([
        'POST /api/v1/search/missions',
        'GET /api/v1/quotes/me',
        'GET /api/v1/profiles/customer/:id',
      ]),
    );
  });

  it('names the customer only by a per-mission alias in the browse', async () => {
    const res = await call(h, investigator, 'POST', '/api/v1/search/missions');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { items: Array<{ id: string; customerAlias: string }> };
    const listed = body.items.find((m) => m.id === ids['mission']);
    expect(listed?.customerAlias).toBe(customerAliasOf(ids['mission']!));
  });
});

describe('an investigator’s legal name never reaches a customer (T-181)', () => {
  let h: Harness;
  const FIRST = 'Vahagn';
  const SURNAME = 'Qwertyuian';
  const PHONE = '555-0148';
  const email = `masking-inv-${randomUUID()}@example.test`;
  const pseudonym = `Ember Lantern ${randomUUID()
    .replace(/[^a-f]/g, '')
    .slice(0, 6)}`;
  let ids: Ids;
  let customer: string;

  beforeAll(async () => {
    h = await employeesApp();
    const db = drizzle(h.owner, { schema });
    // The investigator, with everything a customer must never learn — and the name they chose.
    const inv = await eligibleInvestigator(db, { displayName: `${FIRST} ${SURNAME}` });
    await h.owner`UPDATE users SET email = ${email} WHERE id = ${inv.userId}`;
    await h.owner`
      UPDATE investigator_profiles SET contact_phone = ${PHONE}, pseudonym = ${pseudonym}
       WHERE id = ${inv.profileId}`;
    // A customer who received their quote and hired them: the name stays hidden after hire too.
    const mission = await quotableMission(db);
    const quote = await submittedQuote(db, {
      missionId: mission.missionId,
      investigatorProfileId: inv.profileId,
      status: 'ACCEPTED',
    });
    const work = await assignment(db, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status: 'IN_PROGRESS',
    });
    customer = await sessionFor(h, mission.customerId, 'CUSTOMER');
    ids = {
      mission: mission.missionId,
      quote: quote.id,
      assignment: work.id,
      investigatorProfile: inv.profileId,
      investigatorUser: inv.userId,
      customerUser: mission.customerId,
    };
  });

  afterAll(async () => {
    await h?.close();
  });

  it('walks every read as the customer who hired them, and none carries their legal name, email, phone or id', async () => {
    const { walked, leaks, reached } = await walk(h, customer, ids, {
      'first name': FIRST,
      surname: SURNAME,
      email,
      phone: PHONE,
      'user id': ids['investigatorUser']!,
    });
    expect(walked).toBeGreaterThan(40);
    expect(leaks).toEqual([]);
    // The views that name an investigator to a customer were really read.
    expect(reached).toEqual(
      expect.arrayContaining([
        'GET /api/v1/profiles/investigator/:id',
        'POST /api/v1/search/investigators',
        'GET /api/v1/assignments/:id',
      ]),
    );
  });

  it('names them by their pseudonym', async () => {
    const res = await call(
      h,
      customer,
      'GET',
      `/api/v1/profiles/investigator/${ids['investigatorProfile']}`,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toMatchObject({ pseudonym });
  });
});
