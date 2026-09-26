import { catalogs } from '@investigator/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { ownMission } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { CancelMission } from './cancel-mission';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.missions.cancel;
const ID = 'b7d3f0c2-5a61-4c1e-9f0a-3e2d1c4b5a69';
const CANCEL = `POST /missions/me/${ID}/cancel`;
const mission = { id: ID, version: 3 };

const ask = async (stage: 'draft' | 'review' = 'review') => {
  const u = userEvent.setup();
  renderIntl(<CancelMission mission={mission} stage={stage} />);
  await u.click(screen.getByRole('button', { name: en.action }));
  return u;
};

describe('cancelling a mission (T-154)', () => {
  beforeEach(() => {
    api.install();
    router.reset();
  });

  it.each([
    ['draft', en.draft],
    ['review', en.review],
  ] as const)('asks first, saying what closes, for a %s', async (stage, copy) => {
    await ask(stage);
    const dialog = screen.getByRole('alertdialog', { name: copy.title });
    expect(dialog).toHaveTextContent(copy.body);
    expect(api.calls).toEqual([]);
  });

  it('does nothing when the customer keeps it, and gives focus back', async () => {
    const u = await ask();
    await u.click(screen.getByRole('button', { name: en.keep }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: en.action })).toHaveFocus();
    expect(api.calls).toEqual([]);
  });

  it('cancels with the version read, then shows the list it is now cancelled in', async () => {
    api.on(CANCEL, 200, ownMission({ id: ID, status: 'CANCELLED', version: 4 }));
    const u = await ask();
    await u.click(screen.getByRole('button', { name: en.confirm }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/missions'));
    expect(router.refresh).toHaveBeenCalled();
    expect(api.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', `/missions/me/${ID}/cancel`, { version: 3 }],
    ]);
  });

  it('says so when the mission moved on meanwhile, and reloads it where it stands', async () => {
    api.on(CANCEL, 409, apiError('STATE_CONFLICT', 'error.common.state_conflict'));
    const u = await ask();
    await u.click(screen.getByRole('button', { name: en.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.conflict);
    expect(router.refresh).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('says what went wrong otherwise, without reloading', async () => {
    api.down(CANCEL);
    const u = await ask();
    await u.click(screen.getByRole('button', { name: en.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('cancels the version a save under way returned, and nothing when that save failed', async () => {
    api.on(CANCEL, 200, ownMission({ id: ID, status: 'CANCELLED' }));
    const prepare = vi
      .fn<() => Promise<{ id: string; version: number } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: ID, version: 5 });
    const u = userEvent.setup();
    renderIntl(<CancelMission mission={mission} stage="draft" prepare={prepare} />);
    for (let i = 0; i < 2; i++) {
      await u.click(screen.getByRole('button', { name: en.action }));
      await u.click(screen.getByRole('button', { name: en.confirm }));
    }
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/missions'));
    expect(api.calls.map((c) => c.body)).toEqual([{ version: 5 }]);
  });
});
