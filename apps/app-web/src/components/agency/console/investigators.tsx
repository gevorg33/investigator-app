'use client';

import { BadgeCheck, UserSearch } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { EmptyState } from '@/components/empty-state';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { useSubmit } from '@/components/form/use-submit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { callApi } from '@/lib/api/browser';
import type { AgencyInvestigatorView, EmployeeView } from '@/lib/api/types';
import { investigatorName } from '@/lib/investigator-name';
import { FORBIDDEN, memberName } from './shared';

export const INVESTIGATORS = '/agencies/current/investigators';

/**
 * The investigator profiles the agency runs (T-093, T-087): a card each up to `lg`, a table from
 * there, each with where it stands for customers — shown, verified, taking work — and an **Edit**
 * link to its own page. Who holds it is named, and a holder who is suspended or has left is said.
 */
export function AgencyInvestigators({
  profiles,
  members,
}: {
  profiles: AgencyInvestigatorView[];
  members: EmployeeView[];
}) {
  const t = useTranslations('agency.investigators');
  const ti = useTranslations('investigator');
  const holder = (p: AgencyInvestigatorView) => {
    const m = members.find((x) => x.membershipId === p.membershipId);
    return m === undefined ? (p.displayName ?? '') : memberName(m);
  };
  const name = (p: AgencyInvestigatorView) =>
    investigatorName(p, (code) => ti('public_name.unnamed', { code }));
  const listing = (p: AgencyInvestigatorView) => (
    <span className="flex flex-wrap gap-1">
      <Badge variant={p.visibility === 'PUBLISHED' ? 'secondary' : 'outline'}>
        {p.visibility === 'PUBLISHED' ? t('shown') : t('hidden')}
      </Badge>
      <Badge variant={p.verificationStatus === 'VERIFIED' ? 'secondary' : 'outline'}>
        {p.verificationStatus === 'VERIFIED' && <BadgeCheck aria-hidden />}
        {p.verificationStatus === 'VERIFIED' ? t('verified') : t('unverified')}
      </Badge>
      <Badge variant={p.acceptingWork ? 'secondary' : 'outline'}>
        {p.acceptingWork ? t('accepting') : t('not_accepting')}
      </Badge>
      {p.holderStatus !== 'ACTIVE' && (
        <Badge variant="warning">{t(`holder_${p.holderStatus}`)}</Badge>
      )}
    </span>
  );
  const edit = (p: AgencyInvestigatorView) => (
    <Button asChild variant="outline">
      <Link
        href={`/agency/investigators/${encodeURIComponent(p.id)}`}
        aria-label={t('edit_label', { name: name(p) })}
      >
        {t('edit')}
      </Link>
    </Button>
  );

  return (
    <div className="grid gap-6">
      {profiles.length === 0 ? (
        <EmptyState
          className="mt-0"
          icon={UserSearch}
          title={t('empty_title')}
          body={t('empty_body')}
        />
      ) : (
        <>
          <ul className="grid gap-3 lg:hidden">
            {profiles.map((p) => (
              <li key={p.id}>
                <Card>
                  <CardContent className="grid gap-3">
                    <div className="grid gap-0.5">
                      <p className="font-medium break-words">{name(p)}</p>
                      <p className="text-sm break-words text-text-muted">{holder(p)}</p>
                    </div>
                    {listing(p)}
                    {edit(p)}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <div className="hidden min-w-0 lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_profile')}</TableHead>
                  <TableHead>{t('col_holder')}</TableHead>
                  <TableHead>{t('col_listing')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('col_actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{name(p)}</TableCell>
                    <TableCell className="text-sm text-text-muted">{holder(p)}</TableCell>
                    <TableCell>{listing(p)}</TableCell>
                    <TableCell className="text-right">{edit(p)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <MakeProfile profiles={profiles} members={members} />
    </div>
  );
}

/**
 * A profile for an active member who has none here yet. Whether they have taken up the investigator
 * role is the API's to say — the list cannot know — and its refusal says what they must do.
 */
function MakeProfile({
  profiles,
  members,
}: {
  profiles: AgencyInvestigatorView[];
  members: EmployeeView[];
}) {
  const t = useTranslations('agency.investigators');
  const router = useRouter();
  const eligible = members.filter(
    (m) => m.status === 'ACTIVE' && !profiles.some((p) => p.membershipId === m.membershipId),
  );
  const [chosen, setChosen] = useState('');
  const { pending, error, onSubmit } = useSubmit(
    () => callApi<AgencyInvestigatorView>(INVESTIGATORS, { body: { membershipId: chosen } }),
    (made) => {
      setChosen('');
      if (made !== null) router.push(`/agency/investigators/${encodeURIComponent(made.id)}`);
      router.refresh();
    },
  );
  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="font-semibold">{t('create_title')}</h2>
          <p className="text-sm text-text-muted">{t('create_body')}</p>
        </div>
        {eligible.length === 0 ? (
          <p className="text-sm text-text-muted">{t('none_eligible')}</p>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            <FormError error={error} overrides={FORBIDDEN} />
            <SelectField
              label={t('member')}
              value={chosen}
              required
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="" disabled>
                {t('member')}
              </option>
              {eligible.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {memberName(m)}
                </option>
              ))}
            </SelectField>
            <div>
              <Button type="submit" disabled={pending || chosen === ''} aria-busy={pending}>
                {t('make')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
