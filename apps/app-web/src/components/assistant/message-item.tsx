'use client';

import { BookOpen, Info, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import Link from 'next/link';
import { discoveryReply, knowledgeReply, type AiMessage } from '@/lib/api/assistant';
import { slug } from '@/lib/slug';
import { useAssistant } from './assistant-provider';
import { DiscoveryReply } from './discovery-reply';

/** A tool's arguments as name and value, whatever shape they came in. */
const entriesOf = (value: unknown): Array<[string, unknown]> =>
  typeof value === 'object' && value !== null ? Object.entries(value) : [];

/** The person's own words, on the right. */
export function Question({ text, children }: { text: string; children?: ReactNode }) {
  const t = useTranslations('assistant');
  return (
    <Message align="end">
      <MessageContent>
        <Bubble>
          <BubbleContent>
            <span className="sr-only">{t('speaker.you')}: </span>
            {text}
          </BubbleContent>
        </Bubble>
        {children}
      </MessageContent>
    </Message>
  );
}

/**
 * One stored message, by what it is (ai-session-context): the person's question, the assistant's
 * words with the sources it used, "not covered" as a state of its own, and a tool call or result
 * as a structured block — which tool, with what — never as a sentence about it.
 */
export function MessageItem({
  message,
  pending = false,
}: {
  message: AiMessage;
  /** The conversation's last word, with nothing running: a question in it can be answered. */
  pending?: boolean;
}) {
  const t = useTranslations('assistant');
  const { closeIfCovering } = useAssistant();

  if (message.kind !== 'TEXT') {
    // The database holds a tool event to its shape (`ai_messages_shape`): a tool name, always.
    const event = message.event!;
    const tool = String(event.tool);
    const args = message.kind === 'TOOL_CALL' ? entriesOf(event.arguments) : [];
    return (
      <div className="rounded-lg border border-border bg-surface px-3 py-2">
        <Marker>
          <MarkerIcon>
            <Wrench />
          </MarkerIcon>
          <MarkerContent>
            {message.kind === 'TOOL_CALL' ? t('tool.call', { tool }) : t('tool.result', { tool })}
          </MarkerContent>
        </Marker>
        {args.length > 0 && (
          <dl className="mt-2 grid gap-1 text-sm">
            {args.map(([key, value]) => (
              <div key={key} className="flex min-w-0 gap-3">
                <dt className="shrink-0 text-text-muted">{key}</dt>
                <dd className="min-w-0 font-mono break-all">{JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  // Words are what a TEXT message is (`ai_messages_shape`).
  if (message.role === 'USER') return <Question text={message.content!} />;

  if (message.role === 'SYSTEM') {
    return (
      <Marker>
        <MarkerContent>{message.content}</MarkerContent>
      </Marker>
    );
  }

  const discovery = discoveryReply(message);
  if (discovery !== null) {
    return (
      <Message>
        <MessageContent>
          <span className="sr-only">{t('speaker.assistant')}: </span>
          <DiscoveryReply answer={discovery} pending={pending} />
        </MessageContent>
      </Message>
    );
  }

  const reply = knowledgeReply(message);
  if (reply?.status === 'no_answer') {
    return (
      <Marker className="rounded-lg border border-border bg-surface px-3 py-2 text-text">
        <MarkerIcon>
          <Info />
        </MarkerIcon>
        <MarkerContent>
          <span className="sr-only">{t('speaker.assistant')}: </span>
          {t('reply.no_answer')}
        </MarkerContent>
      </Marker>
    );
  }

  return (
    <Message>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent>
            <span className="sr-only">{t('speaker.assistant')}: </span>
            {message.content}
          </BubbleContent>
        </Bubble>
        {/* An answer always cites what it used (T-017): an uncited one is "not covered". */}
        {reply !== null && (
          <MessageFooter className="flex-col items-start gap-1">
            <p className="flex items-center gap-2 font-medium">
              <BookOpen aria-hidden className="size-4" />
              {t('reply.sources')}
            </p>
            <ul className="grid gap-1">
              {reply.citations.map((c) => (
                <li key={`${c.locale}/${c.docKey}@${c.version}#${c.section}`}>
                  {/* The article, opened at the section the answer used. */}
                  <Link
                    href={`/help/${c.docKey}#${slug(c.section)}`}
                    onClick={closeIfCovering}
                    className="underline underline-offset-2 hover:text-text"
                  >
                    {c.title} · {c.section}
                  </Link>
                </li>
              ))}
            </ul>
            {reply.fallback && <p>{t('reply.fallback')}</p>}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}
