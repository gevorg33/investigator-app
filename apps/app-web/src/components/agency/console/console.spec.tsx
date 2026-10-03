import { catalogs } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { agencyInvestigator, employee, invitation, team } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { AgencyNav } from './agency-nav';
import { ConfirmSheet } from './confirm-sheet';
import { Invitations } from './invitations';
import { AgencyInvestigators } from './investigators';
import { Members } from './members';
import { memberName } from './shared';
import { Teams } from './teams';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.agency;
const user = () => userEvent.setup();
const call = (method: string) => api.calls.filter((c) => c.method === method);

beforeEach(() => {
  api.install();
  router.reset();
});

describe('the agency’s own pages, side by side', () => {
  it.each([
    ['/agency', en.nav.profile],
    ['/agency/people', en.nav.people],
    ['/agency/teams', en.nav.teams],
    ['/agency/investigators/p-1', en.nav.investigators],
  ])('marks %s as where the reader is, by more than colour', (path, current) => {
    router.pathname = path;
    renderIntl(<AgencyNav />);
    const nav = screen.getByRole('navigation', { name: en.nav.label });
    const marked = within(nav)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page')
      .map((a) => a.textContent);
    expect(marked).toEqual([current]);
  });
});

describe('a member’s name', () => {
  it('is the account’s name, else the address — never blank', () => {
    expect(memberName({ displayName: 'Ani', email: 'a@x.test' })).toBe('Ani');
    expect(memberName({ displayName: '  ', email: 'a@x.test' })).toBe('a@x.test');
    expect(memberName({ displayName: null, email: 'a@x.test' })).toBe('a@x.test');
  });
});

