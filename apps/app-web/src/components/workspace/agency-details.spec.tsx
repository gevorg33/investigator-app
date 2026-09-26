import { catalogs } from '@investigator/i18n';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgencyDetailsPage, { generateMetadata } from '@/app/(workspace)/agencies/current/page';
import type { AgencyDetails } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { agencyWorkspace, workspace } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { Redirected, router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import { AgencyDetailsForm } from './agency-details-form';
import { AgencySetupNotice } from './agency-setup-notice';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.workspace;
const agency = (over: Partial<AgencyDetails> = {}): AgencyDetails => ({
  id: 'ws-sevan',
  name: 'Sevan Due Diligence',
  status: 'ACTIVE',
  countryCode: 'AM',
  businessEmail: 'office@sevan.test',
  timezone: 'Asia/Yerevan',
  currency: 'AMD',
  missing: [],
  version: 3,
  mayChange: true,
  ...over,
});
/** Still being set up: no business email and no currency yet. */
const unfinished = agency({
  status: 'CREATING',
  businessEmail: null,
  currency: null,
  missing: ['businessEmail', 'currency'],
});

const OPTIONS = {
  countries: [
    { code: 'AM', name: 'Armenia' },
    { code: 'GE', name: 'Georgia' },
  ],
  currencies: ['AMD', 'EUR', 'USD'],
  timezones: ['Asia/Tbilisi', 'Asia/Yerevan'],
};

beforeEach(() => {
  request.reset();
  api.install();
  router.reset();
});

describe('an agency’s details (T-150)', () => {
  describe('the owner’s form', () => {
    const form = (a: AgencyDetails) => renderIntl(<AgencyDetailsForm agency={a} {...OPTIONS} />);
    const input = (label: string) => screen.getByLabelText(label, { exact: false });

    it('says what an unfinished agency still needs, and is filled with what it has', () => {
      form(unfinished);
      const alert = screen.getByText(en.agency_details.unfinished).closest('[data-slot=alert]')!;
      expect(alert).toHaveTextContent('Still needed: Business email, Currency.');
      expect(input(en.create_agency.name)).toHaveValue('Sevan Due Diligence');
      expect(input(en.create_agency.email)).toHaveValue('');
      expect(input(en.create_agency.timezone)).toHaveValue('Asia/Yerevan');
    });

    it('sends only what changed, with the version read, and says the agency is ready', async () => {
      api.on('PATCH /agencies/current', 200, agency({ version: 4, currency: 'USD' }));
      form(unfinished);
      const u = userEvent.setup();
      await u.type(input(en.create_agency.email), 'desk@sevan.test');
      await u.selectOptions(input(en.create_agency.currency), 'USD');
      await u.click(screen.getByRole('button', { name: en.agency_details.save }));

      expect(await screen.findByText(en.agency_details.activated)).toBeVisible();
      expect(api.calls.map((c) => [c.method, c.path, c.body])).toEqual([
        [
          'PATCH',
          '/agencies/current',
          { version: 3, businessEmail: 'desk@sevan.test', currency: 'USD' },
        ],
      ]);
      expect(screen.queryByText(en.agency_details.unfinished)).toBeNull();
      // The shell's notice and the switcher read the same agency.
      expect(router.refresh).toHaveBeenCalled();
    });

    it('names the version the last save returned on the next one', async () => {
      api.on('PATCH /agencies/current', 200, agency({ version: 4, name: 'Sevan DD' }));
      form(agency());
      const u = userEvent.setup();
      await u.clear(input(en.create_agency.name));
      await u.type(input(en.create_agency.name), 'Sevan DD');
      await u.click(screen.getByRole('button', { name: en.agency_details.save }));
      expect(await screen.findByText(en.agency_details.saved)).toBeVisible();

      api.on('PATCH /agencies/current', 200, agency({ version: 5, timezone: 'Asia/Tbilisi' }));
      await u.selectOptions(input(en.create_agency.timezone), 'Asia/Tbilisi');
      await u.click(screen.getByRole('button', { name: en.agency_details.save }));
      await vi.waitFor(() => expect(api.calls).toHaveLength(2));
      expect(api.calls.map((c) => c.body)).toEqual([
        { version: 3, name: 'Sevan DD' },
        { version: 4, timezone: 'Asia/Tbilisi' },
      ]);
    });

    it('offers a zone even for an agency that has none yet', () => {
      form(agency({ timezone: null }));
      expect(input(en.create_agency.timezone)).toHaveValue('Asia/Tbilisi');
    });

    it('sends nothing when nothing changed', async () => {
      form(agency());
      await userEvent.setup().click(screen.getByRole('button', { name: en.agency_details.save }));
      expect(await screen.findByText(en.agency_details.saved)).toBeVisible();
      expect(api.calls).toEqual([]);
    });

    it('asks for a reload when the details changed elsewhere, and overwrites nothing', async () => {
      api.on(
        'PATCH /agencies/current',
        409,
        apiError('STATE_CONFLICT', 'error.common.state_conflict'),
      );
      form(agency());
      const u = userEvent.setup();
      await u.selectOptions(input(en.create_agency.currency), 'EUR');
      await u.click(screen.getByRole('button', { name: en.agency_details.save }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        catalogs.en.error.common.state_conflict,
      );
      expect(screen.queryByText(en.agency_details.saved)).toBeNull();
    });

    it('shows a refused field’s message under that field', async () => {
      api.on(
        'PATCH /agencies/current',
        422,
        apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
          details: [
            {
              field: 'businessEmail',
              code: 'INVALID',
              messageKey: 'error.validation.email.invalid',
            },
          ],
        }),
      );
      form(agency());
      const u = userEvent.setup();
      await u.clear(input(en.create_agency.email));
      await u.type(input(en.create_agency.email), 'desk@sevan.test');
      await u.click(screen.getByRole('button', { name: en.agency_details.save }));
      expect(await screen.findByText(catalogs.en.error.validation.email.invalid)).toBeVisible();
      expect(input(en.create_agency.email)).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('the page', () => {
    const show = async () => renderIntl(await resolveServer(await AgencyDetailsPage()));

    it('is the owner’s form', async () => {
      api.on('GET /agencies/current', 200, unfinished);
      await show();
      expect(
        screen.getByRole('heading', { level: 1, name: en.agency_details.title }),
      ).toBeVisible();
      expect(screen.getByText(en.agency_details.intro)).toBeVisible();
      expect(screen.getByRole('button', { name: en.agency_details.save })).toBeVisible();
      expect((await generateMetadata()).title).toBe(en.agency_details.title);
    });

    it('is read-only to any other member, and says who can change it', async () => {
      api.on('GET /agencies/current', 200, { ...unfinished, mayChange: false });
      await show();
      expect(screen.getByText(en.agency_details.owner_only)).toBeVisible();
      expect(screen.getByText(en.agency_details.unfinished)).toBeVisible();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      const rows = within(document.querySelector('dl')!);
      expect(rows.getByText('Armenia')).toBeVisible();
      expect(rows.getByText('Asia/Yerevan')).toBeVisible();
      expect(rows.getAllByText('—')).toHaveLength(2);
    });

    it('keeps the agency’s own zone offered where the runtime’s list lacks it', async () => {
      api.on('GET /agencies/current', 200, agency({ timezone: 'Etc/Unknown_Zone' }));
      await show();
      const zone = screen.getByLabelText(en.create_agency.timezone, { exact: false });
      expect(zone).toHaveValue('Etc/Unknown_Zone');
      expect(within(zone).getAllByRole('option')[0]).toHaveTextContent('Etc/Unknown Zone');
    });

    it('offers every zone the runtime knows to an agency with none yet', async () => {
      api.on('GET /agencies/current', 200, agency({ timezone: null }));
      await show();
      const zone = screen.getByLabelText(en.create_agency.timezone, { exact: false });
      expect(within(zone).getAllByRole('option')).toHaveLength(
        Intl.supportedValuesOf('timeZone').length,
      );
    });

    it('names a country it has no name for by its code', async () => {
      api.on('GET /agencies/current', 200, agency({ countryCode: 'XX', mayChange: false }));
      await show();
      expect(within(document.querySelector('dl')!).getByText('XX')).toBeVisible();
    });

    it('sends someone in a Personal workspace Home, which has no agency to show', async () => {
      api.on('GET /agencies/current', 403, apiError('FORBIDDEN', 'error.common.forbidden'));
      await expect(AgencyDetailsPage()).rejects.toEqual(new Redirected('/'));
    });

    it('lets any other failure through, to the error page', async () => {
      api.on('GET /agencies/current', 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
      await expect(AgencyDetailsPage()).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('the notice above an unfinished agency', () => {
    const notice = async (w: Parameters<typeof AgencySetupNotice>[0]['workspace']) =>
      render(<>{await AgencySetupNotice({ workspace: w })}</>);

    it('says the agency is not set up, and leads to its details', async () => {
      await notice(agencyWorkspace({ status: 'CREATING', current: true }));
      expect(screen.getByRole('status')).toHaveTextContent(
        'Ararat Investigations is not set up yet.',
      );
      expect(screen.getByRole('link', { name: catalogs.en.shell.finish })).toHaveAttribute(
        'href',
        '/agencies/current',
      );
    });

    it.each([
      ['an agency that is set up', agencyWorkspace({ current: true })],
      ['a Personal workspace', workspace({ status: 'CREATING' })],
    ])('says nothing for %s', async (_label, w) => {
      await notice(w);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });
});
