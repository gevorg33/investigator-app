'use client';

import { UserRound, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { useSheetSide } from '@/components/missions/filter-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { callApi } from '@/lib/api/browser';
import type { ApiError } from '@/lib/api/errors';
import type { EmployeeView } from '@/lib/api/types';
import { useReturnFocus } from './confirm-sheet';
import { asApiError, FORBIDDEN, memberName, ROLE_KEYS } from './shared';

const MEMBERS = '/agencies/current/members';

/**
 * The agency's members (T-093): a card each up to `lg`, a table from there — at `md` the sidebar
 * leaves too little width for five columns and an address. Every member has one
 * **Manage** button — a tap, never a hover — opening a sheet with their details, roles and access.
 * The list is the API's, re-read after every change, so a sheet always shows the member as saved.
 */
export function Members({ members }: { members: EmployeeView[] }) {
  const t = useTranslations('agency');
  const [managing, setManaging] = useState<string | null>(null);
  const current = members.find((m) => m.membershipId === managing) ?? null;

  const roles = (m: EmployeeView) => (
    <span className="flex flex-wrap gap-1">
      {m.roles.map((r) => (
        <Badge key={r} variant="secondary">
          {ROLE_KEYS.includes(r) ? t(`roles.${r as 'OWNER'}`) : r}
        </Badge>
      ))}
    </span>
  );
  const status = (m: EmployeeView) => (
    <Badge variant={m.status === 'ACTIVE' ? 'outline' : 'warning'}>
      {t(`people.status_${m.status}`)}
    </Badge>
  );
  const job = (m: EmployeeView) => [m.jobTitle, m.department].filter(Boolean).join(' · ');
  const manage = (m: EmployeeView) => (
    <Button
      type="button"
      variant="outline"
      aria-label={t('console.manage_label', { name: memberName(m) })}
      onClick={() => setManaging(m.membershipId)}
    >
      {t('console.manage')}
    </Button>
  );
  const who = (m: EmployeeView) => (
    <span className="grid min-w-0 gap-0.5">
      <span className="flex flex-wrap items-center gap-2 font-medium break-words">
        {memberName(m)}
        {m.you && <Badge variant="outline">{t('console.you')}</Badge>}
      </span>
      {m.displayName?.trim() && (
        <span className="text-sm break-all text-text-muted">{m.email}</span>
      )}
    </span>
  );

  return (
    <>
      <ul className="grid gap-3 lg:hidden">
        {members.map((m) => (
          <li key={m.membershipId} className="grid gap-3 rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <UserRound aria-hidden className="mt-0.5 size-5 shrink-0 text-text-muted" />
              {who(m)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {status(m)}
              {roles(m)}
            </div>
            {job(m) !== '' && <p className="text-sm text-text-muted">{job(m)}</p>}
            {manage(m)}
          </li>
        ))}
      </ul>
      <div className="hidden min-w-0 lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('people.col_person')}</TableHead>
              <TableHead>{t('people.col_roles')}</TableHead>
              <TableHead>{t('people.col_status')}</TableHead>
              <TableHead>{t('people.col_job')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('people.col_actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.membershipId}>
                <TableCell>{who(m)}</TableCell>
                <TableCell>{roles(m)}</TableCell>
                <TableCell>{status(m)}</TableCell>
                <TableCell className="text-sm text-text-muted">{job(m)}</TableCell>
                <TableCell className="text-right">{manage(m)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <MemberSheet member={current} onClose={() => setManaging(null)} />
    </>
  );
}

type Step = 'manage' | 'suspend' | 'remove';

/**
 * One member, managed in a sheet: their details and roles, each saved on its own, and their access.
 * Suspending and removing are asked first, in the same sheet, by name; reactivating is not, because
 * it takes nothing away. You do not suspend or remove yourself here — another owner or admin does.
 */
function MemberSheet({ member, onClose }: { member: EmployeeView | null; onClose: () => void }) {
  const t = useTranslations('agency');
  const side = useSheetSide();
  const returnFocus = useReturnFocus();
  const [step, setStep] = useState<Step>('manage');
  const close = () => {
    setStep('manage');
    onClose();
  };
  return (
    <Drawer open={member !== null} onOpenChange={(open) => !open && close()} direction={side}>
      <DrawerContent {...returnFocus}>
        {member !== null && (
          <>
            <DrawerHeader>
              <DrawerTitle className="break-words">
                {step === 'manage'
                  ? memberName(member)
                  : t(`people.${step}_title`, { name: memberName(member) })}
              </DrawerTitle>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" aria-label={t('console.close')}>
                  <X aria-hidden />
                </Button>
              </DrawerClose>
            </DrawerHeader>
            <div className="grid gap-6 overflow-y-auto px-4 pb-4">
              {step === 'manage' ? (
                <>
                  <DrawerDescription className="break-all">{member.email}</DrawerDescription>
                  <DetailsForm member={member} />
                  <RolesForm member={member} />
                  <Access member={member} onAsk={setStep} />
                </>
              ) : (
                <ConfirmStep
                  member={member}
                  step={step}
                  onBack={() => setStep('manage')}
                  onDone={close}
                />
              )}
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** Job title and department. Blank clears. */
function DetailsForm({ member }: { member: EmployeeView }) {
  const t = useTranslations('agency');
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const blank = (v: FormDataEntryValue | null) => String(v).trim() || null;
  const { pending, error, onSubmit } = useSubmit(
    (form) => {
      setSaved(false);
      return callApi(`${MEMBERS}/${member.membershipId}`, {
        method: 'PATCH',
        body: { jobTitle: blank(form.get('jobTitle')), department: blank(form.get('department')) },
      });
    },
    () => {
      setSaved(true);
      router.refresh();
    },
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4" aria-label={t('people.details_title')}>
      <h3 className="font-semibold">{t('people.details_title')}</h3>
      <FormError error={error} overrides={FORBIDDEN} />
      <Field
        label={t('people.job_title')}
        name="jobTitle"
        maxLength={120}
        defaultValue={member.jobTitle ?? ''}
      />
      <Field
        label={t('people.department')}
        name="department"
        maxLength={120}
        defaultValue={member.department ?? ''}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
          {t('people.save_details')}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-success">
            {t('console.saved')}
          </p>
        )}
      </div>
    </form>
  );
}

/** The whole set of roles, replaced together — the API refuses any the reader does not hold. */
function RolesForm({ member }: { member: EmployeeView }) {
  const t = useTranslations('agency');
  const router = useRouter();
  const id = useId();
  const [chosen, setChosen] = useState<string[]>(member.roles);
  const [saved, setSaved] = useState(false);
  const { pending, error, onSubmit } = useSubmit(
    () => {
      setSaved(false);
      return callApi(`${MEMBERS}/${member.membershipId}/roles`, {
        method: 'PUT',
        body: { roles: ROLE_KEYS.filter((r) => chosen.includes(r)) },
      });
    },
    () => {
      setSaved(true);
      router.refresh();
    },
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-3" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-semibold">
        {t('people.roles_title')}
      </h3>
      <p className="text-sm text-text-muted">{t('people.roles_hint')}</p>
      <FormError error={error} overrides={FORBIDDEN} />
      <div className="grid gap-2 sm:grid-cols-2">
        {ROLE_KEYS.map((role) => (
          <label
            key={role}
            htmlFor={`${id}-${role}`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-[[data-state=checked]]:border-primary"
          >
            <Checkbox
              id={`${id}-${role}`}
              checked={chosen.includes(role)}
              onCheckedChange={(on) =>
                setChosen((now) => (on === true ? [...now, role] : now.filter((r) => r !== role)))
              }
            />
            <span className="text-sm">{t(`roles.${role as 'OWNER'}`)}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
          {t('people.save_roles')}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-success">
            {t('console.saved')}
          </p>
        )}
      </div>
    </form>
  );
}

/** Suspend or reactivate, and remove — never for the reader themself. */
function Access({ member, onAsk }: { member: EmployeeView; onAsk: (step: Step) => void }) {
  const t = useTranslations('agency');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  if (member.you) return null;
  const reactivate = async () => {
    setPending(true);
    setError(null);
    try {
      await callApi(`${MEMBERS}/${member.membershipId}/reactivate`);
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      className="grid gap-3 border-t border-border pt-4"
      aria-label={t('people.access_title')}
    >
      <h3 className="font-semibold">{t('people.access_title')}</h3>
      <FormError error={error} overrides={FORBIDDEN} />
      {done && (
        <p role="status" className="text-sm text-success">
          {t('people.reactivated', { name: memberName(member) })}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {member.status === 'ACTIVE' ? (
          <Button type="button" variant="outline" onClick={() => onAsk('suspend')}>
            {t('people.suspend')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void reactivate()}
          >
            {t('people.reactivate')}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="text-danger"
          onClick={() => onAsk('remove')}
        >
          {t('people.remove')}
        </Button>
      </div>
    </section>
  );
}

/** "Suspend Ani?" / "Remove Ani?", with what follows, in the same sheet. */
function ConfirmStep({
  member,
  step,
  onBack,
  onDone,
}: {
  member: EmployeeView;
  step: 'suspend' | 'remove';
  onBack: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('agency');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const name = memberName(member);
  const run = async () => {
    setPending(true);
    setError(null);
    try {
      await callApi(`${MEMBERS}/${member.membershipId}/${step}`);
      router.refresh();
      onDone();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="grid gap-4">
      <DrawerDescription>{t(`people.${step}_body`, { name })}</DrawerDescription>
      <FormError error={error} overrides={FORBIDDEN} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          aria-busy={pending}
          onClick={() => void run()}
        >
          {t(`people.${step}_confirm`, { name })}
        </Button>
        <Button type="button" variant="outline" onClick={onBack}>
          {t('console.back')}
        </Button>
      </div>
    </div>
  );
}