describe('the agency’s members', () => {
  const ani = employee();
  const owner = employee({
    membershipId: 'm-owner',
    displayName: null,
    email: 'owner@ararat.test',
    roles: ['OWNER'],
    you: true,
  });
  const davit = employee({
    membershipId: 'm-davit',
    displayName: 'Davit Hakobyan',
    email: 'davit@ararat.test',
    status: 'SUSPENDED',
    roles: ['VIEWER', 'CUSTOM_ROLE'],
    jobTitle: 'Researcher',
    department: 'Records',
  });
  const members = () => renderIntl(<Members members={[owner, ani, davit]} />);
  const manage = (name: string) =>
    user().click(screen.getAllByRole('button', { name: `Manage ${name}` })[0]!);
  const sheet = () => screen.getByRole('dialog');

  it('lists each member as a card and as a row — roles, status, job — with one way to manage them', () => {
    members();
    const [cards, table] = [screen.getAllByRole('list')[0]!, screen.getByRole('table')];
    for (const where of [cards, table]) {
      expect(within(where).getByText('owner@ararat.test')).toBeVisible();
      expect(within(where).getByText(en.console.you)).toBeVisible();
      expect(within(where).getByText('Researcher · Records')).toBeVisible();
      // A role the console does not know is shown by its key rather than hidden.
      expect(within(where).getByText('CUSTOM_ROLE')).toBeVisible();
      expect(within(where).getByText(en.people.status_SUSPENDED)).toBeVisible();
    }
    expect(screen.getAllByRole('button', { name: 'Manage Ani Petrosyan' })).toHaveLength(2);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      en.people.col_person,
      en.people.col_roles,
      en.people.col_status,
      en.people.col_job,
      en.people.col_actions,
    ]);
  });

  it('saves a member’s details, blank as none, and then their roles as a whole set', async () => {
    api.on('PATCH /agencies/current/members/m-ani', 200, ani);
    api.on('PUT /agencies/current/members/m-ani/roles', 200, ani);
    members();
    await manage('Ani Petrosyan');
    expect(sheet()).toHaveAccessibleName('Ani Petrosyan');
    await user().type(
      within(sheet()).getByRole('textbox', { name: en.people.job_title }),
      ' Lead ',
    );
    await user().click(within(sheet()).getByRole('button', { name: en.people.save_details }));
    expect(call('PATCH')[0]!.body).toEqual({ jobTitle: 'Lead', department: null });
    expect(within(sheet()).getByRole('status')).toHaveTextContent(en.console.saved);

    const roles = within(sheet()).getByRole('form', { name: en.people.roles_title });
    await user().click(within(roles).getByRole('checkbox', { name: en.roles.MANAGER }));
    await user().click(within(roles).getByRole('checkbox', { name: en.roles.INVESTIGATOR }));
    await user().click(within(roles).getByRole('checkbox', { name: en.roles.ADMIN }));
    await user().click(within(roles).getByRole('button', { name: en.people.save_roles }));
    // In the catalog's order, whatever order they were ticked in.
    expect(call('PUT')[0]!.body).toEqual({ roles: ['ADMIN', 'MANAGER'] });
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it('says why a change was refused: the reader’s role, or the reason the API names', async () => {
    api.on(
      'PATCH /agencies/current/members/m-ani',
      403,
      apiError('FORBIDDEN', 'error.common.forbidden'),
    );
    api.on(
      'PUT /agencies/current/members/m-ani/roles',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict', {
        details: [
          {
            field: 'membership',
            code: 'LAST_OWNER',
            messageKey: 'error.validation.employees.last_owner',
          },
        ],
      }),
    );
    members();
    await manage('Ani Petrosyan');
    await user().click(within(sheet()).getByRole('button', { name: en.people.save_details }));
    expect(within(sheet()).getByText(en.console.forbidden)).toBeVisible();
    await user().click(within(sheet()).getByRole('button', { name: en.people.save_roles }));
    expect(
      within(sheet()).getByText(catalogs.en.error.validation.employees.last_owner),
    ).toBeVisible();
  });

  it('asks before suspending, by name, says what follows, and can go back', async () => {
    api.on('POST /agencies/current/members/m-ani/suspend', 200, ani);
    members();
    await manage('Ani Petrosyan');
    await user().click(within(sheet()).getByRole('button', { name: en.people.suspend }));
    expect(sheet()).toHaveAccessibleName('Suspend Ani Petrosyan?');
    expect(sheet()).toHaveTextContent(
      'Ani Petrosyan cannot act for the agency from their next action.',
    );
    await user().click(within(sheet()).getByRole('button', { name: en.console.back }));
    expect(sheet()).toHaveAccessibleName('Ani Petrosyan');
    expect(api.calls).toEqual([]);

    await user().click(within(sheet()).getByRole('button', { name: en.people.suspend }));
    await user().click(within(sheet()).getByRole('button', { name: 'Suspend Ani Petrosyan' }));
    expect(call('POST').map((c) => c.path)).toEqual(['/agencies/current/members/m-ani/suspend']);
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before removing, and keeps the sheet open with the reason when it is refused', async () => {
    api.on(
      'POST /agencies/current/members/m-ani/remove',
      403,
      apiError('FORBIDDEN', 'error.common.forbidden'),
    );
    members();
    await manage('Ani Petrosyan');
    await user().click(within(sheet()).getByRole('button', { name: en.people.remove }));
    expect(sheet()).toHaveAccessibleName('Remove Ani Petrosyan from the agency?');
    await user().click(within(sheet()).getByRole('button', { name: 'Remove Ani Petrosyan' }));
    expect(within(sheet()).getByText(en.console.forbidden)).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('reactivates a suspended member without asking — it takes nothing away — and says so', async () => {
    api.on('POST /agencies/current/members/m-davit/reactivate', 200, davit);
    members();
    await manage('Davit Hakobyan');
    expect(within(sheet()).queryByRole('button', { name: en.people.suspend })).toBeNull();
    await user().click(within(sheet()).getByRole('button', { name: en.people.reactivate }));
    expect(within(sheet()).getByRole('status')).toHaveTextContent(
      'Davit Hakobyan can act for the agency again.',
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says why reactivating failed, a dropped connection included', async () => {
    members();
    await manage('Davit Hakobyan');
    await user().click(within(sheet()).getByRole('button', { name: en.people.reactivate }));
    expect(within(sheet()).getByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
  });

  it('offers the reader no way to suspend or remove themself', async () => {
    members();
    await manage('owner@ararat.test');
    expect(within(sheet()).queryByRole('region', { name: en.people.access_title })).toBeNull();
    expect(within(sheet()).queryByRole('button', { name: en.people.remove })).toBeNull();
  });

  it('closes, and puts focus back on the button that opened it', async () => {
    members();
    const opener = screen.getAllByRole('button', { name: 'Manage Ani Petrosyan' })[0]!;
    opener.focus();
    await user().keyboard('{Enter}');
    expect(sheet()).toContainElement(document.activeElement as HTMLElement);
    await user().keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('invitations', () => {
  const invitations = (list = [invitation()]) =>
    renderIntl(<Invitations invitations={list} locale="en" timeZone="Asia/Yerevan" />);

  it('invites an address with the role it starts as, and is ready for the next', async () => {
    api.on('POST /agencies/current/invitations', 201, invitation());
    invitations([]);
    expect(screen.getByText(en.invitations.empty)).toBeVisible();
    const email = screen.getByRole('textbox', { name: en.invitations.email });
    await user().type(email, ' davit@ararat.test ');
    await user().selectOptions(
      screen.getByRole('combobox', { name: en.invitations.role }),
      'MANAGER',
    );
    await user().click(screen.getByRole('button', { name: en.invitations.send }));
    expect(api.calls[0]!.body).toEqual({ email: 'davit@ararat.test', role: 'MANAGER' });
    expect(screen.getByRole('status')).toHaveTextContent('Invitation sent to davit@ararat.test.');
    expect(email).toHaveValue('');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says why an invitation was refused: the reason the API names', async () => {
    api.on(
      'POST /agencies/current/invitations',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict', {
        details: [
          {
            field: 'email',
            code: 'MEMBER',
            messageKey: 'error.validation.employees.already_member',
          },
        ],
      }),
    );
    invitations([]);
    await user().type(screen.getByRole('textbox', { name: en.invitations.email }), 'a@b.test');
    await user().click(screen.getByRole('button', { name: en.invitations.send }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      catalogs.en.error.validation.employees.already_member,
    );
    expect(screen.getByRole('textbox', { name: en.invitations.email })).toHaveValue('a@b.test');
  });

  it('puts a refusal of the address under the address', async () => {
    api.on(
      'POST /agencies/current/invitations',
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
        details: [
          { field: 'email', code: 'INVALID', messageKey: 'error.validation.email.invalid' },
        ],
      }),
    );
    invitations([]);
    const email = screen.getByRole('textbox', { name: en.invitations.email });
    await user().type(email, 'a@b.test');
    await user().click(screen.getByRole('button', { name: en.invitations.send }));
    expect(email).toHaveAccessibleDescription(catalogs.en.error.validation.email.invalid);
  });

  it('lists only the invitations still open, with their role and how long the link lasts', () => {
    invitations([
      invitation(),
      invitation({ id: 'inv-2', email: 'old@ararat.test', status: 'EXPIRED', role: 'VIEWER' }),
      invitation({ id: 'inv-3', email: 'joined@ararat.test', status: 'ACCEPTED' }),
      invitation({ id: 'inv-4', email: 'gone@ararat.test', status: 'CANCELLED' }),
      invitation({ id: 'inv-5', email: 'odd@ararat.test', role: 'CUSTOM_ROLE' }),
    ]);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => within(r).getAllByText(/@/)[0]!.textContent)).toEqual([
      'davit@ararat.test',
      'old@ararat.test',
      'odd@ararat.test',
    ]);
    expect(rows[0]).toHaveTextContent(`${en.invitations.status_PENDING}${en.roles.INVESTIGATOR}`);
    expect(rows[0]).toHaveTextContent('Link valid until Oct 9, 2026');
    expect(rows[1]).toHaveTextContent(en.invitations.status_EXPIRED);
    expect(rows[1]).toHaveTextContent('Link expired on Oct 9, 2026');
    expect(rows[2]).toHaveTextContent('CUSTOM_ROLE');
  });

  it('sends one again, and says so — or why not', async () => {
    api.on('POST /agencies/current/invitations/inv-1/resend', 200, invitation());
    invitations();
    const again = screen.getByRole('button', {
      name: 'Send the invitation to davit@ararat.test again',
    });
    await user().click(again);
    expect(screen.getByRole('status')).toHaveTextContent('Sent again to davit@ararat.test.');
    api.on(
      'POST /agencies/current/invitations/inv-1/resend',
      403,
      apiError('FORBIDDEN', 'error.common.forbidden'),
    );
    await user().click(again);
    expect(screen.getByText(en.console.forbidden)).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('cancels one only once asked, naming the address, and can keep it', async () => {
    api.on(
      'POST /agencies/current/invitations/inv-1/cancel',
      200,
      invitation({ status: 'CANCELLED' }),
    );
    invitations();
    const cancel = screen.getByRole('button', {
      name: 'Cancel the invitation to davit@ararat.test',
    });
    await user().click(cancel);
    const sheet = screen.getByRole('dialog', {
      name: 'Cancel the invitation to davit@ararat.test?',
    });
    expect(sheet).toHaveTextContent('You can invite davit@ararat.test again later.');
    await user().click(within(sheet).getByRole('button', { name: en.invitations.keep }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls).toEqual([]);

    await user().click(cancel);
    await user().click(screen.getByRole('button', { name: en.invitations.cancel_confirm }));
    expect(api.calls.map((c) => c.path)).toEqual(['/agencies/current/invitations/inv-1/cancel']);
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a destructive action’s sheet', () => {
  it('stays open with the reason when the action is refused, and forgets it once closed', async () => {
    const onOpenChange = vi.fn();
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    const { rerender } = renderIntl(
      <ConfirmSheet
        open
        onOpenChange={onOpenChange}
        title="Delete it?"
        body="Gone for good."
        confirm="Delete"
        keep="Keep"
        onConfirm={failing}
      />,
    );
    await user().click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    expect(onOpenChange).not.toHaveBeenCalled();
    await user().keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(
      <ConfirmSheet
        open
        onOpenChange={onOpenChange}
        title="Delete it?"
        body="Gone for good."
        confirm="Delete"
        keep="Keep"
        onConfirm={failing}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('teams', () => {
  const ani = employee();
  const davit = employee({
    membershipId: 'm-davit',
    displayName: 'Davit Hakobyan',
    email: 'davit@ararat.test',
  });
  const office = team({
    name: 'Yerevan office',
    description: 'Court work',
    members: [
      {
        membershipId: 'm-ani',
        userId: 'u-ani',
        email: ani.email,
        displayName: 'Ani Petrosyan',
        status: 'ACTIVE',
      },
    ],
  });
  const teams = (list = [office], members = [ani, davit]) =>
    renderIntl(<Teams teams={list} members={members} />);
  const card = (name = 'Yerevan office') =>
    screen.getByRole('heading', { name }).closest('[data-slot=card]') as HTMLElement;

  it('says there are none and what they are for, beside a form to make one', () => {
    teams([]);
    expect(screen.getByText(en.teams.empty_title)).toBeVisible();
    expect(screen.getByText(en.teams.empty_body)).toBeVisible();
    expect(screen.getByRole('button', { name: en.teams.create })).toBeVisible();
  });

  it('creates one, sending what it is for only when said, and clears the form', async () => {
    api.on('POST /agencies/current/teams', 201, office);
    teams([]);
    const name = screen.getByRole('textbox', { name: en.teams.name });
    await user().type(name, ' Gyumri ');
    await user().click(screen.getByRole('button', { name: en.teams.create }));
    expect(api.calls[0]!.body).toEqual({ name: 'Gyumri' });
    expect(screen.getByRole('status')).toHaveTextContent(en.teams.created);
    expect(screen.getByRole('textbox', { name: en.teams.name })).toHaveValue('');

    await user().type(screen.getByRole('textbox', { name: en.teams.name }), 'Vanadzor');
    await user().type(screen.getByRole('textbox', { name: en.teams.description }), ' Field ');
    await user().click(screen.getByRole('button', { name: en.teams.create }));
    expect(api.calls[1]!.body).toEqual({ name: 'Vanadzor', description: 'Field' });
  });

  it('says why a team was not created', async () => {
    api.on(
      'POST /agencies/current/teams',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict', {
        details: [
          { field: 'name', code: 'TAKEN', messageKey: 'error.validation.teams.name_taken' },
        ],
      }),
    );
    teams([]);
    await user().type(screen.getByRole('textbox', { name: en.teams.name }), 'Yerevan office');
    await user().click(screen.getByRole('button', { name: en.teams.create }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      catalogs.en.error.validation.teams.name_taken,
    );
  });

  it('shows each team with what it is for and who is in it, and takes someone out in one tap', async () => {
    api.on('DELETE /agencies/current/teams/team-1/members/m-ani', 200, office);
    teams();
    expect(card()).toHaveTextContent('Court work');
    expect(card()).toHaveTextContent('1 member');
    await user().click(
      within(card()).getByRole('button', { name: 'Take Ani Petrosyan out of Yerevan office' }),
    );
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /agencies/current/teams/team-1/members/m-ani',
    ]);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('adds someone from the agency who is not in it yet, and says when everyone is', async () => {
    api.on('POST /agencies/current/teams/team-1/members', 200, office);
    const { unmount } = teams();
    const add = within(card()).getByRole('button', { name: en.teams.add });
    expect(add).toBeDisabled();
    const choose = within(card()).getByRole('combobox', { name: en.teams.add_label });
    expect(
      within(choose)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([en.teams.add_label, 'Davit Hakobyan']);
    await user().selectOptions(choose, 'm-davit');
    await user().click(add);
    expect(api.calls[0]!.body).toEqual({ membershipId: 'm-davit' });
    expect(choose).toHaveValue('');
    unmount();
    teams([office], [ani]);
    expect(within(card()).getByText(en.teams.everyone_in)).toBeVisible();
    expect(within(card()).queryByRole('combobox')).toBeNull();
  });

  it('says why someone could not be added', async () => {
    api.on(
      'POST /agencies/current/teams/team-1/members',
      403,
      apiError('FORBIDDEN', 'error.common.forbidden'),
    );
    teams([team({ name: 'Yerevan office' })]);
    expect(card()).toHaveTextContent(en.teams.members_count.replace(/.*=0 \{([^}]*)\}.*/, '$1'));
    await user().selectOptions(
      within(card()).getByRole('combobox', { name: en.teams.add_label }),
      'm-ani',
    );
    await user().click(within(card()).getByRole('button', { name: en.teams.add }));
    expect(within(card()).getByText(en.console.forbidden)).toBeVisible();
  });

  it('renames in place, focus going to the name and back to Edit, blank purpose as none', async () => {
    api.on('PATCH /agencies/current/teams/team-1', 200, office);
    teams();
    const edit = within(card()).getByRole('button', { name: 'Edit Yerevan office' });
    await user().click(edit);
    const form = screen.getByRole('form', { name: 'Edit Yerevan office' });
    expect(within(form).getByRole('textbox', { name: en.teams.name })).toHaveFocus();
    await user().clear(within(form).getByRole('textbox', { name: en.teams.description }));
    await user().click(within(form).getByRole('button', { name: en.teams.save }));
    expect(api.calls[0]!.body).toEqual({ name: 'Yerevan office', description: null });
    expect(screen.queryByRole('form', { name: 'Edit Yerevan office' })).toBeNull();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit Yerevan office' })).toHaveFocus(),
    );
  });

  it('puts focus back on Edit after a save however soon the next frame comes (T-192)', async () => {
    // A save resolves outside any event, so React commits the closed form on its own schedule. A
    // frame due before that commit found no Edit button yet and left focus on nothing — the 1-in-4
    // mobile failure. The frame here comes at once, before React has committed anything.
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
      frame(0);
      return 0;
    });
    try {
      api.on('PATCH /agencies/current/teams/team-1', 200, office);
      teams();
      await user().click(within(card()).getByRole('button', { name: 'Edit Yerevan office' }));
      const form = screen.getByRole('form', { name: 'Edit Yerevan office' });
      await user().click(within(form).getByRole('button', { name: en.teams.save }));
      await vi.waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit Yerevan office' })).toHaveFocus(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('puts focus back on Edit when a rename is cancelled', async () => {
    teams();
    await user().click(within(card()).getByRole('button', { name: 'Edit Yerevan office' }));
    const form = screen.getByRole('form', { name: 'Edit Yerevan office' });
    await user().click(within(form).getByRole('button', { name: en.teams.cancel }));
    expect(screen.getByRole('button', { name: 'Edit Yerevan office' })).toHaveFocus();
  });

  it('keeps the form, with the reason, when a rename is refused — and Cancel leaves it as it was', async () => {
    api.on(
      'PATCH /agencies/current/teams/team-1',
      403,
      apiError('FORBIDDEN', 'error.common.forbidden'),
    );
    teams();
    await user().click(within(card()).getByRole('button', { name: 'Edit Yerevan office' }));
    const form = screen.getByRole('form', { name: 'Edit Yerevan office' });
    await user().click(within(form).getByRole('button', { name: en.teams.save }));
    expect(within(form).getByText(en.console.forbidden)).toBeVisible();
    await user().click(within(form).getByRole('button', { name: en.teams.cancel }));
    expect(screen.queryByRole('form', { name: 'Edit Yerevan office' })).toBeNull();
    expect(card()).toHaveTextContent('Court work');
  });

  it('deletes a team only once asked by its name, saying its members stay', async () => {
    api.on('DELETE /agencies/current/teams/team-1', 204);
    teams();
    await user().click(within(card()).getByRole('button', { name: 'Delete Yerevan office' }));
    const sheet = screen.getByRole('dialog', { name: 'Delete Yerevan office?' });
    expect(sheet).toHaveTextContent(en.teams.delete_body);
    await user().click(within(sheet).getByRole('button', { name: 'Delete Yerevan office' }));
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /agencies/current/teams/team-1',
    ]);
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe('the agency’s investigator profiles', () => {
  const ani = employee();
  const davit = employee({
    membershipId: 'm-davit',
    displayName: 'Davit Hakobyan',
    email: 'davit@ararat.test',
  });
  const lilit = employee({
    membershipId: 'm-lilit',
    displayName: 'Lilit Sargsyan',
    email: 'lilit@ararat.test',
    status: 'SUSPENDED',
  });
  const listed = agencyInvestigator();
  const away = agencyInvestigator({
    id: 'p-away',
    membershipId: 'm-gone',
    name: null,
    nameCode: 'Q3X9',
    displayName: 'Gor Avetisyan',
    visibility: 'DRAFT',
    verificationStatus: 'UNVERIFIED',
    acceptingWork: false,
    holderStatus: 'REMOVED',
  });
  const page = (profiles = [listed, away], members = [ani, davit, lilit]) =>
    renderIntl(<AgencyInvestigators profiles={profiles} members={members} />);

  it('lists each with who holds it and where it stands for customers, as a card and as a row', () => {
    page();
    const [cards, table] = [screen.getAllByRole('list')[0]!, screen.getByRole('table')];
    for (const where of [cards, table]) {
      expect(within(where).getByText('Ararat Lantern')).toBeVisible();
      expect(within(where).getByText('Ani Petrosyan')).toBeVisible();
      // No pseudonym yet: the stand-in code; a holder who left is named from the profile.
      expect(within(where).getByText('Investigator Q3X9')).toBeVisible();
      expect(within(where).getByText('Gor Avetisyan')).toBeVisible();
      expect(within(where).getByText(en.investigators.holder_REMOVED)).toBeVisible();
      for (const state of [
        'shown',
        'verified',
        'accepting',
        'hidden',
        'unverified',
        'not_accepting',
      ] as const) {
        expect(within(where).getByText(en.investigators[state])).toBeVisible();
      }
    }
    expect(
      screen
        .getAllByRole('link', { name: 'Edit Ararat Lantern' })
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/agency/investigators/p-held', '/agency/investigators/p-held']);
  });

  it('names no holder rather than a wrong one when neither the list nor the profile has a name', () => {
    page([agencyInvestigator({ membershipId: 'm-gone', displayName: null })], [ani]);
    const cell = screen.getAllByRole('cell')[1]!;
    expect(cell).toHaveTextContent(/^$/);
  });

  it('says there are none, and what to do', () => {
    page([], [ani]);
    expect(screen.getByText(en.investigators.empty_title)).toBeVisible();
    expect(screen.getByText(en.investigators.empty_body)).toBeVisible();
  });

  it('makes one for an active member who has none, then opens it', async () => {
    api.on('POST /agencies/current/investigators', 201, agencyInvestigator({ id: 'p-new' }));
    page();
    const choose = screen.getByRole('combobox', { name: en.investigators.member });
    // Ani holds one already and Lilit is suspended.
    expect(
      within(choose)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([en.investigators.member, 'Davit Hakobyan']);
    const make = screen.getByRole('button', { name: en.investigators.make });
    expect(make).toBeDisabled();
    await user().selectOptions(choose, 'm-davit');
    await user().click(make);
    expect(api.calls[0]!.body).toEqual({ membershipId: 'm-davit' });
    expect(router.push).toHaveBeenCalledWith('/agency/investigators/p-new');
    expect(choose).toHaveValue('');
  });

  it('stays put when the API answers with nothing to open', async () => {
    api.on('POST /agencies/current/investigators', 204);
    page();
    await user().selectOptions(
      screen.getByRole('combobox', { name: en.investigators.member }),
      'm-davit',
    );
    await user().click(screen.getByRole('button', { name: en.investigators.make }));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says why a member cannot have one yet', async () => {
    api.on(
      'POST /agencies/current/investigators',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict', {
        details: [
          {
            field: 'membershipId',
            code: 'NOT_AN_INVESTIGATOR',
            messageKey: 'error.validation.agency_investigators.not_an_investigator',
          },
        ],
      }),
    );
    page();
    await user().selectOptions(
      screen.getByRole('combobox', { name: en.investigators.member }),
      'm-davit',
    );
    await user().click(screen.getByRole('button', { name: en.investigators.make }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      catalogs.en.error.validation.agency_investigators.not_an_investigator,
    );
  });

  it('says when every active member already has one', () => {
    page([listed], [ani, lilit]);
    expect(screen.getByText(en.investigators.none_eligible)).toBeVisible();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
