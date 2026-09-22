import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/validate-knowledge-base.py');
const MARKER = '<!-- not-for-ingestion -->';

/** Runs the real validator from `cwd`, the way CI runs it from the repository root. */
const validate = (cwd: string) => {
  const run = spawnSync('python3', [SCRIPT], { cwd, encoding: 'utf8' });
  return { code: run.status, output: `${run.stdout}${run.stderr}` };
};

const frontmatter = (over: Record<string, string> = {}): string => {
  const fields = {
    id: 'kb-test-article',
    title: 'A test article',
    audience: 'customer',
    visibility: 'authenticated',
    locale: 'en',
    version: '1',
    status: 'current',
    updated: '2026-09-23',
    source_of_truth: 'docs',
    ...over,
  };
  return `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n`;
};

const article = (
  over: Record<string, string> = {},
  body = '## How do I test this?\n\nLike so.\n',
) => `${frontmatter(over)}\n# Title\n\n${body}`;

/**
 * The knowledge-base validator, exercised (T-015).
 *
 * It is the one control between an article and the Assistant that exists today: retrieval-time
 * visibility enforcement is T-016/T-017's, and until then a single mis-set frontmatter field is
 * the whole difference between a staff runbook and a public answer. So the cases that matter are
 * run against the real script, not a reimplementation of it.
 */
describe('the knowledge-base validator', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** A repository-shaped directory holding only the files given, relative to its root. */
  const repo = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'docs/knowledge-base'), { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  };

  it('passes a well-formed article', () => {
    const run = validate(repo({ 'docs/knowledge-base/customer/a.en.md': article() }));
    expect(run.output).toContain('0 error(s)');
    expect(run.code).toBe(0);
  });

  it('fails a staff article marked public — the case this exists for', () => {
    const run = validate(
      repo({
        'docs/knowledge-base/staff/runbook.en.md': article({
          audience: 'staff',
          visibility: 'public',
        }),
      }),
    );
    expect(run.code).toBe(1);
    expect(run.output).toMatch(/visibility='public' is wrong for staff\//);
  });

  it('fails an article with no frontmatter, which ingestion would reject', () => {
    const run = validate(repo({ 'docs/knowledge-base/customer/a.en.md': '# Just prose\n' }));
    expect(run.code).toBe(1);
    expect(run.output).toContain('missing or unterminated frontmatter');
  });

  it('fails a field outside its allowed values', () => {
    const run = validate(
      repo({ 'docs/knowledge-base/customer/a.en.md': article({ visibility: 'everyone' }) }),
    );
    expect(run.code).toBe(1);
    expect(run.output).toContain("visibility='everyone'");
  });

  it('fails an implementation status that means nothing', () => {
    // Optional, but a reader trusts it to say whether the product does this yet.
    const run = validate(
      repo({
        'docs/knowledge-base/customer/a.en.md': article({ implementation_status: 'implmented' }),
      }),
    );
    expect(run.code).toBe(1);
    expect(run.output).toContain("implementation_status='implmented'");
  });

  it('fails an operations document copied into the knowledge base, frontmatter and all', () => {
    // The runbook route: someone gives an escalation procedure frontmatter so it validates.
    const run = validate(
      repo({
        'docs/knowledge-base/staff/escalation.en.md': article(
          { audience: 'staff', visibility: 'staff' },
          `${MARKER}\n\n## Who do I call?\n\nThe procedure.\n`,
        ),
      }),
    );
    expect(run.code).toBe(1);
    expect(run.output).toContain('marked not-for-ingestion');
  });

  it('fails a symlink, whatever it points at', () => {
    const dir = repo({ 'docs/operations/escalation.md': `# Escalation\n\n${MARKER}\n` });
    mkdirSync(join(dir, 'docs/knowledge-base/staff'), { recursive: true });
    symlinkSync(join(dir, 'docs/operations'), join(dir, 'docs/knowledge-base/staff/ops'));
    const run = validate(dir);
    expect(run.code).toBe(1);
    expect(run.output).toContain('symlinks are not allowed');
  });

  it('fails when the knowledge base is missing, rather than passing on nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-'));
    dirs.push(dir);
    expect(validate(dir).code).toBe(1);
  });

  it('fails a translation whose English source is gone', () => {
    const run = validate(
      repo({ 'docs/knowledge-base/customer/a.hy.md': article({ locale: 'hy' }) }),
    );
    expect(run.code).toBe(1);
    expect(run.output).toContain('orphan translation');
  });
});

describe('the repository’s own documents', () => {
  it('validate, with no errors and no warnings', () => {
    const run = validate(ROOT);
    expect(run.output).toContain('0 error(s), 0 warning(s)');
    expect(run.code).toBe(0);
  });

  it('mark every operations document not-for-ingestion, and give none of them frontmatter', () => {
    // Both halves of the construction: the marker is what the validator refuses, and without
    // frontmatter an operations file could not be ingested even if the marker were removed.
    const ops = readdirSync(join(ROOT, 'docs/operations')).filter((f) => f.endsWith('.md'));
    expect(ops.length).toBeGreaterThan(2);
    for (const file of ops) {
      const text = readFileSync(join(ROOT, 'docs/operations', file), 'utf8');
      expect(text, file).toContain(MARKER);
      expect(text.startsWith('---\n'), file).toBe(false);
    }
  });

  it('are checked on every pull request', () => {
    const steps = readFileSync(join(ROOT, '.github/workflows/pr.yml'), 'utf8').replace(
      /^\s*#.*$/gm,
      '',
    );
    expect(steps).toMatch(/run: python3 scripts\/validate-knowledge-base\.py/);
  });
});
