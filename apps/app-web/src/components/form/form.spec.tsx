import { catalogs } from '@investigator/i18n';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { renderIntl } from '@/test/intl';
import { errorMessageKey, fieldErrorKeys, type LooseT } from './errors';
import { Field } from './field';
import { FormError } from './form-error';

const known = new Set(['error.common.internal', 'error.validation.legal.privacy_policy']);
const t = Object.assign((key: string) => key, { has: (key: string) => known.has(key) }) as LooseT;

const issue = (field: string, messageKey = 'error.common.validation_failed') => ({
  field,
  code: 'invalid',
  messageKey,
});

describe('the message for an error', () => {
  it('is the form’s own wording for a code it names, before anything the API said', () => {
    const e = new ApiError(401, 'UNAUTHENTICATED', 'error.common.internal');
    expect(errorMessageKey(e, t, { UNAUTHENTICATED: 'auth.sign_in.failed' })).toBe(
      'auth.sign_in.failed',
    );
  });

  it('is the API’s key where the catalog has it, and a generic one where it does not', () => {
    expect(
      errorMessageKey(new ApiError(422, 'X', 'error.validation.legal.privacy_policy'), t),
    ).toBe('error.validation.legal.privacy_policy');
    expect(errorMessageKey(new ApiError(418, 'X', 'error.teapot'), t)).toBe(
      'error.common.internal',
    );
  });
});

describe('per-field messages', () => {
  it('are only for validation failures', () => {
    expect(fieldErrorKeys(null, t)).toEqual({});
    expect(fieldErrorKeys(new ApiError(401, 'UNAUTHENTICATED', 'k', [issue('email')]), t)).toEqual(
      {},
    );
  });

  it('use the API’s key when it is specific and translated, the field’s default otherwise', () => {
    const e = new ApiError(422, 'VALIDATION_FAILED', 'error.common.validation_failed', [
      issue('email'),
      issue('password'),
      issue('timezone'),
      issue('acceptedDocumentIds', 'error.validation.legal.privacy_policy'),
      issue('nickname'),
      issue('displayName', 'error.validation.unknown'),
    ]);
    expect(fieldErrorKeys(e, t)).toEqual({
      email: 'error.validation.email.invalid',
      password: 'error.validation.password.too_short',
      timezone: 'error.validation.timezone.invalid',
      acceptedDocumentIds: 'error.validation.legal.privacy_policy',
    });
  });
});

describe('a field', () => {
  it('is named by its label, described by its hint and error, and marked invalid by the error', () => {
    renderIntl(<Field label="Email" name="email" hint="We never share it." error="Not valid." />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAccessibleDescription('We never share it. Not valid.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveClass('min-h-11', 'text-base');
  });

  it('claims nothing it does not have', () => {
    renderIntl(<Field label="Email" name="email" />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});

describe('a form’s error', () => {
  it('is absent until there is one', () => {
    const { container } = renderIntl(<FormError error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is announced in the reader’s language, with a reference to quote when support can help', () => {
    renderIntl(
      <FormError error={new ApiError(500, 'INTERNAL_ERROR', 'error.common.internal', [], 'c-9')} />,
      'ru',
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(catalogs.ru.error.common.internal);
    expect(alert).toHaveTextContent('c-9');
  });

  it('has a reference for a lost connection too, where there is one', () => {
    renderIntl(
      <FormError error={new ApiError(0, 'NETWORK', 'error.common.internal', [], 'n-1')} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Reference: n-1');
  });

  it('adds no reference to a refusal a person can fix themselves, or where there is none', () => {
    const { rerender } = renderIntl(
      <FormError
        error={new ApiError(401, 'UNAUTHENTICATED', 'error.auth.unauthenticated', [], 'c-1')}
        overrides={{ UNAUTHENTICATED: 'auth.sign_in.failed' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(catalogs.en.auth.sign_in.failed);
    expect(screen.getByRole('alert')).not.toHaveTextContent('c-1');
    rerender(<FormError error={new ApiError(502, 'INTERNAL_ERROR', 'error.common.internal')} />);
    expect(screen.queryByText(/Reference/)).toBeNull();
  });

  describe('a refusal of particular fields (T-135)', () => {
    const v = catalogs.en.error.validation;
    const refused = (...details: Array<{ field: string; code: string; messageKey: string }>) =>
      new ApiError(422, 'VALIDATION_FAILED', 'error.common.validation_failed', details);

    it('names what to fix under the title, once each, and nothing generic', () => {
      renderIntl(
        <FormError
          error={refused(
            issue('kind', 'error.validation.service_area.limit_reached'),
            issue('email'),
            issue('other', 'error.validation.service_area.limit_reached'),
            issue('notes'),
            issue('ghost', 'error.validation.not_a_key'),
          )}
        />,
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(catalogs.en.error.common.validation_failed);
      // The specific message, the email field's default, each once; the generic and the unknown
      // say nothing a reader could act on, so they add nothing.
      expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        v.service_area.limit_reached,
        v.email.invalid,
      ]);
    });

    it('leaves out the fields the form shows beside themselves, or all of them', () => {
      const error = refused(
        issue('email', 'error.validation.email.invalid'),
        issue('acceptedDocumentIds', 'error.validation.legal.privacy_policy'),
      );
      const { unmount } = renderIntl(<FormError error={error} shown={['email']} />);
      expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        v.legal.privacy_policy,
      ]);
      unmount();
      renderIntl(<FormError error={error} shown="all" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByRole('list')).toBeNull();
    });

    it('lists nothing for a refusal that is not about fields', () => {
      renderIntl(<FormError error={new ApiError(403, 'FORBIDDEN', 'error.auth.forbidden')} />);
      expect(screen.queryByRole('list')).toBeNull();
    });
  });
});
