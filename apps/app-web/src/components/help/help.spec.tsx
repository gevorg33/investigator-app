import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HelpArticlePage, { generateMetadata } from '@/app/(workspace)/help/[docKey]/page';
import { slug } from '@/lib/slug';
import { api, apiError } from '@/test/api';
import { NotFound } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import { ArticleBody, blocks, inline } from './article-body';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const ARTICLE = {
  docKey: 'kb-customer-quotes',
  version: 4,
  title: 'Quotes and expiry',
  locale: 'en',
  fallback: false,
  sections: [
    { heading: 'Quotes and expiry', content: 'What a quote is.' },
    {
      heading: 'How long does a quote stay valid?',
      content: 'Until **the validity period** ends.\n\n- One\n- Two, which\n  goes on\n\n> A note.',
    },
  ],
};

describe('help articles (T-059)', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });

  const page = async (docKey = 'kb-customer-quotes') =>
    render(await resolveServer(await HelpArticlePage({ params: Promise.resolve({ docKey }) })));

  it('shows the article the reader may read, each section reachable by its heading', async () => {
    request.cookies.set('locale', 'ru');
    api.on('GET /knowledge/documents/kb-customer-quotes?locale=ru', 200, {
      ...ARTICLE,
      fallback: true,
    });
    await page();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Quotes and expiry' }),
    ).toBeInTheDocument();
    // The introduction has no heading of its own: the article's title is it.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'How long does a quote stay valid?',
    ]);
    const section = screen.getByRole('region', { name: 'How long does a quote stay valid?' });
    expect(section).toHaveAttribute('id', slug('How long does a quote stay valid?'));
    expect(screen.getByRole('article')).toHaveAttribute('lang', 'en');
    // In English, and it says why — in the reader's language.
    expect(screen.getByText(/ещё не переведена/)).toBeInTheDocument();
  });

  it('says nothing about language when the article is in the reader’s', async () => {
    api.on('GET /knowledge/documents/kb-customer-quotes?locale=en', 200, ARTICLE);
    await page();
    expect(screen.queryByText(/not yet available in your language/)).toBeNull();
    expect(
      (await generateMetadata({ params: Promise.resolve({ docKey: 'kb-customer-quotes' }) })).title,
    ).toBe('Quotes and expiry');
  });

  it('is not found when the API says so — another audience’s article looks exactly like none', async () => {
    api.on(
      'GET /knowledge/documents/kb-staff-moderation?locale=en',
      404,
      apiError('NOT_FOUND', 'error.common.not_found'),
    );
    await expect(page('kb-staff-moderation')).rejects.toBeInstanceOf(NotFound);
  });

  it('passes any other failure on', async () => {
    api.on(
      'GET /knowledge/documents/kb-customer-quotes?locale=en',
      500,
      apiError('INTERNAL_ERROR', 'error.common.internal'),
    );
    await expect(page()).rejects.toMatchObject({ status: 500 });
  });

  describe('the article text', () => {
    it('reads paragraphs, lists — a continuation joined to its item — numbered lists, quotes and tables', () => {
      expect(
        blocks(
          'First line\nsame paragraph.\n\n- a\n- b\n  continued\n\n1. one\n2. two\n\n> quoted\n> more\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n   \n',
        ),
      ).toEqual([
        { kind: 'paragraph', text: 'First line same paragraph.' },
        { kind: 'list', ordered: false, items: ['a', 'b continued'] },
        { kind: 'list', ordered: true, items: ['one', 'two'] },
        { kind: 'quote', text: 'quoted more' },
        { kind: 'table', head: ['A', 'B'], rows: [['1', '2']] },
      ]);
    });

    it('renders bold and code, and treats everything else — markup included — as text', () => {
      render(
        <ArticleBody
          markdown={
            'Use **bold** and `code`, not <b>html</b> or ** or ``.\n\n1. first\n\n| Status | Meaning |\n|---|---|\n| **Draft** | Only you |\n\n> quoted'
          }
        />,
      );
      expect(screen.getByText('bold').tagName).toBe('STRONG');
      expect(screen.getByText('code').tagName).toBe('CODE');
      expect(screen.getByText(/not <b>html<\/b> or \*\* or ``\./)).toBeInTheDocument();
      expect(document.querySelector('b')).toBeNull();
      expect(screen.getByRole('list').tagName).toBe('OL');
      const table = screen.getByRole('table');
      expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
      expect(within(table).getByText('Draft').tagName).toBe('STRONG');
      // A table scrolls in its own box, never the page.
      expect(table.parentElement).toHaveClass('overflow-x-auto');
      expect(screen.getByText('quoted').closest('blockquote')).not.toBeNull();
      expect(inline('plain')).toEqual(['plain']);
    });
  });

  it('makes the same id for a heading wherever it is made, in any script', () => {
    expect(slug('How long does a quote stay valid?')).toBe('how-long-does-a-quote-stay-valid');
    expect(slug('Ի՞նչ է թույլատրված։')).toBe('ի-նչ-է-թույլատրված');
    expect(slug('  Кто видит — мои данные?  ')).toBe('кто-видит-мои-данные');
  });
});
