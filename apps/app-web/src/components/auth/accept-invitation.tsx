'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { SWITCHED_KEY } from '@/components/workspace/workspace-scope';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { callApi, type ApiError } from '@/lib/api/browser';
import { forgetQuery, navigate } from '@/lib/navigate';

const LINK =
  'inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline';

/** What the API's refusal means here, and so what the reader is told to do next. */
function refusal(error: ApiError): 'not_found' | 'member' | 'suspended' | 'unconfirmed' | null {
  if (error.status === 404) return 'not_found';
  if (error.status === 403) return 'unconfirmed';
  if (error.code === 'STATE_CONFLICT') {
    const code = error.details[0]?.code;
    if (code === 'MEMBER') return 'member';
    if (code === 'SUSPENDED') return 'suspended';
  }
  return null;
}

/**
 * Joining the agency an invitation is for (T-158), as the signed-in, confirmed account it was sent
 * to. On a press of the button, never on load: mail scanners open links, and one that accepted on
 * load would spend the invitation before its owner saw it. The token leaves the address bar as the
 * page opens, as `/verify-email`'s does.
 *
 * Accepted, the session moves into the agency and the app loads again from Home, which says where
 * the reader now is — as creating an agency does.
 */
export function AcceptInvitation({ token, email }: { token: string; email: string }) {
  const t = useTranslations('auth.invitation');
  useEffect(forgetQuery, []);
  const { pending, error, onSubmit } = useSubmit(
    async () => {
      const joined = (await callApi<{ workspaceId: string; name: string }>('/invitations/accept', {
        body: { token },
      }))!;
      await callApi(`/workspaces/${encodeURIComponent(joined.workspaceId)}/activate`);
      return joined;
    },
    (joined) => {
      try {
        sessionStorage.setItem(SWITCHED_KEY, joined.workspaceId);
      } catch {
        // Only the confirmation on Home is lost.
      }
      navigate('/');
    },
  );
  const refused = error === null ? null : refusal(error);

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <p className="text-text-muted">{t('body', { email })}</p>
      {refused === null ? (
        <FormError error={error} />
      ) : (
        <Alert variant="destructive">
          <AlertContent>
            <AlertTitle>{t(`refused.${refused}`, { email })}</AlertTitle>
          </AlertContent>
        </Alert>
      )}
      {refused === 'unconfirmed' && (
        <Link href="/check-email" className={LINK}>
          {t('confirm_link')}
        </Link>
      )}
      {refused === 'member' ? (
        <Button asChild>
          <Link href="/">{t('home')}</Link>
        </Button>
      ) : (
        refused !== 'not_found' &&
        refused !== 'suspended' && (
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {t('submit')}
          </Button>
        )
      )}
    </form>
  );
}

/** For the states with no form: the token still leaves the address bar as the page opens. */
export function ForgetQuery() {
  useEffect(forgetQuery, []);
  return null;
}
