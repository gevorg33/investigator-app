'use client';

import { Info, RotateCcw } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { Skeleton } from '@/components/ui/skeleton';
import { useAssistant } from './assistant-provider';
import { Composer } from './composer';
import { ConversationHeader } from './conversation-header';
import { EmptyConversation } from './empty-conversation';
import { MessageItem } from './message-item';
import { TurnStatus } from './turn-status';

/** Where the list was, for deciding where it should be after it changes. */
interface Seen {
  first: string | undefined;
  last: string | undefined;
  height: number;
  focus: number | null;
}

/**
 * The conversation, the same in the docked panel and the phone's sheet (T-056, T-057). Minimal
 * chrome (interaction-design: a conversation is already the simplest interface): the header, then
 * the conversation — opening at its end, earlier messages on request — and the composer.
 *
 * The list is a log: what is added to it is read out, politely, as it arrives.
 */
export function Conversation({
  Title = 'h2',
  onSessions,
  onClose,
}: {
  /** The heading element: the sheet's is its dialog title, which names the dialog. */
  Title?: ComponentType<{ className: string; children: ReactNode }> | 'h2';
  onSessions: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('assistant');
  const { audience, conversation } = useAssistant();
  const { state, running, canRetry, reload, loadEarlier, send, retry, stop } = conversation;
  const scroller = useRef<HTMLDivElement>(null);
  const seen = useRef<Seen>({ first: undefined, last: undefined, height: 0, focus: null });
  const [reaching, setReaching] = useState(false);

  // Where the reader should be as the conversation changes — instantly, so there is no motion to
  // reduce. A search match is brought into view; earlier messages arriving above keep the reader
  // where they were; anything else follows the conversation to its end.
  useLayoutEffect(() => {
    const el = scroller.current!;
    const first = state.messages[0]?.id;
    const last = state.messages.at(-1)?.id;
    const prev = seen.current;
    const match =
      state.focus === null
        ? null
        : el.querySelector<HTMLElement>(`[data-sequence="${state.focus}"]`);
    if (match !== null && state.focus !== prev.focus) match.scrollIntoView({ block: 'center' });
    else if (prev.first !== undefined && first !== prev.first && last === prev.last) {
      el.scrollTop += el.scrollHeight - prev.height;
    } else el.scrollTop = el.scrollHeight;
    seen.current = { first, last, height: el.scrollHeight, focus: state.focus };
  }, [state.messages, state.turn, state.focus]);

  const earlier = async () => {
    setReaching(true);
    await loadEarlier();
    setReaching(false);
  };

  const started = state.messages.length > 0 || state.turn !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConversationHeader Title={Title} onSessions={onSessions} onClose={onClose} />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {(state.status === 'idle' || state.status === 'loading') && (
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="ml-auto h-10 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {state.status === 'failed' && (
          <div className="grid gap-3">
            <p className="text-sm">{t('load.failed')}</p>
            <FormError error={state.loadError} />
            <Button variant="outline" onClick={() => void reload()} className="self-start">
              <RotateCcw aria-hidden />
              {t('turn.retry')}
            </Button>
          </div>
        )}

        {state.status === 'ready' && state.notice !== null && (
          <Marker
            role="status"
            className="mb-4 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <MarkerIcon>
              <Info />
            </MarkerIcon>
            <MarkerContent>{t(`notice.${state.notice}`)}</MarkerContent>
          </Marker>
        )}

        {state.status === 'ready' && !started && (
          <EmptyConversation audience={audience} onAsk={(q) => void send(q)} />
        )}

        {state.status === 'ready' && started && (
          <div className="grid gap-6">
            {state.earlier !== null && (
              <Button
                variant="ghost"
                onClick={() => void earlier()}
                disabled={reaching}
                className="justify-self-center"
              >
                {state.earlierFailed ? t('earlier_failed') : t('earlier')}
              </Button>
            )}
            <ol role="log" aria-label={t('label')} className="grid gap-6">
              {state.messages.map((m, i) => (
                <li
                  key={m.id}
                  data-sequence={m.sequence}
                  // The message a search found, marked where it sits in the conversation.
                  className={
                    m.sequence === state.focus
                      ? '-mx-2 rounded-lg bg-primary-subtle px-2 py-2'
                      : undefined
                  }
                >
                  <MessageItem
                    message={m}
                    pending={i === state.messages.length - 1 && state.turn === null}
                  />
                </li>
              ))}
            </ol>
            <TurnStatus state={state} canRetry={canRetry} onRetry={() => void retry()} />
          </div>
        )}
      </div>

      <div className="border-t border-border px-4 pt-3 pb-3">
        <Composer
          running={running}
          disabled={state.status !== 'ready'}
          onSend={(q) => void send(q)}
          onStop={stop}
        />
      </div>
    </div>
  );
}
