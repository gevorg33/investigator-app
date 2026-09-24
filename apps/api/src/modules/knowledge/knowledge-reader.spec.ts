import { describe, expect, it } from 'vitest';
import type { Role } from '../../common/authz/contract';
import { runInContext } from '../../common/context/execution-context';
import { knowledgeReader, mayRead, type ReadableRow } from './knowledge-reader';

const personal = { tenantKind: 'PERSONAL' as const };
const reader = (roles: Role[], activeRole?: Role, tenantKind: 'PERSONAL' | 'AGENCY' = 'PERSONAL') =>
  knowledgeReader({ roles, activeRole }, { tenantKind });

describe('who reads which knowledge (T-017)', () => {
  it.each([
    [['CUSTOMER'], ['public', 'customer'], ['public', 'authenticated']],
    [['INVESTIGATOR'], ['public', 'investigator'], ['public', 'authenticated']],
    [['STAFF'], ['public', 'staff'], ['public', 'authenticated', 'staff']],
    [
      ['CUSTOMER', 'INVESTIGATOR'],
      ['public', 'customer', 'investigator'],
      ['public', 'authenticated'],
    ],
  ] as const)('%j reads %j at %j', (roles, audiences, visibilities) => {
    expect(knowledgeReader({ roles: [...roles] }, personal)).toEqual({ audiences, visibilities });
  });

  it('reads as the one role someone has narrowed themselves to', () => {
    expect(reader(['CUSTOMER', 'STAFF'], 'CUSTOMER')).toEqual({
      audiences: ['public', 'customer'],
      visibilities: ['public', 'authenticated'],
    });
  });

  it('adds agency guidance inside an agency workspace, and only there', () => {
    expect(reader(['INVESTIGATOR'], undefined, 'AGENCY').audiences).toEqual([
      'public',
      'investigator',
      'agency',
    ]);
    expect(reader(['INVESTIGATOR']).audiences).not.toContain('agency');
  });

  it('never serves a participant document — a knowledge question names no mission', () => {
    for (const roles of [['CUSTOMER'], ['INVESTIGATOR'], ['STAFF']] as Role[][]) {
      expect(reader(roles).visibilities).not.toContain('participant');
    }
  });
});

describe('the gate after loading', () => {
  const customer = reader(['CUSTOMER']);
  const row = (over: Partial<ReadableRow> = {}): ReadableRow => ({
    status: 'current',
    audience: 'customer',
    visibility: 'authenticated',
    tenantId: null,
    ...over,
  });

  /** In workspace `ws-1`, as a request would be. */
  const inWs1 = <T>(fn: () => T): T =>
    runInContext(
      {
        tenantId: 'ws-1',
        tenantKind: 'PERSONAL',
        userId: 'u1',
        membershipId: 'm1',
        sessionId: 's1',
        permissions: [],
      },
      fn,
    );

  it('passes a current platform document for this audience, and this workspace’s own', () => {
    inWs1(() => {
      expect(mayRead(customer, row())).toBe(true);
      expect(mayRead(customer, row({ tenantId: 'ws-1' }))).toBe(true);
    });
  });

  it.each([
    ['a superseded document', { status: 'superseded' }],
    ['another audience', { audience: 'investigator' }],
    ['staff visibility', { audience: 'customer', visibility: 'staff' }],
    ['participant visibility', { visibility: 'participant' }],
    ['another workspace’s document', { tenantId: 'ws-2' }],
  ] as const)('drops %s', (_label, over) => {
    inWs1(() => expect(mayRead(customer, row(over))).toBe(false));
  });

  it('passes only the platform’s documents outside any workspace', () => {
    expect(mayRead(customer, row())).toBe(true);
    expect(mayRead(customer, row({ tenantId: 'ws-1' }))).toBe(false);
  });
});
