import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../database/schema';
import { auditLogs, users } from '../../database/schema';
import { AuditService } from './audit.service';
import { testPool } from '../../../test/db';

describe('audit records', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  // Read as the owner: an entry belongs to the workspace it happened in, and the application
  // sees only its own (T-080). What the application may see is rls.spec.ts's subject.
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let audit: AuditService;

  beforeAll(() => {
    sql = testPool({ max: 2 });
    db = drizzle(sql, { schema });
    ownerSql = testPool({ max: 1, role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    audit = new AuditService(db);
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  const read = async (action: string) =>
    (await ownerDb.select().from(auditLogs).where(eq(auditLogs.action, action)))[0];

  it('stores an absent optional field as null, never as the string "undefined"', async () => {
    const action = `probe.minimal.${randomUUID()}`;
    await audit.record({ action, resourceType: 'probe' });
    expect(await read(action)).toMatchObject({
      correlationId: null,
      actorId: null,
      actorRole: null,
      resourceId: null,
      reason: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it('stores every field it is given', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `audit-${randomUUID()}@example.test` })
      .returning();
    const action = `probe.full.${randomUUID()}`;
    const event = {
      correlationId: `corr-${randomUUID()}`,
      actorId: user?.id,
      actorRole: 'CUSTOMER',
      action,
      resourceType: 'probe',
      resourceId: randomUUID(),
      reason: 'because',
      ipAddress: '198.51.100.20',
      userAgent: 'vitest',
    };
    await audit.record(event);
    expect(await read(action)).toMatchObject(event);
  });
});
