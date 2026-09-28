import { AccountSection } from '@/components/account/section';
import { GOOGLE_LINK, GoogleButton } from '@/components/auth/google-button';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { getT } from '@/i18n/server';
import { serverApi } from '@/lib/api/server';
import type { SignInMethods as Methods } from '@/lib/api/types';
import { DisconnectGoogle } from './disconnect-google';

/** What the callback may say when it brings the reader back here after connecting Google. */
const OUTCOMES = ['linked', 'taken', 'failed', 'denied'] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * How this account signs in (T-062): whether it has a password, and the Google account connected
 * to it — connect one, or disconnect it. The API refuses to disconnect the last way in; this says
 * how to add a password first.
 */
export async function SignInMethods({ outcome }: { outcome?: string | undefined }) {
  const [t, methods, providers] = await Promise.all([
    getT(),
    serverApi<Methods>('/auth/identities'),
    serverApi<{ google: boolean }>('/auth/providers'),
  ]);
  const google = methods!.identities.find((i) => i.provider === 'GOOGLE');
  const said = OUTCOMES.find((o): o is Outcome => o === outcome);
  return (
    <AccountSection id="sign-in" title={t('account.sign_in.title')}>
      {said !== undefined && (
        <Alert variant={said === 'linked' ? 'default' : 'destructive'}>
          <AlertContent>
            <AlertTitle>{t(`account.sign_in.${said}`)}</AlertTitle>
          </AlertContent>
        </Alert>
      )}
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <dt className="text-sm text-text-muted">{t('account.sign_in.password')}</dt>
          <dd>
            {methods!.password
              ? t('account.sign_in.password_set')
              : t('account.sign_in.password_unset')}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-sm text-text-muted">{t('account.sign_in.google')}</dt>
          <dd className="break-words">
            {google !== undefined
              ? t('account.sign_in.google_connected', { email: google.email ?? '' })
              : t('account.sign_in.google_none')}
          </dd>
        </div>
      </dl>
      {google !== undefined ? (
        <DisconnectGoogle identityId={google.id} />
      ) : (
        providers!.google && (
          <div className="sm:w-fit">
            <GoogleButton
              action={GOOGLE_LINK}
              next="/account"
              label={t('account.sign_in.connect')}
            />
          </div>
        )
      )}
    </AccountSection>
  );
}
