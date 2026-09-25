import { catalogs } from '@investigator/i18n';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '@/lib/api/browser';
import { pinWorkspace } from '@/lib/api/workspace';
import { navigate } from '@/lib/navigate';
import { api, apiError } from '@/test/api';
import { agencyWorkspace, workspace } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { SWITCHED_KEY, SwitchedNotice, WorkspaceScope } from './workspace-scope';
import { CREATE_AGENCY_HREF, WorkspaceSwitcher } from './workspace-switcher';

vi.mock('@/lib/navigate', () => ({ navigate: vi.fn() }));

const en = catalogs.en.workspace;
const PERSONAL = workspace();
const AGENCY = agencyWorkspace();
const BUILDING = agencyWorkspace({ id: 'ws-new', name: 'Sevan', status: 'CREATING' });
const ALL = [PERSONAL, AGENCY, BUILDING];

beforeEach(() => {
  api.install();
  vi.mocked(navigate).mockReset();
  sessionStorage.clear();
});
afterEach(() => {
  pinWorkspace(null);
  vi.restoreAllMocks();
});

describe('the workspace a page was rendered in', () => {
  it('is named by every browser call from inside it', async () => {
    api.on('GET /workspaces', 200, []);
    renderIntl(
      <WorkspaceScope workspace={AGENCY}>
        <p>inside</p>
      </WorkspaceScope>,
    );
    expect(screen.getByText('inside')).toBeVisible();
    await callApi('/workspaces', { method: 'GET' });
    expect(api.calls[0]!.headers).toEqual({ 'x-workspace': 'ws-ararat' });
  });

  it('is not named when the API listed none', async () => {
    pinWorkspace('ws-left-over');
    api.on('GET /workspaces', 200, []);
    renderIntl(<WorkspaceScope workspace={null}>{null}</WorkspaceScope>);
    await callApi('/workspaces', { method: 'GET' });
    expect(api.calls[0]!.headers).toEqual({});
  });
});

