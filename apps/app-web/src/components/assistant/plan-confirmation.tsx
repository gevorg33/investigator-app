'use client';

import { formatDateTime, type Locale } from '@investigator/i18n';
import { Clock, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import type { Plan } from '@/lib/api/assistant';
import { cn } from '@/lib/utils';
import { isRunning, type PlanEntry } from './use-plans';

/** Below `md`, a plan longer than this shows its first steps and a way to the rest. */
const SHOWN = 3;

/** Past its time, on this device's clock: the API says EXPIRED to anyone who looks after it. */
function useExpired(plan: Plan): boolean {
  const at = Date.parse(plan.expiresAt);
  const [past, setPast] = useState(() => Date.now() >= at);
  useEffect(() => {
    if (past) return;
    const timer = setTimeout(() => setPast(true), at - Date.now());
    return () => clearTimeout(timer);
  }, [at, past]);
  return past || plan.confirmation === 'EXPIRED';
}

/**
 * A plan the assistant proposed, for the person to answer (T-058) — the last thing between a model's
 * proposal and a real change, so it says exactly what will run and asks plainly:
 *
 * - **Exactly what runs.** Each step's command and every argument as the API holds it, value for
 *   value — the same values the confirmation's hash covers — never a sentence about them.
 * - **Where it runs** — the workspace — and until when it waits.
 * - **What confirming means:** nothing happens until then; it runs as the person; what it does is not
 *   undone automatically.
 * - **Confirm and Decline side by side, the same size.** Neither is focused for the reader, and both
 *   are disabled from the first tap until the API answers, so nothing is sent twice.
 * - **What happens next** — running, step by step, or past its time — read from the plan's rows.
 *   How it ended is the conversation's outcome message, not this.
 *
 * Inline in the conversation: on a phone that is the assistant's full-screen sheet, which cannot be
 * swiped away (`assistant-panel`), never a sheet of its own a stray gesture could dismiss.
 */
export function PlanConfirmation({
  entry,
  workspace,
  onConfirm,
  onDecline,
}: {
  entry: PlanEntry;
  /** The workspace's name, as the header shows it; null until it is read. */
  workspace: string | null;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const t = useTranslations('assistant.plan');
  const locale = useLocale() as Locale;
  const titleId = useId();
  const { plan, acting, error } = entry;
  const expired = useExpired(plan);
  const running = isRunning(plan);
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, plan.steps.length - SHOWN);

  return (
    <Card
      role="group"
      aria-labelledby={titleId}
      // Reachable by a pointer to it (T-220), as a whole: focus lands on the plan, not on Confirm.
      data-plan-id={plan.id}
      tabIndex={-1}
      className="gap-3"
    >
      <CardHeader>
        <CardTitle id={titleId} className="text-base">
          {running ? t('title_running') : expired ? t('title_expired') : t('title')}
        </CardTitle>
        {workspace !== null && (
          <p className="text-sm text-text-muted">{t('workspace', { workspace })}</p>
        )}
      </CardHeader>

      <CardContent className="grid gap-3">
        <ol className="grid gap-3">
          {plan.steps.map((s, i) => {
            const args = Object.entries(s.arguments);
            return (
              <li
                key={s.ordinal}
                className={cn(
                  'grid gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0',
                  i >= SHOWN && hidden > 0 && 'max-md:hidden',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-sm text-text-muted">{t('step', { n: s.ordinal })}</span>
                  {running && (
                    <Badge variant={s.status === 'FAILED' ? 'warning' : 'outline'}>
                      {s.status === 'FAILED'
                        ? t('status.failed', { code: s.error })
                        : t(
                            `status.${s.status.toLowerCase() as 'pending' | 'running' | 'done' | 'skipped'}`,
                          )}
                    </Badge>
                  )}
                </div>
                <p className="font-mono font-medium break-all">{s.tool}</p>
                {args.length === 0 ? (
                  <p className="text-sm text-text-muted">{t('no_arguments')}</p>
                ) : (
                  <dl className="grid gap-1 text-sm">
                    {args.map(([key, value]) => (
                      <div key={key} className="flex min-w-0 flex-wrap gap-x-3">
                        <dt className="shrink-0 text-text-muted">{key}</dt>
                        <dd className="min-w-0 font-mono break-all">{JSON.stringify(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
        {hidden > 0 && (
          <Button
            variant="ghost"
            className="justify-self-start md:hidden"
            onClick={() => setAll(true)}
          >
            {t('more', { count: plan.steps.length })}
          </Button>
        )}
      </CardContent>

      <CardFooter className="grid gap-3">
        {running ? (
          <Marker role="status" className="text-text">
            <MarkerIcon>
              <LoaderCircle className="motion-safe:animate-spin" />
            </MarkerIcon>
            <MarkerContent>{t('running')}</MarkerContent>
          </Marker>
        ) : expired ? (
          <Marker role="status" className="items-start text-text">
            <MarkerIcon className="mt-0.5">
              <Clock />
            </MarkerIcon>
            <MarkerContent>{t('expired')}</MarkerContent>
          </Marker>
        ) : (
          <>
            <p className="text-sm text-text-muted">
              {t('waits', {
                time: formatDateTime(plan.expiresAt, {
                  locale,
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
              })}
            </p>
            <p className="text-sm">{t('consequence')}</p>
            <FormError error={error} />
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={onDecline}
                disabled={acting !== null}
                aria-busy={acting === 'decline'}
              >
                {t('decline')}
              </Button>
              <Button
                onClick={onConfirm}
                disabled={acting !== null}
                aria-busy={acting === 'confirm'}
              >
                {t('confirm')}
              </Button>
            </div>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
