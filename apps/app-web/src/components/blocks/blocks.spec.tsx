import { catalogs } from '@investigator/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlocksSection } from '@/components/account/blocks-section';
import type { BlockView } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { account } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import { BlockableListing } from './blockable-listing';
import { BlockPerson } from './block-person';
import { Unblock } from './unblock';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.account;
const PROFILE = '3c7c3f86-7a52-4d1e-9d7f-5a0b1c2d3e4f';
const MISSION = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const BLOCK = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';

const block = (over: Partial<BlockView> = {}): BlockView => ({
  id: BLOCK,
  source: 'profile',
  label: 'Ani Petrosyan',
  investigatorProfileId: PROFILE,
  createdAt: '2026-09-30T08:00:00.000Z',
  ...over,
});

beforeEach(() => {
  api.install();
  router.reset();
  request.reset();
});

describe('blocking someone (T-052)', () => {
  const fromProfile = async () => {
    const u = userEvent.setup();
    renderIntl(<BlockPerson target={{ investigatorProfileId: PROFILE }} />);
    await u.click(screen.getByRole('button', { name: en.block.action.investigator }));
    return u;
  };

  it('asks first, saying the investigator is not told and work under way is not ended', async () => {
    await fromProfile();
    const dialog = screen.getByRole('alertdialog', { name: en.block.investigator.title });
    expect(dialog).toHaveTextContent(en.block.investigator.body);
    expect(api.calls).toEqual([]);
  });

  it('does nothing when kept, and gives focus back', async () => {
    const u = await fromProfile();
    await u.click(screen.getByRole('button', { name: en.block.keep }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: en.block.action.investigator })).toHaveFocus();
    expect(api.calls).toEqual([]);
  });

  it('blocks by the profile, then shows the page as the block leaves it', async () => {
    api.on('POST /blocks', 200, { ...block(), liveAssignments: 0 });
    const u = await fromProfile();
    await u.click(screen.getByRole('button', { name: en.block.confirm }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(api.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/blocks', { investigatorProfileId: PROFILE }],
    ]);
    // Said at once, in the button's place — not left to the refresh to show.
    expect(screen.getByRole('status')).toHaveTextContent(en.block.blocked);
    expect(screen.queryByRole('button', { name: en.block.action.investigator })).toBeNull();
  });

  it('says the assignment continues when there is one under way', async () => {
    api.on('POST /blocks', 200, { ...block(), liveAssignments: 1 });
    const u = await fromProfile();
    await u.click(screen.getByRole('button', { name: en.block.confirm }));
    expect(await screen.findByRole('status')).toHaveTextContent(en.block.live);
  });

  it('says what went wrong, and changes nothing on the page', async () => {
    api.on('POST /blocks', 422, apiError('VALIDATION_FAILED', 'error.validation.block.self'));
    const u = await fromProfile();
    await u.click(screen.getByRole('button', { name: en.block.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.validation.block.self,
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('says so when the connection drops', async () => {
    api.down('POST /blocks');
    const u = await fromProfile();
    await u.click(screen.getByRole('button', { name: en.block.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
  });

  it('offers a customer’s block from a mission card’s menu, naming nobody', async () => {
    api.on('POST /blocks', 200, {
      ...block({ source: 'mission', label: null }),
      liveAssignments: 0,
    });
    const u = userEvent.setup();
    renderIntl(
      <ul>
        <BlockableListing>
          <li>
            <h3>The card</h3>
            <BlockPerson as="menu" target={{ missionId: MISSION }} />
          </li>
        </BlockableListing>
      </ul>,
    );
    await u.click(screen.getByRole('button', { name: en.block.menu }));
    await u.click(screen.getByRole('menuitem', { name: en.block.action.customer }));
    const dialog = screen.getByRole('alertdialog', { name: en.block.customer.title });
    expect(dialog).toHaveTextContent(en.block.customer.body);
    await u.click(within(dialog).getByRole('button', { name: en.block.confirm }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(api.calls.map((c) => c.body)).toEqual([{ missionId: MISSION }]);
    // The listing takes itself away at once.
    expect(screen.queryByRole('heading', { name: 'The card' })).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});

describe('unblocking (T-052)', () => {
  it('removes the block, then shows the page without it', async () => {
    api.on(`DELETE /blocks/${BLOCK}`, 204);
    const u = userEvent.setup();
    renderIntl(<Unblock id={BLOCK} />);
    await u.click(screen.getByRole('button', { name: en.blocks.unblock }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(api.calls.map((c) => [c.method, c.path])).toEqual([['DELETE', `/blocks/${BLOCK}`]]);
  });

  it('says what went wrong', async () => {
    api.on(`DELETE /blocks/${BLOCK}`, 404, apiError('NOT_FOUND', 'error.common.not_found'));
    const u = userEvent.setup();
    renderIntl(<Unblock id={BLOCK} />);
    await u.click(screen.getByRole('button', { name: en.blocks.unblock }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('the people the account has blocked (T-052)', () => {
  const show = async () =>
    renderIntl(
      await resolveServer(
        await BlocksSection({ account: account({ timezone: 'Asia/Yerevan' }), locale: 'en' }),
      ),
    );

  it('names each as the blocker saw them, says where, and leads to an investigator’s profile', async () => {
    api.on('GET /blocks', 200, {
      items: [
        block(),
        block({
          id: 'f1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
          source: 'mission',
          label: null,
          investigatorProfileId: null,
        }),
      ],
    });
    await show();
    const section = screen.getByRole('region', { name: en.blocks.title });
    expect(section).toHaveTextContent(en.blocks.body);
    const [investigator, customer] = within(section).getAllByRole('listitem');
    expect(investigator).toHaveTextContent('Ani Petrosyan');
    expect(investigator).toHaveTextContent(en.blocks.source.profile);
    expect(investigator).toHaveTextContent('Blocked Sep 30, 2026');
    expect(within(investigator!).getByRole('link', { name: en.blocks.profile })).toHaveAttribute(
      'href',
      `/missions/investigators/${PROFILE}`,
    );
    expect(customer).toHaveTextContent(en.blocks.customer);
    expect(customer).toHaveTextContent(en.blocks.source.mission);
    expect(within(customer!).queryByRole('link')).toBeNull();
    expect(within(section).getAllByRole('button', { name: en.blocks.unblock })).toHaveLength(2);
  });

  it('says there is nobody, when there is nobody', async () => {
    api.on('GET /blocks', 204);
    await show();
    expect(screen.getByRole('region', { name: en.blocks.title })).toHaveTextContent(
      en.blocks.empty,
    );
    expect(screen.queryByRole('list')).toBeNull();
  });
});
