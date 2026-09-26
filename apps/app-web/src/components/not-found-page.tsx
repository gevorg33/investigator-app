import { ArrowLeft, House } from 'lucide-react';
import Link from 'next/link';
import { Page } from '@/components/page';
import { getT } from '@/i18n/server';

const LINK =
  'inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline';

/**
 * What `notFound()` renders inside the workspace (T-151): in the reader's language, inside the
 * shell, with a way back — Home always, and the list the page belongs to when the route knows it.
 *
 * It says the same thing whatever the reason. The API answers a draft profile, another audience's
 * article and another customer's mission exactly as it answers one that does not exist, and this
 * page must not undo that by telling them apart.
 */
export async function NotFoundPage({ back }: { back?: { href: string; label: string } }) {
  const t = await getT();
  return (
    <Page title={t('not_found.title')}>
      <p className="mt-2 text-text-muted">{t('not_found.body')}</p>
      <nav className="mt-6 flex flex-col items-start gap-1 sm:flex-row sm:gap-6">
        {back !== undefined && (
          <Link href={back.href} className={LINK}>
            <ArrowLeft aria-hidden className="size-4" />
            {back.label}
          </Link>
        )}
        <Link href="/" className={LINK}>
          <House aria-hidden className="size-4" />
          {t('not_found.home')}
        </Link>
      </nav>
    </Page>
  );
}
