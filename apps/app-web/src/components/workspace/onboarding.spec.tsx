import { catalogs } from '@investigator/i18n';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateAgencyPage, { generateMetadata } from '@/app/(workspace)/agencies/new/page';
import { navigate } from '@/lib/navigate';
import { api, apiError } from '@/test/api';
import { account, legalDocument } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import { CreateAgencyForm } from './create-agency-form';
import { SWITCHED_KEY } from './workspace-scope';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('@/lib/navigate', () => ({ navigate: vi.fn() }));

const en = catalogs.en.workspace.create_agency;
const TERMS = legalDocument({
  id: '0b6f7c1e-4f7a-4e0b-9a55-2f1c8a1d0a01',
  type: 'AGENCY_AGREEMENT',
  title: 'Agency agreement',
  content: 'What an agency agrees to.',
});
const CREATED = {
  id: 'ws-sevan',
  name: 'Sevan Due Diligence',
  status: 'ACTIVE',
  countryCode: 'AM',
  businessEmail: 'office@sevan.test',
  timezone: 'Asia/Yerevan',
  currency: 'AMD',
  missing: [],
};

beforeEach(() => {
  request.reset();
  api.install();
  vi.mocked(navigate).mockReset();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('creating an agency', () => {
  const form = () =>
    renderIntl(
      <CreateAgencyForm
        agreement={TERMS}
        countries={[
          { code: 'AM', name: 'Armenia' },
          { code: 'GE', name: 'Georgia' },
        ]}
        currencies={['AMD', 'EUR', 'USD']}
        timezones={['Asia/Tbilisi', 'Asia/Yerevan']}
        timezone="Asia/Yerevan"
      />,
    );
  const fill = async () => {
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: en.name }), '  Sevan Due Diligence ');
    await user.selectOptions(screen.getByRole('combobox', { name: en.country }), 'AM');
    await user.type(screen.getByRole('textbox', { name: en.email }), 'office@sevan.test ');
    await user.selectOptions(screen.getByRole('combobox', { name: en.currency }), 'AMD');
    await user.click(screen.getByRole('checkbox', { name: en.accept }));
    return user;
  };
  const submit = () =>
    fireEvent.submit(screen.getByRole('button', { name: en.submit }).closest('form')!);

  it('asks five things and the terms, each named, the zone offered from the account', () => {
    form();
    expect(screen.getByRole('combobox', { name: en.country })).toHaveAccessibleDescription(
      en.country_hint,
    );
    expect(screen.getByRole('textbox', { name: en.email })).toHaveAccessibleDescription(
      en.email_hint,
    );
    expect(screen.getByRole('combobox', { name: en.timezone })).toHaveValue('Asia/Yerevan');
    expect(screen.getByRole('option', { name: 'Asia/Tbilisi' })).toBeInTheDocument();
    for (const name of [en.name, en.email]) {
      expect(screen.getByRole('textbox', { name })).toBeRequired();
    }
    for (const name of [en.country, en.timezone, en.currency]) {
      expect(screen.getByRole('combobox', { name })).toBeRequired();
    }
    expect(screen.getByText('Agency agreement')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: en.accept })).toBeRequired();
  });

  it('creates the agency with the terms shown, opens it, and says so on arrival', async () => {
    api.on('POST /agencies', 201, CREATED);
    api.on('POST /workspaces/ws-sevan/activate', 200, { id: 'ws-sevan' });
    form();
    const user = await fill();
    await user.click(screen.getByRole('button', { name: en.submit }));
    const [create, activate] = api.calls;
    expect(create!.body).toEqual({
      name: 'Sevan Due Diligence',
      countryCode: 'AM',
      businessEmail: 'office@sevan.test',
      timezone: 'Asia/Yerevan',
      currency: 'AMD',
      agreementDocumentId: TERMS.id,
    });
    expect(create!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(activate!.path).toBe('/workspaces/ws-sevan/activate');
    expect(sessionStorage.getItem(SWITCHED_KEY)).toBe('ws-sevan');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('retries with the same key, so a lost response never makes a second agency', async () => {
    api.down('POST /agencies');
    form();
    await fill();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    api.on('POST /agencies', 201, CREATED);
    api.on('POST /workspaces/ws-sevan/activate', 200, { id: 'ws-sevan' });
    submit();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    const [first, second] = api.calls.filter((c) => c.path === '/agencies');
    expect(second!.headers['idempotency-key']).toBe(first!.headers['idempotency-key']);
  });

  it('puts each refusal under the field it names, and says when the terms changed', async () => {
    const issue = (field: string, messageKey: string) => ({ field, code: 'INVALID', messageKey });
    api.on(
      'POST /agencies',
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
        details: [
          issue('name', 'error.common.validation_failed'),
          issue('countryCode', 'error.validation.country_code.invalid'),
          issue('businessEmail', 'error.validation.email.invalid'),
          issue('timezone', 'error.validation.timezone.invalid'),
          issue('currency', 'error.validation.currency.invalid'),
          issue('agreementDocumentId', 'error.validation.legal.not_current'),
        ],
      }),
    );
    form();
    await fill();
    submit();
    const v = catalogs.en.error.validation;
    expect(await screen.findByText(v.legal.not_current)).toBeVisible();
    expect(screen.getByRole('combobox', { name: en.country })).toHaveAccessibleDescription(
      `${en.country_hint} ${v.country_code.invalid}`,
    );
    expect(screen.getByRole('textbox', { name: en.email })).toHaveAccessibleDescription(
      `${en.email_hint} ${v.email.invalid}`,
    );
    expect(screen.getByRole('combobox', { name: en.timezone })).toHaveAccessibleDescription(
      v.timezone.invalid,
    );
    expect(screen.getByRole('combobox', { name: en.currency })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // "name" had only the generic key, which says nothing about the field: no message under it.
    expect(screen.getByRole('textbox', { name: en.name })).not.toHaveAttribute('aria-invalid');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still opens the new agency when the confirmation cannot be stored', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    api.on('POST /agencies', 201, CREATED);
    api.on('POST /workspaces/ws-sevan/activate', 200, { id: 'ws-sevan' });
    form();
    await fill();
    submit();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });
});

