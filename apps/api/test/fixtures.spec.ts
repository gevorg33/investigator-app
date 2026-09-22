import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as assignments from './assignment-fixtures';
import * as legal from './legal-fixtures';
import * as media from './media-fixtures';
import * as missions from './mission-fixtures';
import * as profiles from './profile-fixtures';
import * as quotes from './quote-fixtures';
import * as search from './search-fixtures';
import * as serviceAreas from './service-area-fixtures';
import * as verification from './verification-fixtures';
import * as workspaces from './workspace-fixtures';

const TEST_DIR = __dirname;
const SRC_DIR = join(__dirname, '../src');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );

const fixtureFiles = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('-fixtures.ts'))
  .map((f) => ({ path: f, source: readFileSync(join(TEST_DIR, f), 'utf8') }));

/**
 * Who creates what (T-042).
 *
 * Every table that holds a workspace's own data, or a marketplace row between two of them,
 * is either built by a named factory or written by the thing that owns it. The registry in
 * `table-classes.ts` is the input, so a new domain table fails this test until somebody has
 * decided which of the two it is — the alternative being that the next person to need one
 * writes their own INSERT and the constraints drift apart, which is how `quotableMission`
 * came to exist in the first place.
 */
const FACTORY_FOR: Readonly<Record<string, string>> = {
  customer_profiles: 'profile-fixtures.customerProfile',
  investigator_profiles: 'search-fixtures.discoverable',
  investigator_languages: 'search-fixtures.discoverable',
  investigator_specialties: 'search-fixtures.discoverable',
  investigator_availability: 'search-fixtures.discoverable',
  service_areas: 'service-area-fixtures.investigator',
  media_assets: 'verification-fixtures.document',
  verification_requests: 'verification-fixtures.submittedAt',
  missions: 'quote-fixtures.quotableMission',
  quotes: 'quote-fixtures.submittedQuote',
  assignments: 'assignment-fixtures.assignment',
  investigation_sources: 'assignment-fixtures.investigationSource',
};

/** Tables a factory must NOT write, because something else is what makes them true. */
const WRITTEN_BY: Readonly<Record<string, string>> = {
  mission_status_history:
    'the mission transition that produced it — inserting one directly would record a move that never happened',
  assignment_status_history: 'the assignment transition that produced it',
  mission_screenings: 'the policy screening at submission (T-010)',
  verification_request_documents:
    'the verification submission; the rows are append-only by trigger (T-013)',
  verification_decisions: 'the reviewer`s decision; append-only by trigger',
  idempotency_keys: 'the idempotency service, which is the subject of its own specs',
};

const domainTables = (): string[] => {
  const source = readFileSync(join(SRC_DIR, 'database/table-classes.ts'), 'utf8');
  const registry = source.slice(source.indexOf('TABLE_CLASSES'));
  return [...registry.matchAll(/\n {2}([a-z_]+): \{\s*class: '(tenant_owned|two_party)'/g)].map(
    (m) => m[1]!,
  );
};

describe('factories', () => {
  it('found the fixture files', () => {
    expect(fixtureFiles.length).toBeGreaterThan(5);
  });

  it('cover every table a test would need to create', () => {
    const covered = new Set([...Object.keys(FACTORY_FOR), ...Object.keys(WRITTEN_BY)]);
    const missing = domainTables().filter((t) => !covered.has(t));
    expect(missing).toEqual([]);
  });

  it('name factories that exist', () => {
    const modules: Record<string, Record<string, unknown>> = {
      'assignment-fixtures': assignments,
      'media-fixtures': media,
      'mission-fixtures': missions,
      'profile-fixtures': profiles,
      'quote-fixtures': quotes,
      'search-fixtures': search,
      'service-area-fixtures': serviceAreas,
      'verification-fixtures': verification,
      'workspace-fixtures': workspaces,
      'legal-fixtures': legal,
    };
    for (const ref of Object.values(FACTORY_FOR)) {
      const [file, name] = ref.split('.') as [string, string];
      expect(typeof modules[file]?.[name], ref).toBe('function');
    }
  });

  it('take overrides, so a test can vary one thing and leave the rest alone', () => {
    // A factory with no seam forces the next test that needs a variation to abandon it and
    // write its own INSERT, which is how fixtures stop being shared and constraints drift.
    // Only the ones that CREATE something are held to this; a helper that reads is not a
    // factory, and a required argument is an explicit override already.
    const rigid = fixtureFiles
      .flatMap((f) =>
        [
          ...f.source.matchAll(
            /export async function (\w+)\(([\s\S]*?)\n\): [^{]*\{([\s\S]*?)\n\}/g,
          ),
        ].map((m) => ({ file: f.path, name: m[1]!, signature: m[2] ?? '', body: m[3] ?? '' })),
      )
      .filter((fn) => /\.insert\(|INSERT INTO/.test(fn.body))
      .filter((fn) => !/opts|input|over|\?:|=\s/.test(fn.signature))
      .map((fn) => `${fn.file}: ${fn.name}`);
    expect(rigid).toEqual([]);
  });
});

/**
 * No real or realistic personal data, anywhere in the suite (T-042).
 *
 * Fixtures get copied into bug reports, CI logs and screenshots. An address that looks real
 * enough to be somebody's is a disclosure waiting for a coincidence, and on a platform whose
 * evidence is about people who are not users, the habit matters more than the instance.
 */
describe('fixtures carry no personal data', () => {
  const sources = [...walk(TEST_DIR), ...walk(SRC_DIR).filter((f) => f.endsWith('.spec.ts'))].map(
    (path) => ({ path, source: readFileSync(path, 'utf8') }),
  );

  it('found the files to check', () => {
    expect(sources.length).toBeGreaterThan(60);
  });

  it('address every email to a domain that cannot exist', () => {
    // RFC 2606 reserves the whole `.test` TLD and the `example.*` names: they resolve nowhere
    // and receive nothing, so a fixture address can never reach a person by accident.
    //
    // Matched on the domain rather than the whole address, because almost every fixture builds
    // the local part by interpolation — `${randomUUID()}@example.test` — and a pattern that
    // needs a word character before the `@` sees none of them.
    const reserved = /(\.test|^example\.(com|org|net))$/;
    const stray = sources.flatMap((f) =>
      [...f.source.matchAll(/@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)]
        // A connection string is not an address: `user:password@host` has the same shape.
        .filter((m) => !/:\/\/[^\s'"`]*$/.test(f.source.slice(0, m.index).slice(-120)))
        .filter((m) => !reserved.test(m[1]!.toLowerCase()))
        .map((m) => `${f.path}: ${m[0]}`),
    );
    expect(stray).toEqual([]);
  });

  it('use no number that could be dialled', () => {
    // 555-01xx is the reserved fictional range; an international-format number is not.
    const dialable = sources.flatMap((f) =>
      [...f.source.matchAll(/'\+\d[\d\s()-]{7,}'/g)].map((m) => `${f.path}: ${m[0]}`),
    );
    expect(dialable).toEqual([]);
  });
});
