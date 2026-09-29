import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runWorker: vi.fn(async () => 0) }));
vi.mock('./common/jobs/worker', () => ({ runWorker: mocks.runWorker }));

afterEach(() => vi.restoreAllMocks());

it('runs the worker with the environment, and stops it on SIGTERM or SIGINT', async () => {
  const handlers = new Map<string, () => void>();
  vi.spyOn(process, 'once').mockImplementation(((event: string, fn: () => void) => {
    handlers.set(event, fn);
    return process;
  }) as typeof process.once);
  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

  await import('./worker.main');
  const [[opts]] = mocks.runWorker.mock.calls as unknown as [
    [{ env: unknown; signal: AbortSignal; out: (l: string) => void }],
  ];
  expect(opts.env).toBe(process.env);
  expect(opts.signal.aborted).toBe(false);
  opts.out('worker: stopping');
  expect(out).toHaveBeenCalledWith('worker: stopping\n');

  expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
  handlers.get('SIGTERM')!();
  expect(opts.signal.aborted).toBe(true);
  handlers.get('SIGINT')!();

  await vi.waitFor(() => expect(process.exitCode).toBe(0));
  process.exitCode = undefined;
});
