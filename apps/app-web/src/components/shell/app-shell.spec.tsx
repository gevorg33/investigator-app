import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';
import { DESTINATIONS } from './destinations';

const pathname = vi.hoisted(() => ({ current: '/missions/7' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

describe('the app shell', () => {
  const shell = () =>
    render(
      <AppShell>
        <p>Screen content</p>
      </AppShell>,
    );

  it('offers every destination in a bottom bar for phones and a sidebar from tablet up', () => {
    shell();
    const [rail, bar] = screen.getAllByRole('navigation', { name: 'Primary' }) as [
      HTMLElement,
      HTMLElement,
    ];
    // Mobile-first: the bar is there by default and leaves at md; the sidebar arrives at md.
    expect(bar).toHaveClass('fixed', 'bottom-0', 'md:hidden', 'pb-safe');
    expect(rail.closest('aside')).toHaveClass('hidden', 'md:flex');
    for (const nav of [rail, bar]) {
      expect(
        within(nav)
          .getAllByRole('link')
          .map((a) => a.getAttribute('href')),
      ).toEqual(DESTINATIONS.map((d) => d.href));
    }
  });

  it('marks where the reader is, in both, for assistive technology too', () => {
    pathname.current = '/missions/7';
    shell();
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Missions', '/missions'],
      ['Missions', '/missions'],
    ]);
    // Not colour alone: the bar item gains an indicator, the rail item a tinted shape.
    expect(current[0]).toHaveClass('bg-primary-subtle', 'text-primary', 'font-semibold');
    expect(current[1]).toHaveClass('text-primary', 'font-semibold', 'before:bg-primary');
    expect(screen.getAllByRole('link', { name: 'Home' })[0]).not.toHaveAttribute('aria-current');
  });

  it('lets a keyboard skip straight to the content, which clears the bottom bar', () => {
    shell();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#content',
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'content');
    expect(main).toHaveClass('pb-bottom-nav', 'md:pb-0');
    expect(within(main).getByText('Screen content')).toBeInTheDocument();
  });

  it('gives every navigation target at least 44px, and hides icons from screen readers', () => {
    shell();
    for (const link of screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') !== '#content')) {
      // min-h-16 in the bar (64px) and min-h-11 in the rail (44px).
      expect(link.className).toMatch(/\bmin-h-(16|11)\b/);
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
