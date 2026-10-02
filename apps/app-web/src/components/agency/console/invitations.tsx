'use client';

import { formatDateTime, type Locale } from '@investigator/i18n';
import { Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { useSubmit } from '@/components/form/use-submit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import type { ApiError } from '@/lib/api/errors';
import type { InvitationView } from '@/lib/api/types';
import { ConfirmSheet } from './confirm-sheet';
import { asApiError, FORBIDDEN, ROLE_KEYS } from './shared';

const INVITATIONS = '/agencies/current/invitations';

/**
 * Inviting people into the agency, and the invitations still open (T-093). Only those waiting or
 * expired are listed — an accepted one is a member above, a cancelled one is gone — each with
 * **Send again** and **Cancel**, the latter asked first by address.
 */
export function Invitations({
  invitations,
  locale,
  timeZone,
}: {
  invitations: InvitationView[];
  locale: Locale;
  timeZone: string;
}) {
  const t = useTranslations('agency.invitations');
  const open = invitations.filter((i) => i.status === 'PENDING' || i.status === 'EXPIRED');
  return (
    <div className="grid gap-6">
      <InviteForm />
      {open.length === 0 ? (
        <p className="text-sm text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="grid gap-3">
          {open.map((i) => (
            <InvitationRow key={i.id} invitation={i} locale={locale} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InviteForm() {
  const t = useTranslations('agency');
  const tl = useTranslations() as unknown as LooseT;
  const router = useRouter();
  const [sent, setSent] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { pending, error, onSubmit } = useSubmit(
    async (form) => {
      setSent(null);
      const email = String(form.get('email')).trim();
      await callApi(INVITATIONS, { body: { email, role: String(form.get('role')) } });
      return email;
    },
    (email) => {
      setSent(email);
      // Ready for the next address once this one went out.
      formRef.current?.reset();
      router.refresh();
    },
  );
  const fields = fieldErrorKeys(error, tl);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-4">
      <FormError error={error} overrides={FORBIDDEN} shown={['email']} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="min-w-0 sm:col-span-2">
          <Field
            label={t('invitations.email')}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            required
            maxLength={254}
            error={fields['email'] && tl(fields['email'])}
          />
        </div>
        <SelectField label={t('invitations.role')} name="role" defaultValue="INVESTIGATOR">
          {ROLE_KEYS.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r as 'OWNER'}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          <Mail aria-hidden />
          {t('invitations.send')}
        </Button>
        {sent !== null && (
          <p role="status" className="text-sm break-all text-success">
            {t('invitations.sent', { email: sent })}
          </p>
        )}
      </div>
    </form>
  );
}

function InvitationRow({
  invitation: i,
  locale,
  timeZone,
}: {
  invitation: InvitationView;
  locale: Locale;
  timeZone: string;
}) {
  const t = useTranslations('agency');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [resent, setResent] = useState(false);
  const date = formatDateTime(i.expiresAt, { locale, timeZone, style: 'date' });
  const resend = async () => {
    setPending(true);
    setError(null);
    setResent(false);
    try {
      await callApi(`${INVITATIONS}/${i.id}/resend`);
      setResent(true);
      router.refresh();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:flex-wrap md:items-center">
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="font-medium break-all">{i.email}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <Badge variant={i.status === 'EXPIRED' ? 'warning' : 'outline'}>
            {t(`invitations.status_${i.status as 'PENDING'}`)}
          </Badge>
          <Badge variant="secondary">
            {ROLE_KEYS.includes(i.role) ? t(`roles.${i.role as 'OWNER'}`) : i.role}
          </Badge>
          <span>
            {i.status === 'EXPIRED'
              ? t('invitations.expired', { date })
              : t('invitations.expires', { date })}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          aria-busy={pending}
          aria-label={t('invitations.resend_label', { email: i.email })}
          onClick={() => void resend()}
        >
          {t('invitations.resend')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-danger"
          aria-label={t('invitations.cancel_label', { email: i.email })}
          onClick={() => setConfirming(true)}
        >
          {t('invitations.cancel')}
        </Button>
      </div>
      {(error !== null || resent) && (
        <div className="w-full">
          <FormError error={error} overrides={FORBIDDEN} />
          {resent && (
            <p role="status" className="text-sm break-all text-success">
              {t('invitations.resent', { email: i.email })}
            </p>
          )}
        </div>
      )}
      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        title={t('invitations.cancel_title', { email: i.email })}
        body={t('invitations.cancel_body', { email: i.email })}
        confirm={t('invitations.cancel_confirm')}
        keep={t('invitations.keep')}
        onConfirm={async () => {
          await callApi(`${INVITATIONS}/${i.id}/cancel`);
          router.refresh();
        }}
      />
    </li>
  );
}