describe('the confirmation a switch lands on', () => {
  it('says, once, where the reader is now working', () => {
    sessionStorage.setItem(SWITCHED_KEY, 'ws-ararat');
    const { unmount } = renderIntl(<SwitchedNotice workspace={AGENCY} />);
    expect(screen.getByRole('status')).toHaveTextContent('Now working in Ararat Investigations.');
    expect(sessionStorage.getItem(SWITCHED_KEY)).toBeNull();
    unmount();
    renderIntl(<SwitchedNotice workspace={AGENCY} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names a Personal workspace in words, in the reader’s language', () => {
    sessionStorage.setItem(SWITCHED_KEY, 'ws-personal');
    renderIntl(<SwitchedNotice workspace={PERSONAL} />, 'ru');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Теперь вы работаете в пространстве «Личное».',
    );
  });

  it('says nothing for a switch to somewhere else, or with storage refused', () => {
    sessionStorage.setItem(SWITCHED_KEY, 'ws-other');
    const { unmount } = renderIntl(<SwitchedNotice workspace={AGENCY} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(sessionStorage.getItem(SWITCHED_KEY)).toBe('ws-other');
    unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderIntl(<SwitchedNotice workspace={AGENCY} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the workspace switcher', () => {
  const switcher = (layout: 'menu' | 'sheet', all = ALL) =>
    renderIntl(<WorkspaceSwitcher workspaces={all} layout={layout} />);
  const trigger = (name = 'Personal') =>
    screen.getByRole('button', { name: `Switch workspace, now ${name}` });

  describe('as a menu, from the sidebar', () => {
    const open = async () => {
      await userEvent.click(trigger());
      return screen.findByRole('menu');
    };

    it('lists every workspace, the current one marked in words, and a way to create an agency', async () => {
      switcher('menu');
      const menu = await open();
      const items = within(menu).getAllByRole('menuitem');
      expect(items.map((i) => i.textContent)).toEqual([
        'Personal current',
        'Ararat Investigations',
        `Sevan ${en.setting_up}`,
        en.create,
      ]);
      expect(items[0]).toHaveAttribute('aria-current', 'true');
      expect(items[1]).not.toHaveAttribute('aria-current');
      expect(items[3]).toHaveAttribute('href', CREATE_AGENCY_HREF);
    });

    it('switches: the session default moves, then the app opens again at Home', async () => {
      api.on('POST /workspaces/ws-ararat/activate', 200, { id: 'ws-ararat' });
      switcher('menu');
      await userEvent.click(
        within(await open()).getByRole('menuitem', { name: 'Ararat Investigations' }),
      );
      expect(api.calls.map((c) => [c.method, c.path])).toEqual([
        ['POST', '/workspaces/ws-ararat/activate'],
      ]);
      expect(sessionStorage.getItem(SWITCHED_KEY)).toBe('ws-ararat');
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('does nothing for the workspace already current', async () => {
      switcher('menu');
      await userEvent.click(within(await open()).getByRole('menuitem', { name: /^Personal/ }));
      expect(api.calls).toEqual([]);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('says why a switch was refused, and stays where it is', async () => {
      api.on(
        'POST /workspaces/ws-ararat/activate',
        403,
        apiError('FORBIDDEN', 'error.auth.forbidden'),
      );
      switcher('menu');
      await userEvent.click(
        within(await open()).getByRole('menuitem', { name: 'Ararat Investigations' }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.auth.forbidden);
      expect(trigger()).toBeEnabled();
      expect(navigate).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(SWITCHED_KEY)).toBeNull();
    });

    it('reports a dropped connection as an error too', async () => {
      api.down('POST /workspaces/ws-ararat/activate');
      switcher('menu');
      await userEvent.click(
        within(await open()).getByRole('menuitem', { name: 'Ararat Investigations' }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    });
  });

  describe('as a sheet, on a phone', () => {
    const open = async () => {
      await userEvent.click(trigger());
      return screen.findByRole('dialog', { name: en.title });
    };

    it('lists the workspaces as rows, marks the current one, and closes', async () => {
      switcher('sheet');
      const sheet = await open();
      const rows = within(sheet).getAllByRole('button', { name: /Personal|Ararat|Sevan/ });
      expect(rows.map((r) => r.textContent)).toEqual([
        'Personal current',
        'Ararat Investigations',
        `Sevan ${en.setting_up}`,
      ]);
      expect(rows[0]).toHaveAttribute('aria-current', 'true');
      expect(within(sheet).getByRole('link', { name: en.create })).toHaveAttribute(
        'href',
        CREATE_AGENCY_HREF,
      );
      await userEvent.click(within(sheet).getByRole('button', { name: en.close }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows where it is going while it goes, and cannot be opened again meanwhile', async () => {
      const release = api.hold('POST /workspaces/ws-new/activate', 200, { id: 'ws-new' });
      switcher('sheet');
      await userEvent.click(within(await open()).getByRole('button', { name: /^Sevan/ }));
      const busy = trigger();
      expect(busy).toHaveTextContent('Switching to Sevan');
      expect(busy).toBeDisabled();
      expect(busy).toHaveAttribute('aria-busy', 'true');
      await act(async () => release());
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    });

    it('still switches when the confirmation cannot be stored', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      api.on('POST /workspaces/ws-ararat/activate', 200, { id: 'ws-ararat' });
      switcher('sheet', [PERSONAL, AGENCY]);
      await userEvent.click(within(await open()).getByRole('button', { name: /^Ararat/ }));
      expect(navigate).toHaveBeenCalledWith('/');
    });
  });

  it('shows an agency as current by its name, and falls back to the first when none is marked', () => {
    const { unmount } = switcher('menu', [
      workspace({ current: false }),
      agencyWorkspace({ current: true }),
    ]);
    expect(trigger('Ararat Investigations')).toBeInTheDocument();
    unmount();
    switcher('sheet', [workspace({ current: false }), agencyWorkspace()]);
    expect(trigger()).toBeInTheDocument();
  });
});
