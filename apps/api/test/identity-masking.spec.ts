import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../src/database/schema';
import { customerAliasOf } from '../src/modules/missions/customer-alias';
import { TokenService } from '../src/modules/auth/token.service';
import { employeesApp } from './employees-harness';
import { customerProfile } from './profile-fixtures';
import { eligibleInvestigator, quotableMission, submittedQuote } from './quote-fixtures';

/**
 * The customer is masked until hire (T-100), checked by walking the API rather than by a list
 * someone has to keep up to date: every route the application registers is called as an
 * investigator who has seen and quoted on the customer's mission — every GET, and the POST queries
 * under `/search` — with each path parameter filled by every id the investigator could hold. No
 * successful answer may carry the customer's surname, email, phone or user id. A route added later
 * is walked the day it exists; a new kind of thing an investigator can hold (a conversation) also
 * needs its id in `ids` below, or its view is walked with nothing in it.
 *
 * Customers have no photo (no column holds one), so there is no avatar to look for; the day one is
 * added, its URL joins the markers below.
 */
describe('a customer is masked until hire (T-100)', () => {
  let h: Awaited<ReturnType<typeof employeesApp>>;
  const SURNAME = 'Zzyzxian';
  const PHONE = '555-0147';
  const email = `masking-${randomUUID()}@example.test`;
  let ids: Record<string, string>;
  let investigator: { cookie: string };

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
    await h.owner`UPDATE users SET email_verified_at = now() WHERE id = ${inv.userId}`;
    await h.owner`INSERT INTO user_roles (user_id, role) VALUES (${inv.userId}, 'INVESTIGATOR')`;
    const quote = await submittedQuote(db, {
      missionId: mission.missionId,
      investigatorProfileId: inv.profileId,
    });
    const token = `masking-${randomUUID()}`;
    await h.owner`
      INSERT INTO user_sessions (user_id, refresh_token_hash, family_id, expires_at)
      VALUES (${inv.userId}, ${new TokenService().fingerprint(token)}, ${randomUUID()},
              now() + interval '1 day')`;
    investigator = { cookie: `investigator_session=${token}` };

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

  /** Every route the application has registered, read from the router itself. */
  const routes = () => {
    const express = h.app.getHttpAdapter().getInstance() as {
      router?: { stack: Layer[] };
      _router?: { stack: Layer[] };
    };
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const stack = (express.router ?? express._router)!.stack;
    return stack.flatMap((l) =>
      l.route === undefined
        ? []
        : Object.keys(l.route.methods).map((m) => ({
            method: m.toUpperCase(),
            path: l.route!.path,
          })),
    );
  };

  /** A path with each `:param` filled by each id the investigator could hold, every combination. */
  const fillings = (path: string): string[] => {
    const params = path.match(/:\w+/g) ?? [];
    let paths = [path];
    for (const p of params) {
      paths = paths.flatMap((x) => Object.values(ids).map((id) => x.replace(p, id)));
    }
    return paths;
  };

  /**
   * A request as the investigator, to the app the harness already has listening (`listenOnce`) — so
   * a route that never finishes (a stream) is cut off after five seconds rather than holding the run.
   */
  const call = async (method: string, path: string): Promise<{ status: number; text: string }> => {
    const { port } = h.app.getHttpServer().address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { cookie: investigator.cookie, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
        signal: AbortSignal.timeout(5_000),
      });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      // Cut off, or no answer at all: it said nothing, and it is no success.
      return { status: 0, text: String(e) };
    }
  };

  /** Reads only: every GET, and the queries under /search that take their filters as a body. */
  const isRead = (r: { method: string; path: string }) =>
    r.method === 'GET' || (r.method === 'POST' && r.path.startsWith('/api/v1/search/'));

  it('walks every read, and none answers with the customer’s surname, email, phone or id', async () => {
    const markers = [SURNAME, email, PHONE, ids['customerUser']!];
    const reads = routes().filter(isRead);
    // The walk is the claim: if it found nothing to walk, it proved nothing.
    expect(reads.length).toBeGreaterThan(40);

    const leaks: string[] = [];
    const reached = new Set<string>();
    for (const route of reads) {
      for (const path of fillings(route.path)) {
        const res = await call(route.method, path);
        if (res.status < 200 || res.status >= 300) continue;
        reached.add(`${route.method} ${route.path}`);
        for (const m of markers) {
          if (!res.text.includes(m)) continue;
          leaks.push(`${route.method} ${path} → ${m === ids['customerUser'] ? 'user id' : m}`);
        }
      }
    }

    expect(leaks).toEqual([]);
    // And the views that concern the customer were really read, not refused.
    expect([...reached]).toEqual(
      expect.arrayContaining([
        'POST /api/v1/search/missions',
        'GET /api/v1/quotes/me',
        'GET /api/v1/profiles/customer/:id',
      ]),
    );
  });

  it('names the customer only by a per-mission alias in the browse', async () => {
    const res = await call('POST', '/api/v1/search/missions');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { items: Array<{ id: string; customerAlias: string }> };
    const listed = body.items.find((m) => m.id === ids['mission']);
    expect(listed?.customerAlias).toBe(customerAliasOf(ids['mission']!));
  });
});
