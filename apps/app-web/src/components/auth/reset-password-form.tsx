'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import { forgetQuery, navigate } from '@/lib/navigate';

/**
 * Choosing a new password from a reset link. Saving signs the account out everywhere — the API
 * revokes every session, this one included — which the form says before it happens.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations();
  const tl = t as unknown as LooseT;
  const [mismatch, setMismatch] = useState(false);
  useEffect(forgetQuery, []);
  const { pending, error, onSubmit } = useSubmit(
    async (form) => {
      const password = String(form.get('password'));
      if (password !== String(form.get('confirm'))) {
        setMismatch(true);
        return false;
      }
      setMismatch(false);
      await callApi('/auth/password-reset/confirm', { body: { token, password } });
      return true;
    },
    (saved) => {
      if (saved) navigate('/sign-in?reset=done');
    },
  );
  const fields = fieldErrorKeys(error, tl);
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <p className="text-text-muted">{t('auth.reset.note')}</p>
      <FormError error={error} overrides={{ UNAUTHENTICATED: 'auth.reset.invalid' }} />
      {error?.code === 'UNAUTHENTICATED' && (
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('auth.reset.request_new')}
        </Link>
      )}
      <Field
        label={t('auth.reset.password')}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={200}
        required
        hint={t('auth.password_hint')}
        error={fields['password'] && tl(fields['password'])}
      />
      <Field
        label={t('auth.reset.confirm')}
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={mismatch ? t('auth.reset.mismatch') : undefined}
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('auth.reset.submit')}
      </Button>
    </form>
  );
}
