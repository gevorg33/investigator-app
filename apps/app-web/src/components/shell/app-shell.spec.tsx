import { catalogs, type Locale } from '@investigator/i18n';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/provider';
import userEvent from '@testing-library/user-event';
import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { api } from '@/test/api';
import { request } from '@/test/request';
import { AppShell } from './app-shell';
import { DESTINATIONS } from './destinations';

const pathname = vi.hoisted(() => ({ current: '/missions/7' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

describe('the app shell', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });

  const shell = async (locale: Locale = 'en') => {
    request.cookies.set('locale', locale);
    const frame = await AppShell({
      children: <p>Screen content</p>,
      beside: <aside>Beside the content</aside>,
    });
    return render(
      <I18nProvider
        locale={locale}
        messages={{ nav: catalogs[locale].nav, assistant: catalogs[locale].assistant }}
      >
        <AssistantProvider audience="CUSTOMER">{frame}</AssistantProvider>
      </I18nProvider>,
    );
  };
  const places = DESTINATIONS.filter((d) => d.href !== undefined);

  it('offers every destination in a bottom bar for phones and a sidebar from tablet up', async () => {
    await shell();
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
      ).toEqual(places.map((d) => d.href));
      // The assistant is in its place in the order, as a button: it opens beside the page.
      expect(within(nav).getAllByRole('listitem')[3]).toHaveTextContent('Assistant');
      expect(within(nav).getByRole('button', { name: 'Assistant' })).toBeInTheDocument();
    }
    expect(screen.getByText('Beside the content').previousElementSibling).toBe(
      screen.getByRole('main'),
    );
  });

  it('opens and closes the assistant from either navigation, saying which it is', async () => {
    api.on('GET /workspaces', 200, []);
    api.on('GET /ai/sessions?limit=1', 200, {
      items: [],
      pageInfo: { nextCursor: null, hasNextPage: false },
    });
    await shell();
    const [inRail, inBar] = screen.getAllByRole('button', { name: 'Assistant' }) as [
      HTMLElement,
      HTMLElement,
    ];
    for (const b of [inRail, inBar]) {
      expect(b).toHaveAttribute('aria-expanded', 'false');
      expect(b).not.toHaveAttribute('aria-controls');
    }
    await userEvent.click(inBar);
    for (const b of [inRail, inBar]) {
      expect(b).toHaveAttribute('aria-expanded', 'true');
      expect(b).toHaveAttribute('aria-controls', 'assistant-panel');
    }
    // Open is marked beyond colour too, as the current page is.
    expect(inRail).toHaveClass('bg-primary-subtle', 'font-semibold');
    expect(inBar).toHaveClass('before:bg-primary', 'font-semibold');
    expect(inBar).not.toHaveAttribute('aria-current');
    await userEvent.click(inRail);
    expect(inBar).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks where the reader is, in both, for assistive technology too', async () => {
    pathname.current = '/missions/7';
    await shell();
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Missions', '/missions'],
      ['Missions', '/missions'],
    ]);
    // Not colour alone: the rail item gains a tinted shape, the bar item an indicator.
    expect(current[0]).toHaveClass('bg-primary-subtle', 'text-primary', 'font-semibold');
    expect(current[1]).toHaveClass('text-primary', 'font-semibold', 'before:bg-primary');
    expect(screen.getAllByRole('link', { name: 'Home' })[0]).not.toHaveAttribute('aria-current');
  });

  it('speaks the reader’s language, on the server-rendered frame and in the client navigation', async () => {
    await shell('hy');
    expect(screen.getAllByRole('navigation', { name: catalogs.hy.shell.nav.label })).toHaveLength(
      2,
    );
    expect(
      screen.getByRole('link', { name: catalogs.hy.shell.skip_to_content }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Գործեր' })).toHaveLength(2);
  });

  it('lets a keyboard skip straight to the content, which clears the bottom bar', async () => {
    await shell();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#content',
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'content');
    expect(main).toHaveClass('pb-bottom-nav', 'md:pb-0');
    expect(within(main).getByText('Screen content')).toBeInTheDocument();
  });

  it('gives every navigation target at least 44px, and hides icons from screen readers', async () => {
    await shell();
    for (const link of [
      ...screen.getAllByRole('link').filter((a) => a.getAttribute('href') !== '#content'),
      ...screen.getAllByRole('button', { name: 'Assistant' }),
    ]) {
      // min-h-16 in the bar (64px) and min-h-11 in the rail (44px).
      expect(link.className).toMatch(/\bmin-h-(16|11)\b/);
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
