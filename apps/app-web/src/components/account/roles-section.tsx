import type { Locale } from '@investigator/i18n';
import { Check } from 'lucide-react';
import { chooseActiveRole } from '@/app/(workspace)/account/actions';
import { getT } from '@/i18n/server';
import type { Account } from '@/lib/api/server';
import { serverApi } from '@/lib/api/server';
import type { LegalDocument } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { AddRoleForm } from './add-role-form';
import { AccountSection } from './section';

const ROLES = ['CUSTOMER', 'INVESTIGATOR'] as const;

/**
 * Hiring investigators, working as one, or both — on one account (plan.md: never a second one).
 * A role not yet held can be added once the address is confirmed (the API requires an active
 * account); with both held, the platform can be shown as one of them, which only ever narrows.
 */
export async function RolesSection({ account, locale }: { account: Account; locale: Locale }) {
  const t = await getT();
  const held = ROLES.filter((r) => account.roles.includes(r));
  const missing = ROLES.filter((r) => !account.roles.includes(r));
  // Only an account that can add a role is shown what adding it requires.
  const required = account.emailVerified
    ? await Promise.all(
        missing.map(
          async (role) =>
            (await serverApi<LegalDocument[]>(`/legal/required?for=${role}&locale=${locale}`)) ??
            [],
        ),
      )
    : [];
  const name = {
    CUSTOMER: t('account.roles.customer'),
    INVESTIGATOR: t('account.roles.investigator'),
  };
  const add = {
    CUSTOMER: t('account.roles.add_customer'),
    INVESTIGATOR: t('account.roles.add_investigator'),
  };
  return (
    <AccountSection id="roles" title={t('account.roles.title')}>
      {held.length > 0 && (
        <ul className="grid gap-2">
          {held.map((role) => (
            <li key={role} className="flex items-center gap-2 text-sm">
              <Check aria-hidden className="size-4 text-success" />
              {name[role]}
            </li>
          ))}
        </ul>
      )}
      {held.length === ROLES.length && (
        <form action={chooseActiveRole} className="grid gap-2">
          <p className="text-sm font-medium">{t('account.roles.acting_as')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {(
              [
                ['both', t('account.roles.act_both'), account.activeRole === null],
                ['CUSTOMER', t('account.roles.act_customer'), account.activeRole === 'CUSTOMER'],
                [
                  'INVESTIGATOR',
                  t('account.roles.act_investigator'),
                  account.activeRole === 'INVESTIGATOR',
                ],
              ] as const
            ).map(([value, label, pressed]) => (
              <button
                key={value}
                type="submit"
                name="role"
                value={value}
                aria-pressed={pressed}
                className={cn(
                  'flex min-h-11 items-center justify-center gap-2 rounded-md border border-border-control px-4 text-base transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-sunken',
                  pressed &&
                    'border-primary bg-primary-subtle font-semibold text-primary hover:bg-primary-subtle',
                )}
              >
                {pressed && <Check aria-hidden className="size-4" />}
                {label}
              </button>
            ))}
          </div>
        </form>
      )}
      {missing.length > 0 && !account.emailVerified && (
        <p className="text-sm text-text-muted">{t('account.roles.verify_first')}</p>
      )}
      {missing.length > 0 &&
        account.emailVerified &&
        missing.map((role, i) => (
          <AddRoleForm key={role} role={role} label={add[role]} documents={required[i]!} />
        ))}
    </AccountSection>
  );
}
