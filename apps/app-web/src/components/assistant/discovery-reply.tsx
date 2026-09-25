'use client';

import type { Locale } from '@investigator/i18n';
import { Ban, LocateFixed, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import type { Ask, DiscoveryAnswer } from '@/lib/api/assistant';
import { useAssistant } from './assistant-provider';
import { MIN_QUESTION } from './composer';
import { labels, languageName, list, placeName, windowParts } from './discovery-format';
import { InvestigatorCard } from './investigator-card';

/** Coordinates to two decimals (≈1 km): enough to search from, no closer than a service area's. */
const coarse = (v: number) => Math.round(v * 100) / 100;

/**
 * What discovery answered (T-018, T-059), rendered from the structured answer — no sentence of it
 * is the model's. What was searched, said out loud so it can be corrected; the investigators as
 * cards; nobody, said plainly; a refusal, with the policy to read; or the one question it needs
 * answered — which, while it is the conversation's last word, can be answered here.
 */
export function DiscoveryReply({
  answer,
  pending,
}: {
  answer: DiscoveryAnswer;
  /** This is the last thing said, and nothing runs: its question can be answered. */
  pending: boolean;
}) {
  const t = useTranslations('assistant.discovery');
  const locale = useLocale() as Locale;
  const { closeIfCovering } = useAssistant();

  if (answer.status === 'refused') {
    return (
      <div role="note" className="grid gap-2 rounded-lg border border-border bg-surface px-3 py-3">
        <p className="flex items-center gap-2 font-medium">
          <Ban aria-hidden className="size-4 shrink-0 text-danger" />
          {t('refused.title')}
        </p>
        <p className="text-sm">{t('refused.body')}</p>
        <Link
          href={`/help/${answer.refusal!.document}`}
          onClick={closeIfCovering}
          className="text-sm text-primary underline"
        >
          {t('refused.policy')}
        </Link>
      </div>
    );
  }

  if (answer.status === 'clarification') {
    return <ClarificationReply clarification={answer.clarification!} pending={pending} />;
  }

  const s = answer.searchedFor!;
  const searched = [
    ...labels(s.specialties),
    ...s.languages.map((c) => languageName(c, locale)),
    ...(s.place === null ? [] : [placeName(s.place, locale)]),
    ...(s.near ? [s.radiusKm ? t('within', { km: s.radiusKm }) : t('near_you')] : []),
    ...(s.availability === null
      ? []
      : [(({ day, from, to }) => `${day} ${from}–${to}`)(windowParts(s.availability, locale))]),
  ];

  return (
    <div className="grid gap-3">
      <div className="grid gap-1 text-sm text-text-muted">
        {searched.length > 0 && (
          <p>
            {t('searched')}: {list(searched, locale)}
          </p>
        )}
        {answer.assumptions.includes('location.anywhere') && <p>{t('anywhere')}</p>}
        {answer.orderedBy !== null && answer.results.length > 1 && (
          <p>{t(`ordered.${answer.orderedBy}`)}</p>
        )}
      </div>
      {answer.status === 'no_results' ? (
        <Marker className="rounded-lg border border-border bg-surface px-3 py-2 text-text">
          <MarkerIcon>
            <SearchX />
          </MarkerIcon>
          <MarkerContent>{t('none')}</MarkerContent>
        </Marker>
      ) : (
        <ul className="grid gap-3">
          {answer.results.map((m) => (
            <li key={m.investigatorId}>
              <InvestigatorCard match={m} />
            </li>
          ))}
        </ul>
      )}
      {answer.hasMore && <p className="text-sm text-text-muted">{t('more')}</p>}
    </div>
  );
}

/** Discovery's one question, and — while it waits for an answer — the ways to give it. */
function ClarificationReply({
  clarification,
  pending,
}: {
  clarification: NonNullable<DiscoveryAnswer['clarification']>;
  pending: boolean;
}) {
  const t = useTranslations('assistant.discovery.clarify');
  const { conversation } = useAssistant();
  const answer = (content: string, extra: Omit<Ask, 'content' | 'clarifies'> = {}) =>
    void conversation.send(content, { clarifies: true, ...extra });

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-surface px-3 py-3">
      <p className="font-medium">{t(clarification.code)}</p>
      {pending && clarification.code === 'specialty' && (
        <div className="flex flex-wrap gap-2">
          {clarification.options
            .filter((o) => o.label !== null)
            .map((o) => (
              <Button
                key={o.id}
                variant="outline"
                onClick={() => answer(o.label!, { taxonomyNodeIds: [o.id] })}
              >
                {o.label}
              </Button>
            ))}
        </div>
      )}
      {pending && clarification.code === 'location' && <Where onAnswer={answer} />}
      {pending && clarification.code === 'purpose' && (
        <Words label={t('purpose_label')} send={t('purpose_send')} onAnswer={answer} />
      )}
    </div>
  );
}

/** Where: the device's location, or a place in the person's words. */
function Where({
  onAnswer,
}: {
  onAnswer: (content: string, extra?: Omit<Ask, 'content' | 'clarifies'>) => void;
}) {
  const t = useTranslations('assistant.discovery.clarify');
  const [state, setState] = useState<'idle' | 'locating' | 'denied'>('idle');

  const locate = () => {
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        onAnswer(t('my_location'), {
          near: { lon: coarse(coords.longitude), lat: coarse(coords.latitude) },
        }),
      () => setState('denied'),
    );
  };

  return (
    <div className="grid gap-3">
      {'geolocation' in navigator && state !== 'denied' && (
        <Button
          variant="outline"
          onClick={locate}
          disabled={state === 'locating'}
          className="self-start"
        >
          <LocateFixed aria-hidden />
          {state === 'locating' ? t('locating') : t('use_location')}
        </Button>
      )}
      {state === 'denied' && (
        <p role="status" className="text-sm">
          {t('location_denied')}
        </p>
      )}
      <Words label={t('place')} send={t('place_send')} onAnswer={onAnswer} />
    </div>
  );
}

/** An answer in the person's own words. */
function Words({
  label,
  send,
  onAnswer,
}: {
  label: string;
  send: string;
  onAnswer: (content: string) => void;
}) {
  const [text, setText] = useState('');
  const ready = text.trim().length >= MIN_QUESTION;
  // Never submitted unready: with its only button disabled, a form is not sent by Enter either.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAnswer(text.trim());
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <Input
        aria-label={label}
        placeholder={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        className="min-w-0 flex-1"
      />
      <Button type="submit" disabled={!ready}>
        {send}
      </Button>
    </form>
  );
}
