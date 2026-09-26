import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(() => 'export default async () => ({});\n'),
  write: vi.fn(),
}));
vi.mock('./metadata.generator', () => ({ generatePluginMetadata: mocks.generate }));
vi.mock('node:fs', () => ({ writeFileSync: mocks.write }));

afterEach(() => vi.restoreAllMocks());

it('writes src/metadata.ts from the package’s own tsconfig and source, and says so', async () => {
  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await import('./metadata.generator.main');
  const root = process.cwd();
  expect(mocks.generate).toHaveBeenCalledWith(`${root}/tsconfig.json`, `${root}/src`);
  expect(mocks.write).toHaveBeenCalledWith(
    `${root}/src/metadata.ts`,
    'export default async () => ({});\n',
  );
  expect(out).toHaveBeenCalledWith('Wrote src/metadata.ts\n');
});
