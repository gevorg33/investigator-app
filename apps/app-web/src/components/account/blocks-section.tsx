import { formatDateTime, type Locale } from '@investigator/i18n';
import { Ban, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Unblock } from '@/components/blocks/unblock';
import { getT } from '@/i18n/server';
import { serverApi, type Account } from '@/lib/api/server';
import type { BlockView } from '@/lib/api/types';
import { AccountSection } from './section';

/**
 * The people the account has blocked, newest first, each with a way to unblock (T-052). A person
 * is named as the blocker saw them; a customer blocked from a mission has no name to show — until
 * hired, customers are anonymous to investigators — so the entry says where the block was made.
 */
export async function BlocksSection({ account, locale }: { account: Account; locale: Locale }) {
  const t = await getT();
  const { items } = (await serverApi<{ items: BlockView[] }>('/blocks')) ?? { items: [] };
  return (
    <AccountSection id="blocks" title={t('account.blocks.title')} body={t('account.blocks.body')}>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">{t('account.blocks.empty')}</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((b) => (
            <li
              key={b.id}
              className="grid gap-3 rounded-md border border-border p-4 sm:flex sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <Ban aria-hidden className="mt-0.5 size-5 shrink-0 text-text-muted" />
                <div className="grid gap-0.5 text-sm">
                  <p className="font-medium">{b.label ?? t('account.blocks.customer')}</p>
                  <p className="text-text-muted">{t(`account.blocks.source.${b.source}`)}</p>
                  <p className="text-text-muted">
                    {t('account.blocks.on', {
                      date: formatDateTime(b.createdAt, {
                        locale,
                        timeZone: account.timezone,
                        style: 'date',
                      }),
                    })}
                  </p>
                  {b.investigatorProfileId !== null && (
                    <Link
                      href={`/missions/investigators/${b.investigatorProfileId}`}
                      className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
                    >
                      {t('account.blocks.profile')}
                      <ChevronRight aria-hidden className="size-4" />
                    </Link>
                  )}
                </div>
              </div>
              <Unblock id={b.id} />
            </li>
          ))}
        </ul>
      )}
    </AccountSection>
  );
}
