import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor, Role } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { KnowledgeDocumentsService } from './knowledge-documents.service';
import { parseDocument } from './knowledge-source';
import { KnowledgeSyncService } from './knowledge-sync.service';

const doc = (
  id: string,
  audience: string,
  visibility: string,
  locale: string,
  status: string,
  body: string,
) =>
  parseDocument(
    `docs/knowledge-base/x/${id}.${locale}.md`,
    [
      '---',
      `id: ${id}`,
      `title: Title of ${id} (${locale})`,
      `audience: ${audience}`,
      `visibility: ${visibility}`,
      `locale: ${locale}`,
      'version: 3',
      `status: ${status}`,
      'updated: 2026-09-25',
      'source_of_truth: docs',
      '---',
      '',
      body,
    ].join('\n'),
  )!;

const SOURCE = [
  doc(
    'kb-d-quotes',
    'customer',
    'authenticated',
    'en',
    'current',
    'How quotes work.\n\n## How long does a quote last?\n\nUntil it expires.\n\n## Can it change?\n\n- Only by a new quote.\n',
  ),
  doc('kb-d-policy', 'public', 'public', 'en', 'current', '## What is allowed?\n\nLawful work.\n'),
  doc(
    'kb-d-policy',
    'public',
    'public',
    'hy',
    'current',
    '## Ի՞նչ է թույլատրված։\n\nՕրինական աշխատանք։\n',
  ),
  doc('kb-d-staff', 'staff', 'staff', 'en', 'current', '## How do I moderate?\n\nZebracorn.\n'),
  doc(
    'kb-d-work',
    'investigator',
    'authenticated',
    'en',
    'current',
    '## How do I quote?\n\nCarefully.\n',
  ),
];

describe('opening a help article (T-059)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let documents: KnowledgeDocumentsService;

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    await new KnowledgeSyncService(db, new PlatformContext(audit), audit).sync(SOURCE, undefined, {
      correlationId: randomUUID(),
    });
    documents = asRequests(new KnowledgeDocumentsService(db, new AuthzService(audit)), owner);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const as = async (roles: Role[] = ['CUSTOMER'], over: Partial<Actor> = {}): Promise<Actor> => ({
    ...(await member(owner, { roles })).actor,
    ...over,
  });
  const req = () => ({ correlationId: randomUUID(), ip: '203.0.113.59' });

  it('gives a reader their article, every section in order', async () => {
    expect(await documents.read(await as(), 'kb-d-quotes', 'en', req())).toEqual({
      docKey: 'kb-d-quotes',
      version: 3,
      title: 'Title of kb-d-quotes (en)',
      locale: 'en',
      fallback: false,
      sections: [
        { heading: 'Title of kb-d-quotes (en)', content: 'How quotes work.' },
        { heading: 'How long does a quote last?', content: 'Until it expires.' },
        { heading: 'Can it change?', content: '- Only by a new quote.' },
      ],
    });
  });

  it('gives the English version, and says so, when the language asked for has none (drafts are never ingested)', async () => {
    const r = await documents.read(await as(), 'kb-d-quotes', 'ru', req());
    expect([r.locale, r.fallback, r.sections[1]?.heading]).toEqual([
      'en',
      true,
      'How long does a quote last?',
    ]);
    const hy = await documents.read(await as(), 'kb-d-policy', 'hy', req());
    expect([hy.locale, hy.fallback, hy.sections[0]?.heading]).toEqual([
      'hy',
      false,
      'Ի՞նչ է թույլատրված։',
    ]);
  });

  it('answers another audience’s article exactly as one that does not exist', async () => {
    const customer = await as();
    for (const key of ['kb-d-staff', 'kb-d-work', 'kb-d-nothing-here']) {
      await expect(documents.read(customer, key, 'en', req())).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    // Staff read staff guidance; an investigator reads theirs; everyone reads the public policy.
    expect((await documents.read(await as(['STAFF']), 'kb-d-staff', 'en', req())).title).toMatch(
      /staff/,
    );
    expect(
      (await documents.read(await as(['INVESTIGATOR']), 'kb-d-work', 'en', req())).title,
    ).toMatch(/work/);
    expect(
      (await documents.read(await as(['INVESTIGATOR']), 'kb-d-policy', 'en', req())).title,
    ).toMatch(/policy/);
  });

  it('reads as the role the reader acts as, not every role they hold', async () => {
    const both = await as(['CUSTOMER', 'INVESTIGATOR'], { activeRole: 'CUSTOMER' });
    await expect(documents.read(both, 'kb-d-work', 'en', req())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await documents.read(both, 'kb-d-quotes', 'en', req())).docKey).toBe('kb-d-quotes');
  });

  it('refuses an account that is not active, and a caller outside any workspace', async () => {
    await expect(
      documents.read(await as(['CUSTOMER'], { status: 'SUSPENDED' }), 'kb-d-quotes', 'en', req()),
    ).rejects.toMatchObject({ status: 403 });
    const bare = new KnowledgeDocumentsService(
      scopedDb(sql),
      new AuthzService(new AuditService(scopedDb(sql))),
    );
    await expect(bare.read(await as(), 'kb-d-quotes', 'en', req())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
