'use client';

import { Bot } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useAssistant, type AssistantAudience } from './assistant-provider';

/**
 * A conversation before its first question (interaction-design: the empty state teaches). It says
 * what the assistant can do today and what it cannot yet, and offers three questions it answers
 * for this reader — each sent with one tap.
 */
export function EmptyConversation({
  audience,
  onAsk,
}: {
  audience: AssistantAudience;
  onAsk: (question: string) => void;
}) {
  const t = useTranslations('assistant.empty');
  const { setOpen } = useAssistant();
  // Questions the help articles answer for this reader — each one a heading they contain.
  const questions = {
    CUSTOMER: [t('customer.mission'), t('customer.quote'), t('customer.evidence')],
    INVESTIGATOR: [t('investigator.start'), t('investigator.paid'), t('investigator.missions')],
    // No role yet: the public policies are all the API will answer from.
    NONE: [t('public.work'), t('public.training'), t('public.responsibilities')],
  }[audience];
  return (
    <Empty className="justify-start gap-4 p-4 md:p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Bot aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>{t('body')}</EmptyDescription>
        {audience === 'NONE' && (
          <EmptyDescription>
            {t('no_role')}{' '}
            {/* Closed on the way, or the sheet would cover the page it leads to. */}
            <Link href="/account#roles" onClick={() => setOpen(false)} className="underline">
              {t('no_role_link')}
            </Link>
          </EmptyDescription>
        )}
      </EmptyHeader>
      <section aria-labelledby="assistant-suggestions" className="grid w-full gap-2">
        <h3 id="assistant-suggestions" className="text-sm font-medium text-text-muted">
          {t('suggestions')}
        </h3>
        <ul className="grid gap-2">
          {questions.map((q) => (
            <li key={q}>
              <Button
                variant="outline"
                className="h-auto w-full justify-start text-left whitespace-normal"
                onClick={() => onAsk(q)}
              >
                {q}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </Empty>
  );
}
