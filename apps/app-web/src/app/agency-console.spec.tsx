import { catalogs } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import {
  account,
  agencyInvestigator,
  agencyWorkspace,
  employee,
  invitation,
  team,
  workspace,
} from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { NotFound, Redirected, router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import HeldInvestigatorNotFound from './(workspace)/agency/investigators/[id]/not-found';
import HeldInvestigatorPage, {
  generateMetadata as heldMeta,
} from './(workspace)/agency/investigators/[id]/page';
import AgencyInvestigatorsPage, {
  generateMetadata as investigatorsMeta,
} from './(workspace)/agency/investigators/page';
import PeoplePage, { generateMetadata as peopleMeta } from './(workspace)/agency/people/page';
import TeamsPage, { generateMetadata as teamsMeta } from './(workspace)/agency/teams/page';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const en = catalogs.en.agency;
const HELD = '/agencies/current/investigators/p-held';
const params = (id = 'p-held') => ({ params: Promise.resolve({ id }) });

/** The reader works in the agency, as the session's workspace says. */
const inAgency = () =>
  api.on('GET /workspaces', 200, [
    workspace({ current: false }),
    agencyWorkspace({ current: true }),
  ]);

beforeEach(() => {
  request.reset();
  api.install();
  router.reset();
  api.on('GET /me', 200, account({ timezone: 'Asia/Yerevan' }));
});

describe('the agency console’s pages (T-093)', () => {
  it.each([
    ['people', () => PeoplePage()],
    ['teams', () => TeamsPage()],
    ['investigators', () => AgencyInvestigatorsPage()],
    ['a held profile', () => HeldInvestigatorPage(params())],
  ])('send the reader to Account’s agencies from anywhere but an agency: %s', async (_l, page) => {
    api.on('GET /workspaces', 200, [workspace(), agencyWorkspace()]);
    await expect(page()).rejects.toEqual(new Redirected('/account#agencies'));
  });

  it('titles each in the reader’s language', async () => {
    expect((await peopleMeta()).title).toBe(en.people.title);
    expect((await teamsMeta()).title).toBe(en.teams.title);
    expect((await investigatorsMeta()).title).toBe(en.investigators.title);
  });

  it('show the agency’s members and its open invitations on People, with the way around', async () => {
    inAgency();
    api.on('GET /agencies/current/members', 200, [employee()]);
    api.on('GET /agencies/current/invitations', 200, [invitation()]);
    renderIntl(await resolveServer(await PeoplePage()));
    expect(screen.getByRole('heading', { level: 1, name: en.people.title })).toBeVisible();
    expect(
      screen.getByText(
        'Who works in Ararat Investigations, what each of them may do, and who has been invited.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('navigation', { name: en.nav.label })).toBeVisible();
    expect(screen.getAllByRole('region').map((r) => r.id)).toEqual(['members', 'invitations']);
    expect(screen.getAllByText('Ani Petrosyan').length).toBeGreaterThan(0);
    // In the reader's own time zone.
    expect(screen.getByText('Link valid until Oct 9, 2026')).toBeVisible();
  });

  it('take an empty answer as none, rather than failing', async () => {
    inAgency();
    for (const path of ['members', 'invitations', 'teams', 'investigators']) {
      api.on(`GET /agencies/current/${path}`, 204);
    }
    const people = renderIntl(await resolveServer(await PeoplePage()));
    expect(screen.getByText(en.invitations.empty)).toBeVisible();
    people.unmount();
    const teams = renderIntl(await resolveServer(await TeamsPage()));
    expect(screen.getByText(en.teams.empty_title)).toBeVisible();
    teams.unmount();
    renderIntl(await resolveServer(await AgencyInvestigatorsPage()));
    expect(screen.getByText(en.investigators.empty_title)).toBeVisible();
  });

  it('show the teams with the members to add on Teams', async () => {
    inAgency();
    api.on('GET /agencies/current/teams', 200, [team()]);
    api.on('GET /agencies/current/members', 200, [employee()]);
    renderIntl(await resolveServer(await TeamsPage()));
    expect(screen.getByRole('heading', { level: 1, name: en.teams.title })).toBeVisible();
    expect(
      screen.getByText('Group the members of Ararat Investigations into teams.'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Yerevan office' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Ani Petrosyan' })).toBeInTheDocument();
  });

  it('show the profiles the agency runs on Investigators', async () => {
    inAgency();
    api.on('GET /agencies/current/investigators', 200, [agencyInvestigator()]);
    api.on('GET /agencies/current/members', 200, [employee()]);
    renderIntl(await resolveServer(await AgencyInvestigatorsPage()));
    expect(screen.getByRole('heading', { level: 1, name: en.investigators.title })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Edit Ararat Lantern' })).toHaveLength(2);
  });
});

describe('a profile the agency holds (T-093)', () => {
  const held = (over = {}) => {
    inAgency();
    api.on(`GET ${HELD}`, 200, agencyInvestigator(over));
    api.on(`GET ${HELD}/service-areas`, 200, []);
    api.on('GET /taxonomy?locale=en', 200, [
      { id: 'n-dd', slug: 'due-diligence', label: 'Due diligence', children: [] },
    ]);
    api.on('GET /agencies/current/members', 200, [employee()]);
  };

  it('is headed and titled with its public name, names who holds it, and edits the storefront only', async () => {
    held();
    renderIntl(await resolveServer(await HeldInvestigatorPage(params())));
    expect(screen.getByRole('heading', { level: 1, name: 'Ararat Lantern' })).toBeVisible();
    expect((await heldMeta(params())).title).toBe('Ararat Lantern');
    expect(screen.getByRole('link', { name: en.investigators.back })).toHaveAttribute(
      'href',
      '/agency/investigators',
    );
    expect(screen.getByText(/^Held by Ani Petrosyan\./)).toBeVisible();
    expect(screen.queryByText(/is suspended or has left the agency/)).toBeNull();
    expect(screen.getAllByRole('region').map((r) => r.id)).toEqual([
      'status',
      'details',
      'languages',
      'specialties',
      'availability',
      'areas',
      'verification',
    ]);
    expect(
      screen.getByRole('region', { name: en.investigators.sections.details_title }),
    ).toBeVisible();
    // Customers see the pseudonym; the legal name is not the agency's to edit.
    expect(
      screen.queryByRole('textbox', { name: catalogs.en.investigator.details.name }),
    ).toBeNull();
    const verification = screen.getByRole('region', { name: en.investigators.verification_title });
    expect(verification).toHaveTextContent(en.investigators.verification_body);
    expect(verification).toHaveTextContent(catalogs.en.investigator.verification_status.VERIFIED);
  });

  it('says up front when the holder is away, naming them from the profile when they have left', async () => {
    held({
      holderStatus: 'REMOVED',
      membershipId: 'm-gone',
      displayName: 'Gor Avetisyan',
      verificationStatus: 'PENDING',
    });
    renderIntl(await resolveServer(await HeldInvestigatorPage(params())));
    expect(
      screen.getByText(
        /^Gor Avetisyan is suspended or has left the agency, so this profile is hidden/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('region', { name: en.investigators.verification_title }),
    ).toHaveTextContent(catalogs.en.investigator.verification_status.PENDING);
  });

  it('names nobody when the profile carries no name and its holder is not listed', async () => {
    held({ membershipId: 'm-gone', displayName: null, name: null, nameCode: 'Q3X9' });
    api.on(`GET ${HELD}/service-areas`, 204);
    api.on('GET /taxonomy?locale=en', 204);
    api.on('GET /agencies/current/members', 204);
    renderIntl(await resolveServer(await HeldInvestigatorPage(params())));
    expect(screen.getByRole('heading', { level: 1, name: 'Investigator Q3X9' })).toBeVisible();
    expect((await heldMeta(params())).title).toBe('Investigator Q3X9');
    expect(screen.getByText(/^Held by \./)).toBeVisible();
  });

  it.each([
    ['another agency’s, or none', 404, apiError('NOT_FOUND', 'error.common.not_found')],
    ['not an id at all', 400, apiError('VALIDATION_FAILED', 'error.common.validation_failed')],
  ])('is the not-found page for %s', async (_l, status, body) => {
    inAgency();
    api.on(`GET ${HELD}`, status, body);
    await expect(HeldInvestigatorPage(params())).rejects.toBeInstanceOf(NotFound);
    await expect(heldMeta(params())).rejects.toBeInstanceOf(NotFound);
  });

  it('is the not-found page when the API answers with nothing', async () => {
    inAgency();
    api.on(`GET ${HELD}`, 204);
    await expect(HeldInvestigatorPage(params())).rejects.toBeInstanceOf(NotFound);
  });

  it('does not hide a failure that is not an absence', async () => {
    inAgency();
    api.on(`GET ${HELD}`, 500, apiError('INTERNAL', 'error.common.internal'));
    await expect(HeldInvestigatorPage(params())).rejects.toMatchObject({ status: 500 });
  });

  it('leads back to the agency’s investigators when it is not found', async () => {
    renderIntl(await resolveServer(await HeldInvestigatorNotFound()));
    expect(
      within(screen.getByRole('navigation')).getByRole('link', { name: en.investigators.back }),
    ).toHaveAttribute('href', '/agency/investigators');
  });
});
