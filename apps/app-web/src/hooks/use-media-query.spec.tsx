import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './use-media-query';

function Probe() {
  return <p>{useMediaQuery('(min-width: 64rem)') ? 'wide' : 'narrow'}</p>;
}

describe('a media query, as state', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false on the server, so the phone layout is what hydrates', () => {
    expect(renderToString(<Probe />)).toContain('narrow');
  });

  it('follows the window as it changes, and stops listening when it goes', () => {
    const listeners = new Set<() => void>();
    const size = { wide: true };
    const queried: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      queried.push(query);
      return {
        matches: size.wide,
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      };
    });
    const { unmount } = render(<Probe />);
    expect(screen.getByText('wide')).toBeInTheDocument();
    expect(queried.every((q) => q === '(min-width: 64rem)')).toBe(true);
    size.wide = false;
    act(() => listeners.forEach((l) => l()));
    expect(screen.getByText('narrow')).toBeInTheDocument();
    unmount();
    expect(listeners.size).toBe(0);
  });
});
