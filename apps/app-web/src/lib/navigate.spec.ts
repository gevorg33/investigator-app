import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceTimeZone, forgetQuery, navigate } from './navigate';

describe('leaving a page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads the next page in full', () => {
    // jsdom follows only in-page navigation; a fragment is enough to see `assign` was used.
    navigate('#sessions');
    expect(window.location.hash).toBe('#sessions');
  });

  it('takes a one-time token out of the address bar without adding to history', () => {
    window.history.pushState(null, '', '/verify-email?token=secret');
    const length = window.history.length;
    forgetQuery();
    expect(window.location.pathname + window.location.search).toBe('/verify-email');
    expect(window.history.length).toBe(length);
  });
});

describe('the device’s time zone', () => {
  afterEach(() => vi.restoreAllMocks());

  const zone = (timeZone: unknown) =>
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone }),
    } as unknown as Intl.DateTimeFormat);

  it('is the IANA name the browser reports', () => {
    zone('Asia/Yerevan');
    expect(deviceTimeZone()).toBe('Asia/Yerevan');
  });

  it.each([['+04:00'], [undefined]])('is left out when the browser reports %s', (value) => {
    zone(value);
    expect(deviceTimeZone()).toBeUndefined();
  });
});
