'use client';

import { Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { EmptyState } from '@/components/empty-state';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { callApi } from '@/lib/api/browser';
import type { ApiError } from '@/lib/api/errors';
import type { EmployeeView, TeamView } from '@/lib/api/types';
import { ConfirmSheet } from './confirm-sheet';
import { asApiError, FORBIDDEN, memberName } from './shared';

const TEAMS = '/agencies/current/teams';

/**
 * The agency's teams (T-093): a new team at the top, then a card each — at every width, because a
 * team is a group of people with its own actions rather than a row of values: its members, each
 * taken out with one tap, adding a member from the agency, renaming, and deleting, asked first by
 * the team's name. Taking someone out of a team is not asked: they stay in the agency, and adding
 * them back is one tap.
 */
export function Teams({ teams, members }: { teams: TeamView[]; members: EmployeeView[] }) {
  const t = useTranslations('agency.teams');
  return (
    <div className="grid gap-6">
      <CreateTeam />
      {teams.length === 0 ? (
        <EmptyState className="mt-0" icon={Users} title={t('empty_title')} body={t('empty_body')} />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {teams.map((team) => (
            <li key={team.id}>
              <TeamCard team={team} members={members} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The team's name and what it is for. Blank description means none. */
function TeamFields({ team, focus = false }: { team?: TeamView; focus?: boolean }) {
  const t = useTranslations('agency.teams');
  const id = useId();
  return (
    <>
      <Field
        label={t('name')}
        name="name"
        required
        maxLength={80}
        defaultValue={team?.name ?? ''}
        // Editing replaces the Edit button with this form: focus goes where the work is.
        autoFocus={focus}
      />
      <div className="grid gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('description')}
        </label>
        <Textarea
          id={id}
          name="description"
          maxLength={500}
          rows={2}
          aria-describedby={`${id}-hint`}
          defaultValue={team?.description ?? ''}
        />
        <p id={`${id}-hint`} className="text-sm text-text-muted">
          {t('description_hint')}
        </p>
      </div>
    </>
  );
}

const described = (form: FormData) => String(form.get('description')).trim();

function CreateTeam() {
  const t = useTranslations('agency.teams');
  const router = useRouter();
  const [created, setCreated] = useState(false);
  const [key, setKey] = useState(0);
  const { pending, error, onSubmit } = useSubmit(
    (form) => {
      setCreated(false);
      const description = described(form);
      return callApi(TEAMS, {
        body: {
          name: String(form.get('name')).trim(),
          ...(description === '' ? {} : { description }),
        },
      });
    },
    () => {
      setCreated(true);
      // A fresh, empty form for the next team.
      setKey((k) => k + 1);
      router.refresh();
    },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('create_title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form key={key} onSubmit={onSubmit} className="grid gap-4">
          <FormError error={error} overrides={FORBIDDEN} />
          <TeamFields />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {t('create')}
            </Button>
            {created && (
              <p role="status" className="text-sm text-success">
                {t('created')}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TeamCard({ team, members }: { team: TeamView; members: EmployeeView[] }) {
  const t = useTranslations('agency.teams');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  /** Closes the form and puts focus back on the button that opened it. */
  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const addId = useId();
  const outside = members.filter(
    (m) => !team.members.some((x) => x.membershipId === m.membershipId),
  );
  const [adding, setAdding] = useState('');

  const act = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setPending(false);
    }
  };

  const edit = useSubmit(
    (form) => {
      const description = described(form);
      return callApi(`${TEAMS}/${team.id}`, {
        method: 'PATCH',
        body: { name: String(form.get('name')).trim(), description: description || null },
      });
    },
    () => {
      stopEditing();
      router.refresh();
    },
  );

  return (
    <Card className="h-full">
      <CardHeader>
        {editing ? (
          <form
            onSubmit={edit.onSubmit}
            className="grid gap-4"
            aria-label={t('edit_label', { team: team.name })}
          >
            <FormError error={edit.error} overrides={FORBIDDEN} />
            <TeamFields team={team} focus />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={edit.pending} aria-busy={edit.pending}>
                {t('save')}
              </Button>
              <Button type="button" variant="outline" onClick={stopEditing}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <CardTitle className="break-words">{team.name}</CardTitle>
            {team.description !== null && (
              <p className="text-sm break-words text-text-muted">{team.description}</p>
            )}
            <p className="text-sm text-text-muted">
              {t('members_count', { count: team.members.length })}
            </p>
          </>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError error={error} overrides={FORBIDDEN} />
        {team.members.length > 0 && (
          <ul className="grid gap-1">
            {team.members.map((m) => (
              <li
                key={m.membershipId}
                className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border pl-3"
              >
                <span className="min-w-0 text-sm break-words">{memberName(m)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  aria-label={t('remove_member', { name: memberName(m), team: team.name })}
                  onClick={() =>
                    void act(() =>
                      callApi(`${TEAMS}/${team.id}/members/${m.membershipId}`, {
                        method: 'DELETE',
                      }),
                    )
                  }
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {outside.length === 0 ? (
          <p className="text-sm text-text-muted">{t('everyone_in')}</p>
        ) : (
          <form
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              // The select is required, so the form is never sent without a member chosen.
              void act(async () => {
                await callApi(`${TEAMS}/${team.id}/members`, { body: { membershipId: adding } });
                setAdding('');
              });
            }}
          >
            <label htmlFor={addId} className="text-sm font-medium">
              {t('add_label')}
            </label>
            <div className="flex gap-2">
              <NativeSelect
                id={addId}
                className="min-w-0 flex-1"
                value={adding}
                required
                onChange={(e) => setAdding(e.target.value)}
              >
                <option value="" disabled>
                  {t('add_label')}
                </option>
                {outside.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {memberName(m)}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" variant="outline" disabled={pending || adding === ''}>
                {t('add')}
              </Button>
            </div>
          </form>
        )}
        {!editing && (
          <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
            <Button
              ref={editButton}
              type="button"
              variant="outline"
              aria-label={t('edit_label', { team: team.name })}
              onClick={() => setEditing(true)}
            >
              {t('edit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-danger"
              aria-label={t('delete_label', { team: team.name })}
              onClick={() => setDeleting(true)}
            >
              {t('delete')}
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmSheet
        open={deleting}
        onOpenChange={setDeleting}
        title={t('delete_title', { team: team.name })}
        body={t('delete_body')}
        confirm={t('delete_confirm', { team: team.name })}
        keep={t('keep')}
        onConfirm={async () => {
          await callApi(`${TEAMS}/${team.id}`, { method: 'DELETE' });
          router.refresh();
        }}
      />
    </Card>
  );
}
