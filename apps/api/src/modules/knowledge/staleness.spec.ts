import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from './knowledge-source';
import { gitLastChanged, staleDocuments } from './staleness';

const ROOT = join(__dirname, '../../../../..');

const doc = (
  updated: string,
  related: string[],
  status = 'current',
  implementation = 'implemented',
) =>
  parseDocument(
    'docs/knowledge-base/customer/stale.en.md',
    [
      '---',
      'id: kb-stale',
      'title: Stale',
      'audience: customer',
      'visibility: authenticated',
      'locale: en',
      'version: 1',
      `status: ${status}`,
      `updated: ${updated}`,
      'source_of_truth: docs',
      `implementation_status: ${implementation}`,
      'related_code:',
      ...related.map((r) => `  - ${r}`),
      '---',
      '',
      '## Is it stale?\n\nMaybe.\n',
    ].join('\n'),
  )!;

describe('documents older than the code they describe (T-016)', () => {
  const changes: Record<string, string> = {
    'apps/api/a': '2026-09-20',
    'apps/api/b': '2026-09-01',
  };
  const lastChanged = (p: string) => changes[p] ?? null;

  it('reports code changed after the document, and code that no longer exists', () => {
    expect(
      staleDocuments(
        [doc('2026-09-10', ['apps/api/a', 'apps/api/b', 'apps/api/gone'])],
        lastChanged,
      ),
    ).toEqual([
      {
        sourcePath: 'docs/knowledge-base/customer/stale.en.md',
        updatedOn: '2026-09-10',
        path: 'apps/api/a',
        changedOn: '2026-09-20',
      },
      {
        sourcePath: 'docs/knowledge-base/customer/stale.en.md',
        updatedOn: '2026-09-10',
        path: 'apps/api/gone',
        changedOn: null,
      },
    ]);
  });

  it('does not report missing code for a document that describes code still to be built', () => {
    expect(
      staleDocuments([doc('2026-09-10', ['apps/api/gone'], 'current', 'specified')], lastChanged),
    ).toEqual([]);
    // Code that exists and changed is still worth a look: the specification may now be built.
    expect(
      staleDocuments([doc('2026-09-10', ['apps/api/a'], 'current', 'specified')], lastChanged),
    ).toHaveLength(1);
  });

  it('does not report code changed the same day the document was updated', () => {
    expect(staleDocuments([doc('2026-09-20', ['apps/api/a'])], lastChanged)).toEqual([]);
  });

  it('ignores a document that is no longer current', () => {
    expect(staleDocuments([doc('2026-01-01', ['apps/api/a'], 'superseded')], lastChanged)).toEqual(
      [],
    );
  });

  it('reads the last change from git, and nothing for a path git does not know', () => {
    const last = gitLastChanged(ROOT);
    expect(last('package.json')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(last('apps/api/src/no-such-module')).toBeNull();
  });
});
