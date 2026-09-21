import type postgres from 'postgres';
import { REQUIRED_AT_REGISTRATION, requiredForRole } from '../src/modules/legal/legal.policy';
import type { ConsentContext, LegalDocumentType } from '../src/modules/legal/legal.service';

/**
 * Satisfying the acceptance gate in suites that are not about it (T-022).
 *
 * The gate is global: once a document is published, registration and role activation require it.
 * A spec whose subject is quotes or media still has to get past it — so it accepts what is in
 * force, the way a client would, rather than the gate being softened for tests.
 *
 * Until T-042 this file also held an advisory lock, because every suite shared one database and
 * a suite that published terms decided another suite's registration. Each worker now has its own
 * database, emptied between spec files, so there is nothing left to serialise.
 *
 * Written as the owner, like every fixture (T-073).
 */
export async function currentDocumentIds(
  owner: postgres.Sql,
  types: readonly LegalDocumentType[],
): Promise<string[]> {
  if (types.length === 0) return [];
  const rows = await owner<{ id: string }[]>`
    SELECT id FROM legal_documents
     WHERE status = 'CURRENT'
       AND type = ANY(${[...types]}::legal_document_type[])`;
  return rows.map((r) => r.id);
}

/** The documents registration requires right now — empty when none are published. */
export const registrationDocumentIds = (owner: postgres.Sql): Promise<string[]> =>
  currentDocumentIds(owner, REQUIRED_AT_REGISTRATION);

/** The documents activating `role` requires right now. */
export const roleDocumentIds = (
  owner: postgres.Sql,
  role: 'CUSTOMER' | 'INVESTIGATOR',
): Promise<string[]> => currentDocumentIds(owner, requiredForRole(role));

/**
 * Records acceptance of everything currently in force for `types`, for a user who was created by
 * a fixture rather than through registration. The rows are real consent rows: the database
 * checks each one against the document it names (T-021), so this cannot record a fiction.
 */
export async function acceptCurrent(
  owner: postgres.Sql,
  userId: string,
  types: readonly LegalDocumentType[],
  opts: { action?: 'ACCEPTED' | 'WITHDRAWN'; context?: ConsentContext } = {},
): Promise<void> {
  await owner`
    INSERT INTO user_consents (user_id, legal_document_id, document_type, document_version,
                               content_hash, locale_shown, action, context)
    SELECT ${userId}, d.id, d.type, d.version, d.content_hash, d.locale,
           ${opts.action ?? 'ACCEPTED'}, ${opts.context ?? 'REGISTRATION'}
      FROM legal_documents d
     WHERE d.status = 'CURRENT'
       AND d.type = ANY(${[...types]}::legal_document_type[])`;
}
