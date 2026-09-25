import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

/*
 * What a browser has and jsdom does not, for the adopted components that reach for it (T-054):
 * vaul reads `matchMedia` and captures the pointer, cmdk scrolls the chosen item into view, and Radix measures with
 * `ResizeObserver`. Each is the smallest stand-in that lets a component run; none decides a result
 * a spec asserts. `matchMedia` answers "no" — the phone layout — unless a spec says otherwise.
 */
if (typeof window !== 'undefined') {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Element.prototype.scrollIntoView ??= () => undefined;
  // vaul captures the pointer to follow a drag of the sheet.
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