describe('the create-an-agency page', () => {
  const page = async (over: Parameters<typeof account>[0] = {}) => {
    api.on('GET /me', 200, account({ timezone: 'Asia/Yerevan', ...over }));
    renderIntl(await resolveServer(await CreateAgencyPage()));
  };

  it('offers the form once the agency terms are published', async () => {
    api.on('GET /legal/documents/AGENCY_AGREEMENT?locale=en', 200, TERMS);
    await page();
    expect(screen.getByRole('heading', { level: 1, name: en.title })).toBeVisible();
    expect(screen.getByText(en.intro)).toBeVisible();
    // Each option found in its own select by value: asking every one of the page's ~1,000 options
    // for its role and name took this test past CI's timeout under coverage.
    const country = screen.getByRole('combobox', { name: en.country });
    expect(country.querySelector('option[value="AM"]')).toHaveTextContent('Armenia');
    const currency = screen.getByRole('combobox', { name: en.currency });
    expect(currency.querySelector('option[value="USD"]')).toHaveTextContent('USD');
    expect(screen.getByRole('combobox', { name: en.timezone })).toHaveValue('Asia/Yerevan');
    expect((await generateMetadata()).title).toBe(en.title);
  });

  it('offers the account’s own zone even where the runtime’s list lacks it', async () => {
    api.on('GET /legal/documents/AGENCY_AGREEMENT?locale=en', 200, TERMS);
    await page({ timezone: 'Etc/Unknown_Zone' });
    const zone = screen.getByRole('combobox', { name: en.timezone });
    expect(zone).toHaveValue('Etc/Unknown_Zone');
    expect(zone.querySelector('option')).toHaveTextContent('Etc/Unknown Zone');
  });

  it('says agencies cannot be created yet while no terms are published', async () => {
    api.on(
      'GET /legal/documents/AGENCY_AGREEMENT?locale=en',
      404,
      apiError('NOT_FOUND', 'error.common.not_found'),
    );
    await page();
    expect(screen.getByRole('heading', { name: en.unavailable_title })).toBeVisible();
    expect(screen.getByText(en.unavailable_body)).toBeVisible();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks an unconfirmed account to confirm its address first', async () => {
    api.on('GET /legal/documents/AGENCY_AGREEMENT?locale=en', 200, TERMS);
    await page({ emailVerified: false });
    expect(screen.getByText(catalogs.en.account.roles.verify_first)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets any other failure reach the error page', async () => {
    api.on(
      'GET /legal/documents/AGENCY_AGREEMENT?locale=en',
      500,
      apiError('INTERNAL_ERROR', 'error.common.internal'),
    );
    api.on('GET /me', 200, account());
    await expect(CreateAgencyPage()).rejects.toMatchObject({ status: 500 });
  });
});
