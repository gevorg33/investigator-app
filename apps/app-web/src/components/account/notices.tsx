import Link from 'next/link';
import { getT } from '@/i18n/server';

/**
 * What the account still owes, above every workspace screen: an unconfirmed address, documents
 * to accept. Notices, not blocks — outstanding acceptance stops only the actions it covers, and
 * never cuts off what someone already has (T-022, `legal-consent`).
 */
export async function AccountNotices({
  unverified,
  outstanding,
}: {
  unverified: boolean;
  outstanding: boolean;
}) {
  if (!unverified && !outstanding) return null;
  const t = await getT();
  const notice = (text: string, href: string) => (
    <p className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border bg-primary-subtle px-4 text-sm md:px-8">
      <span className="py-3">{text}</span>
      <Link
        href={href}
        className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t('shell.review')}
      </Link>
    </p>
  );
  return (
    <div role="status">
      {outstanding && notice(t('shell.outstanding'), '/account#legal')}
      {unverified && notice(t('shell.unverified'), '/account#profile')}
    </div>
  );
}
