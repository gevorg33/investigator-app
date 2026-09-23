import { execFileSync } from 'node:child_process';
import type { SourceDocument } from './knowledge-source';

export interface StaleDocument {
  sourcePath: string;
  /** When a person last said the document was true (its frontmatter `updated`). */
  updatedOn: string;
  /** Code the document describes that changed after that. */
  path: string;
  /** Null when the path does not exist in the repository. */
  changedOn: string | null;
}

/**
 * Documents whose `related_code` changed after the document was last updated (T-016,
 * `documentation-first`). A report for a person, never an automatic edit: code can change without
 * changing what the document says, and only someone reading both can tell.
 *
 * `lastChanged` returns a path's last commit date as YYYY-MM-DD, or null for a path git does not
 * know. A missing path is reported for a document that says it is implemented — it describes code
 * that is not there — and not for one that is `specified`, which points at code still to be built.
 */
export function staleDocuments(
  docs: readonly SourceDocument[],
  lastChanged: (path: string) => string | null,
): StaleDocument[] {
  const stale: StaleDocument[] = [];
  for (const doc of docs) {
    if (doc.status !== 'current') continue;
    for (const path of doc.relatedCode) {
      const changedOn = lastChanged(path);
      const outdated =
        changedOn === null ? doc.implementationStatus !== 'specified' : changedOn > doc.updatedOn;
      if (outdated) {
        stale.push({ sourcePath: doc.sourcePath, updatedOn: doc.updatedOn, path, changedOn });
      }
    }
  }
  return stale;
}

/** Last commit date of `path` in the repository at `root`, from git. */
export const gitLastChanged =
  (root: string) =>
  (path: string): string | null => {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', path], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    return out === '' ? null : out;
  };
