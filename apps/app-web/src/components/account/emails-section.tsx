import { getT } from '@/i18n/server';
import { serverApi, type Account } from '@/lib/api/server';
import type { NotificationPreference } from '@/lib/api/types';
import { EmailSwitch } from './email-switch';
import { AccountSection } from './section';

/**
 * Which emails the account gets, in this workspace (T-169): the one choice there is — activity —
 * as a switch. Account emails always go, and the section says so. An address not yet confirmed
 * receives no notification mail whatever the switch says (T-036), so it says that too.
 */
export async function EmailsSection({ account }: { account: Account }) {
  const t = await getT();
  const { preferences } = (await serverApi<{ preferences: NotificationPreference[] }>(
    '/notifications/preferences',
  )) ?? { preferences: [] };
  // No stored choice is on (T-036); the API returns defaults, and so does this.
  const activity =
    preferences.find((p) => p.category === 'activity' && p.channel === 'email')?.enabled ?? true;
  return (
    <AccountSection id="emails" title={t('account.emails.title')} body={t('account.emails.body')}>
      <EmailSwitch enabled={activity} />
      {!account.emailVerified && <p className="text-sm">{t('account.emails.unconfirmed')}</p>}
    </AccountSection>
  );
}
