import { vi } from 'vitest';

/** What `redirect()` throws in a spec, so the spec can see where it was sent. */
export class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}

/** What `notFound()` throws in a spec. */
export class NotFound extends Error {
  constructor() {
    super('not found');
  }
}

/** A stand-in for Next's router, for specs that mock `next/navigation` with `nextNavigation`. */
export const router = {
  pathname: '/',
  push: vi.fn(),
  refresh: vi.fn(),
  reset() {
    this.pathname = '/';
    this.push.mockReset();
    this.refresh.mockReset();
  },
};

export const nextNavigation = {
  usePathname: () => router.pathname,
  useRouter: () => router,
  redirect: (url: string) => {
    throw new Redirected(url);
  },
  notFound: () => {
    throw new NotFound();
  },
};
