import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/messages';
import type { LatencyReport } from '@/lib/api/types';
import { duration } from '@/lib/format';
import { api, apiError } from '@/test/api';
import { router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import LatencyPage from './page';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const HOUR = 3_600_000;
const TAXONOMY = [
  { id: 'node-records', label: 'Records checks', slug: 'records', children: [] },
  { id: 'node-partner', label: null, slug: 'relationships', children: [] },
];

const report = (over: Partial<LatencyReport> = {}): LatencyReport => ({
  days: 90,
  rows: [
    {
      taxonomyNodeId: 'node-partner',
      riskBand: 'RESTRICTED',
      decided: 1,
      medianMs: 30 * HOUR,
      p90Ms: 30 * HOUR,
      longestMs: 72 * HOUR,
      outcomes: { published: 0, changesRequested: 0, rejected: 1 },
    },
    {
      taxonomyNodeId: 'node-records',
      riskBand: 'STANDARD',
      decided: 4,
      medianMs: 2.5 * HOUR,
      p90Ms: 3.7 * HOUR,
      longestMs: 4 * HOUR,
      outcomes: { published: 2, changesRequested: 1, rejected: 1 },
    },
    {
      taxonomyNodeId: null,
      riskBand: 'HIGH',
      decided: 2,
      medianMs: 45 * 60_000,
      p90Ms: 50 * 60_000,
      longestMs: 55 * 60_000,
      outcomes: { published: 1, changesRequested: 1, rejected: 0 },
    },
    {
      taxonomyNodeId: '99999999-dead-4000-8000-000000000000',
      riskBand: 'ELEVATED',
      decided: 1,
      medianMs: HOUR,
      p90Ms: HOUR,
      longestMs: HOUR,
      outcomes: { published: 1, changesRequested: 0, rejected: 0 },
    },
  ],
  ...over,
});

const show = async (days?: string) => {
  request.cookies.set('__Host-investigator_session', 'tok');
  api.on('GET /taxonomy?locale=en', 200, TAXONOMY);
  return render(
    await resolveServer(
      await LatencyPage({ searchParams: Promise.resolve(days === undefined ? {} : { days }) }),
    ),
  );
};

describe('review times (T-193)', () => {
  beforeEach(() => {
    request.reset();
    api.install();
    router.reset();
  });

  it('says what it is for, and that nothing opens from it', async () => {
    api.on('GET /moderation/missions/latency', 200, report({ rows: [] }));
    await show();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t('latency.title'));
    expect(screen.getByText(t('latency.purpose'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('latency.back') })).toHaveAttribute(
      'href',
      '/moderation',
    );
    // Nothing to name, so nothing asked of the taxonomy.
    expect(screen.getByText(t('latency.empty.title'))).toBeInTheDocument();
    expect(api.calls.some((c) => c.path.startsWith('/taxonomy'))).toBe(false);
  });

  it('shows each category and band as a card: decisions, waits in words, and outcomes', async () => {
    api.on('GET /moderation/missions/latency', 200, report());
    await show();
    const [partner, records, none, retired] = screen.getAllByRole('listitem') as HTMLElement[];
    const facts = (card: HTMLElement) =>
      within(card)
        .getAllByRole('term')
        .map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);

    expect(within(partner!).getByRole('heading')).toHaveTextContent('relationships');
    expect(partner).toHaveTextContent(t('moderation.band.RESTRICTED'));
    expect(facts(partner!)).toEqual([
      [t('latency.decided'), '1'],
      [t('latency.median'), '30 hr'],
      [t('latency.p90'), '30 hr'],
      [t('latency.longest'), '3 days'],
      [t('latency.outcomes'), '0 published · 0 returned · 1 rejected'],
    ]);
    expect(within(records!).getByRole('heading')).toHaveTextContent('Records checks');
    expect(facts(records!).slice(1, 3)).toEqual([
      [t('latency.median'), '2.5 hr'],
      [t('latency.p90'), '3.7 hr'],
    ]);
    expect(within(none!).getByRole('heading')).toHaveTextContent(t('latency.uncategorised'));
    expect(facts(none!)[1]).toEqual([t('latency.median'), '45 min']);
    expect(within(retired!).getByRole('heading')).toHaveTextContent(
      'A category no longer in the taxonomy (99999999)',
    );
  });

  it('offers the three periods, marks the one shown, and asks for no other', async () => {
    api.on('GET /moderation/missions/latency?days=365', 200, report({ days: 365, rows: [] }));
    await show('365');
    const periods = within(screen.getByRole('navigation', { name: t('latency.period.label') }))
      .getAllByRole('link')
      .map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]);
    expect(periods).toEqual([
      [t('latency.period.30'), '/moderation/latency?days=30', null],
      [t('latency.period.90'), '/moderation/latency', null],
      [t('latency.period.365'), '/moderation/latency?days=365', 'page'],
    ]);

    // A period the API does not offer is the default, not an error.
    api.on('GET /moderation/missions/latency', 200, report({ rows: [] }));
    await show('7');
    expect(api.calls.at(-1)?.path).toBe('/moderation/missions/latency');
  });

  it('says what is missing without the MODERATION scope, and fails loudly on anything else', async () => {
    api.on('GET /moderation/missions/latency', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    await show();
    expect(screen.getByText(t('moderation.no_scope.title'))).toBeInTheDocument();

    api.on('GET /moderation/missions/latency', 500, apiError('INTERNAL', 'error.common.internal'));
    await expect(LatencyPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe('a wait, in words', () => {
  it('uses minutes under an hour, hours under two days, and days beyond', () => {
    expect(duration(45 * 60_000)).toBe('45 min');
    expect(duration(2.5 * HOUR)).toBe('2.5 hr');
    expect(duration(47 * HOUR)).toBe('47 hr');
    expect(duration(48 * HOUR)).toBe('2 days');
    expect(duration(77 * HOUR)).toBe('3.2 days');
  });
});
