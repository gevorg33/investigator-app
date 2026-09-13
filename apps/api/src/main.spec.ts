import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(async () => undefined) }));
vi.mock('./bootstrap', () => ({ bootstrap: mocks.bootstrap }));

it('starts the application when run as the entry point', async () => {
  await import('./main');
  expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
});
