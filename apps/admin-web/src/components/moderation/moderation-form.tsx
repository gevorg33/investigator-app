'use client';

import { breakpoints } from '@investigator/ui-tokens';
import { Gavel } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { useMediaQuery } from '@/hooks/use-media-query';
import { t, type MessageKey } from '@/i18n/messages';
import { callApi } from '@/lib/api/browser';
import type { ModerationOutcome, TagOption } from '@/lib/api/types';

/** The API's longest reason and note (`REASON_MAX`, `NOTE_MAX`, mission-moderation.policy.ts). */
export const REASON_MAX = 2000;
export const NOTE_MAX = 4000;
/** The most tags a mission carries (`MAX_MISSION_TAGS`, tag-rules.ts). */
export const MAX_MISSION_TAGS = 8;

const OUTCOMES: ReadonlyArray<[ModerationOutcome, MessageKey]> = [
  ['PUBLISHED', 'moderate.publish'],
  ['CHANGES_REQUESTED', 'moderate.request_changes'],
  ['REJECTED', 'moderate.reject'],
];

/** Which reason field it is, by who reads it. Before an outcome is chosen, neither. */
const REASON_LABEL = (outcome: ModerationOutcome | null): [MessageKey, MessageKey] =>
  outcome === null
    ? ['moderate.reason', 'moderate.reason_hint']
    : outcome === 'PUBLISHED'
      ? ['moderate.reason.staff', 'moderate.reason.staff_hint']
      : ['moderate.reason.customer', 'moderate.reason.customer_hint'];

/**
 * Deciding a mission under review (T-051): publish, return for changes, or reject — with a reason
 * for each. Nothing is pre-selected: no screening result or model opinion chooses for the moderator.
 * The control stays disabled until an outcome is chosen and the reason says something.
 *
 * The reason field says who reads it. On a rejection or a return the customer reads it as written
 * (`review`, T-119), so its label says so; on a publication it is staff only. What the reason must
 * not say goes in the internal note, which the customer never sees. A sheet from the bottom on a
 * phone, from the side from `md` (responsive-design). Decided, the page is read again.
 *
 * Publishing also confirms the mission's tags (T-055). The customer's suggestions come ticked and
 * first; the moderator keeps what fits and adds what is missing. Only confirmed tags reach browsing,
 * so nothing is sent for them on any other outcome — the API would refuse it. A suggestion since
 * retired is not offered: it cannot be confirmed.
 */
export function ModerationForm({
  missionId,
  version,
  tags,
  suggested,
}: {
  missionId: string;
  version: number;
  /** The ACTIVE vocabulary, in label order. */
  tags: readonly TagOption[];
  /** The ids the customer suggested. */
  suggested: readonly string[];
}) {
  const router = useRouter();
  const side = useMediaQuery(`(min-width: ${breakpoints.md})`) ? 'right' : 'bottom';
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ModerationOutcome | null>(null);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const noteId = useId();
  const [reasonLabel, reasonHint] = REASON_LABEL(outcome);
  const ready = outcome !== null && reason.trim() !== '';
  const offered = [
    ...tags.filter((tag) => suggested.includes(tag.id)),
    ...tags.filter((tag) => !suggested.includes(tag.id)),
  ];
  const [chosen, setChosen] = useState<string[]>(() =>
    offered.filter((tag) => suggested.includes(tag.id)).map((tag) => tag.id),
  );
  const tagsFull = chosen.length >= MAX_MISSION_TAGS;
  const toggle = (id: string, on: boolean) =>
    setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)));

  const { pending, error, onSubmit } = useSubmit(
    (form) => {
      const note = String(form.get('internalNote')).trim();
      return callApi(`/moderation/missions/${encodeURIComponent(missionId)}/decision`, {
        body: {
          outcome,
          reason: reason.trim(),
          ...(note === '' ? {} : { internalNote: note }),
          ...(outcome === 'PUBLISHED' && chosen.length > 0 ? { tagIds: chosen } : {}),
          version,
        },
      });
    },
    () => {
      setOpen(false);
      router.refresh();
    },
  );

  return (
    <Drawer open={open} onOpenChange={setOpen} direction={side}>
      <DrawerTrigger asChild>
        <Button className="self-start">
          <Gavel aria-hidden />
          {t('moderate.open')}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader className="flex-col items-start">
            <DrawerTitle>{t('moderate.title')}</DrawerTitle>
            <DrawerDescription>{t('moderate.description')}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 overflow-y-auto px-4 pb-4">
            <FormError error={error} overrides={{ STATE_CONFLICT: 'moderate.conflict' }} />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('moderate.outcome')}</legend>
              {OUTCOMES.map(([value, label]) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-border-control px-3"
                >
                  <input
                    type="radio"
                    name="outcome"
                    value={value}
                    checked={outcome === value}
                    onChange={() => setOutcome(value)}
                    className="size-4"
                  />
                  {t(label)}
                </label>
              ))}
            </fieldset>
            {outcome === 'PUBLISHED' && offered.length > 0 && (
              <fieldset className="grid gap-2" aria-describedby={`${reasonId}-tags`}>
                <legend className="mb-1 text-sm font-medium">{t('moderate.tags')}</legend>
                <p id={`${reasonId}-tags`} className="text-sm text-text-muted">
                  {t('moderate.tags_hint')}
                </p>
                {offered.map((tag) => {
                  const on = chosen.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className="flex min-h-11 items-center gap-3 rounded-md border border-border-control px-3"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={tagsFull && !on}
                        onChange={(e) => toggle(tag.id, e.target.checked)}
                        className="size-4"
                      />
                      {suggested.includes(tag.id)
                        ? t('moderate.tags_suggested', { label: tag.label })
                        : tag.label}
                    </label>
                  );
                })}
              </fieldset>
            )}
            <div className="grid gap-1.5">
              <label htmlFor={reasonId} className="text-sm font-medium">
                {t(reasonLabel)}
              </label>
              <Textarea
                id={reasonId}
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={REASON_MAX}
                aria-describedby={`${reasonId}-hint`}
                className="min-h-28"
              />
              <p id={`${reasonId}-hint`} className="text-sm text-text-muted">
                {t(reasonHint)}
              </p>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={noteId} className="text-sm font-medium">
                {t('moderate.note')}
              </label>
              <Textarea
                id={noteId}
                name="internalNote"
                maxLength={NOTE_MAX}
                aria-describedby={`${noteId}-hint`}
                className="min-h-20"
              />
              <p id={`${noteId}-hint`} className="text-sm text-text-muted">
                {t('moderate.note_hint')}
              </p>
            </div>
          </div>
          <DrawerFooter className="flex-col-reverse sm:flex-row sm:justify-end">
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                {t('moderate.cancel')}
              </Button>
            </DrawerClose>
            <Button type="submit" disabled={!ready || pending} aria-busy={pending}>
              {t('moderate.submit')}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
