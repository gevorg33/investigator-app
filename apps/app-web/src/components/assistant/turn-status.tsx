'use client';

import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import type { ConversationState } from './conversation-state';
import { Question } from './message-item';

/** What an unavailable assistant says: the question is kept, so "try again" means something. */
const OVERRIDES = { SERVICE_UNAVAILABLE: 'assistant.turn.unavailable' } as const;

/**
 * The end of the conversation while a turn is not simply finished: the question on its way and
 * each stage as it starts (animation: progressive rendering is information, a spinner is an
 * apology); or, once it ends without an answer, why — and one way on, Try again.
 *
 * Progress is a polite status: read out as it changes, never interrupting. A failure is an alert.
 */
export function TurnStatus({
  state,
  canRetry,
  onRetry,
}: {
  state: ConversationState;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('assistant');
  const turn = state.turn;

  if (turn?.phase === 'running') {
    const step = turn.step;
    const label =
      step === null
        ? t('step.sending')
        : step.step === 'writing'
          ? t('step.writing', { sources: step.sources })
          : t(`step.${step.step}`);
    return (
      <>
        {!turn.stored && <Question text={turn.question.content} />}
        <Marker role="status" aria-live="polite">
          <MarkerIcon>
            {/* The one continuous motion here, and honest: it runs exactly while work does. */}
            <span className="size-2 rounded-full bg-primary motion-safe:animate-pulse" />
          </MarkerIcon>
          <MarkerContent>{label}</MarkerContent>
        </Marker>
      </>
    );
  }

  if (!canRetry) return null;

  const unsent = turn?.unsent ?? null;
  const retry = (
    <Button variant="outline" onClick={onRetry} className="self-start">
      <RotateCcw aria-hidden />
      {t('turn.retry')}
    </Button>
  );
  const note =
    unsent !== null
      ? t('turn.unsent')
      : turn?.phase === 'stopped'
        ? t('turn.stopped')
        : turn === null
          ? t('turn.unanswered')
          : null;

  return (
    <div className="grid gap-3">
      {unsent !== null && <Question text={unsent.content} />}
      {note !== null && (
        <Marker role="status">
          <MarkerContent>{note}</MarkerContent>
        </Marker>
      )}
      {turn?.phase === 'failed' && <FormError error={turn.error} overrides={OVERRIDES} />}
      {retry}
    </div>
  );
}
