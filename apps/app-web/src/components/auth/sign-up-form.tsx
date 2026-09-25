'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { LegalDocuments } from '@/components/legal-documents';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { LegalDocument } from '@/lib/api/types';
import { deviceTimeZone } from '@/lib/navigate';

/**
 * Creating an account (T-127). The documents registration requires are shown in full and accepted
 * here, and their ids — this exact version, in the language shown — go with the request (T-022).
 * The language of this screen and the device's time zone are saved on the account.
 *
 * Whatever the address, success looks the same: "check your email". Whether it was already
 * registered is something only its owner learns, by email.
 */
export function SignUpForm({ documents }: { documents: readonly LegalDocument[] }) {
  const t = useTranslations();
  const tl = t as unknown as LooseT;
  const locale = useLocale();
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    (form) =>
      callApi('/auth/register', {
        body: {
          email: form.get('email'),
          password: form.get('password'),
          acceptedDocumentIds: form.getAll('acceptedDocumentIds'),
          locale,
          timezone: deviceTimeZone(),
        },
      }),
    () => router.push('/check-email'),
  );
  const fields = fieldErrorKeys(error, tl);
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {/* Email and password are refused beside their fields; the rest, such as a document
          still to accept, under the error's title (T-135). */}
      <FormError error={error} shown={['email', 'password']} />
      <Field
        label={t('auth.email')}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        error={fields['email'] && tl(fields['email'])}
      />
      <Field
        label={t('auth.password')}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={200}
        required
        hint={t('auth.password_hint')}
        error={fields['password'] && tl(fields['password'])}
      />
      <LegalDocuments
        documents={documents}
        intro={t('auth.sign_up.accept_intro')}
        accept={t('auth.sign_up.accept')}
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('auth.sign_up.submit')}
      </Button>
    </form>
  );
}
