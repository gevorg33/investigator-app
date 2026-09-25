'use client';

import { ArrowUp, Square } from 'lucide-react';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/** The API's shortest question (`AskTurnDto`): below it, Send would only earn a refusal. */
export const MIN_QUESTION = 3;
export const MAX_QUESTION = 2000;

export const COMPOSER_ID = 'assistant-composer';

/**
 * Where a question is written (T-056): as many lines as it needs, Enter to send and Shift+Enter
 * for a new line — and while an answer forms, the same place holds Stop. What was typed stays
 * until it is sent; a question that fails to send comes back as its own "try again", not lost.
 */
export function Composer({
  running,
  disabled = false,
  onSend,
  onStop,
}: {
  running: boolean;
  /** Nothing to send into yet: the conversation is still being read. */
  disabled?: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
}) {
  const t = useTranslations('assistant');
  const hint = useId();
  const [text, setText] = useState('');
  const ready = !running && !disabled && text.trim().length >= MIN_QUESTION;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready) return;
    onSend(text.trim());
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Not while an input method is composing: Enter there chooses a character.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-1">
      <label htmlFor={COMPOSER_ID} className="sr-only">
        {t('composer.label')}
      </label>
      <div className="flex items-end gap-2">
        <Textarea
          id={COMPOSER_ID}
          rows={1}
          enterKeyHint="send"
          value={text}
          maxLength={MAX_QUESTION}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('composer.placeholder')}
          aria-describedby={hint}
          className="max-h-40 min-h-11 flex-1 resize-none"
        />
        {running ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onStop}
            aria-label={t('composer.stop')}
          >
            <Square aria-hidden />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!ready} aria-label={t('composer.send')}>
            <ArrowUp aria-hidden />
          </Button>
        )}
      </div>
      {/* On a phone the keyboard has its own Send and no Shift, so the hint is for keyboards. */}
      <p id={hint} className="sr-only text-xs text-text-muted md:not-sr-only">
        {t('composer.hint')}
      </p>
    </form>
  );
}
