import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(async () => 3) }));
vi.mock('./knowledge-sync.cli', () => ({ runKnowledgeSync: mocks.run }));

afterEach(() => {
  process.exitCode = undefined;
});

it('runs the command with the process’s own arguments, and exits with its code', async () => {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await import('./knowledge-sync.main');
  await vi.waitFor(() => expect(process.exitCode).toBe(3));

  const [opts] = mocks.run.mock.calls[0] as unknown as [
    { argv: string[]; env: unknown; cwd: string; out: (l: string) => void },
  ];
  expect([opts.argv, opts.env, opts.cwd]).toEqual([
    process.argv.slice(2),
    process.env,
    process.cwd(),
  ]);
  opts.out('hello');
  expect(write).toHaveBeenCalledWith('hello\n');
  write.mockRestore();
});
