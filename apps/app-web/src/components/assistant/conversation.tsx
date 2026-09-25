'use client';

import { RotateCcw, SquarePen, X } from 'lucide-react';
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAssistant } from './assistant-provider';
import { Composer } from './composer';
import { EmptyConversation } from './empty-conversation';
import { MessageItem } from './message-item';
import { TurnStatus } from './turn-status';

/**
 * The conversation, the same in the docked panel and the phone's sheet (T-056). Minimal chrome
 * (interaction-design: a conversation is already the simplest interface): a title with the
 * workspace it belongs to, "new conversation" once there is one to leave, close — then the
 * conversation, and the composer.
 *
 * The list is a log: what is added to it is read out, politely, as it arrives.
 */
export function Conversation({
  Title = 'h2',
  onClose,
}: {
  /** The heading element: the sheet's is its dialog title, which names the dialog. */
  Title?: ComponentType<{ className: string; children: ReactNode }> | 'h2';
  onClose: () => void;
}) {
  const t = useTranslations('assistant');
  const { audience, conversation } = useAssistant();
  const { state, workspace, running, canRetry, load, send, retry, stop, startNew } = conversation;
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows — instantly, so there is no motion to reduce.
  useEffect(() => {
    const el = scroller.current!;
    el.scrollTop = el.scrollHeight;
  }, [state.messages, state.turn]);

  const started = state.messages.length > 0 || state.turn !== null;
  // A Personal workspace has no name of its own (`WorkspaceView`).
  const place = workspace === null ? null : (workspace.name ?? t('workspace.personal'));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1 py-2">
          <Title className="truncate text-base font-semibold">
            {state.session?.title ?? t('untitled')}
          </Title>
          {place !== null && <p className="truncate text-sm text-text-muted">{place}</p>}
        </div>
        {started && (
          <Button variant="ghost" size="icon" onClick={startNew} aria-label={t('new')}>
            <SquarePen aria-hidden />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('close')}>
          <X aria-hidden />
        </Button>
      </header>

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
            <Button variant="outline" onClick={() => void load()} className="self-start">
              <RotateCcw aria-hidden />
              {t('turn.retry')}
            </Button>
          </div>
        )}

        {state.status === 'ready' && !started && (
          <EmptyConversation audience={audience} onAsk={(q) => void send(q)} />
        )}

        {state.status === 'ready' && started && (
          <div className="grid gap-6">
            <ol role="log" aria-label={t('label')} className="grid gap-6">
              {state.messages.map((m) => (
                <li key={m.id}>
                  <MessageItem message={m} />
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
