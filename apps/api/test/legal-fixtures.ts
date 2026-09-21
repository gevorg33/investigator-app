import type postgres from 'postgres';
import { REQUIRED_AT_REGISTRATION, requiredForRole } from '../src/modules/legal/legal.policy';
import type { LegalDocumentType } from '../src/modules/legal/legal.service';

/**
 * Published documents are one global thing, and the suites share one database (T-022).
 *
 * The gate is global by design: once a version is in force, registration and role activation
 * require it. That makes "what is published" shared state between suites running in parallel —
 * one suite publishing the terms changes what another suite's registration must accept, and one
 * clearing them changes it back. Rather than weaken the gate for tests, the suites take a lock:
 * a publisher takes it exclusively, and anything that merely has to get past the gate takes it
 * shared, so readers still run together.
 *
 * The lock is held on one connection, which is why these pools are created with `max: 1`.
 */
const DOCUMENTS_LOCK = 4_820_221;

/** The connection each suite holds its lock on — taken and released on the same one. */
const held = new Map<postgres.Sql, postgres.ReservedSql>();

export async function lockDocuments(
  owner: postgres.Sql,
  mode: 'exclusive' | 'shared' = 'shared',
): Promise<void> {
  const reserved = await owner.reserve();
  held.set(owner, reserved);
  await (mode === 'exclusive'
    ? reserved`SELECT pg_advisory_lock(${DOCUMENTS_LOCK})`
    : reserved`SELECT pg_advisory_lock_shared(${DOCUMENTS_LOCK})`);
}

export async function unlockDocuments(
  owner: postgres.Sql,
  mode: 'exclusive' | 'shared' = 'shared',
): Promise<void> {
  const reserved = held.get(owner);
  if (reserved === undefined) return;
  await (mode === 'exclusive'
    ? reserved`SELECT pg_advisory_unlock(${DOCUMENTS_LOCK})`
    : reserved`SELECT pg_advisory_unlock_shared(${DOCUMENTS_LOCK})`);
  reserved.release();
  held.delete(owner);
}

/**
 * Satisfying the acceptance gate in suites that are not about it (T-022).
 *
 * The gate is global: once a document is published, registration and role activation require it,
 * and the development database is shared between suites. A spec whose subject is quotes or media
 * still has to get past it — so it accepts what is in force, the way a client would, rather than
 * the gate being softened for tests.
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
): Promise<void> {
  await owner`
    INSERT INTO user_consents (user_id, legal_document_id, document_type, document_version,
                               content_hash, locale_shown, action, context)
    SELECT ${userId}, d.id, d.type, d.version, d.content_hash, d.locale, 'ACCEPTED', 'REGISTRATION'
      FROM legal_documents d
     WHERE d.status = 'CURRENT'
       AND d.type = ANY(${[...types]}::legal_document_type[])`;
}
