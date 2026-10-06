'use client';

import { Ban, CircleCheck, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import type { PlanOutcome } from '@/lib/api/assistant';

const LOOK: Record<PlanOutcome['outcome'], { icon: LucideIcon; tone: string }> = {
  completed: { icon: CircleCheck, tone: 'text-success' },
  partial: { icon: TriangleAlert, tone: 'text-danger' },
  failed: { icon: TriangleAlert, tone: 'text-danger' },
  not_run: { icon: Ban, tone: 'text-text-muted' },
  declined: { icon: Ban, tone: 'text-text-muted' },
};

/** Whether anything was attempted: only then is there a step worth listing. */
const ATTEMPTED = new Set<PlanOutcome['outcome']>(['completed', 'partial', 'failed']);

/**
 * The endings worth a sentence of their own. The rest say enough by their outcome and steps: a decline
 * is the person's own, and a refused step shows its code in the list.
 */
const REASONS = [
  'confirmation_stale',
  'hash_mismatch',
  'state_changed',
  'recheck',
  'account_refused',
  'role_revoked',
  'tool_unavailable',
  'member_left',
  'infrastructure_failed',
] as const;
type Reason = (typeof REASONS)[number];

/** Every re-check refusal reads the same to the person, whatever the check's own code. */
function reasonOf(reason: string | null): Reason | null {
  const key = reason?.startsWith('recheck_') === true ? 'recheck' : reason;
  return REASONS.find((r) => r === key) ?? null;
}

/**
 * How a plan ended (T-226), put into words by the reader's catalog from what the database wrote: the
 * outcome, why it did not run when there is a reason worth saying, and each step that was attempted —
 * done, failed with its code, never run, or started with its result unknown. A plan that stopped
 * part-way is never shown as done, and what it did is not undone for the person.
 */
export function PlanOutcomeNote({ outcome }: { outcome: PlanOutcome }) {
  const t = useTranslations('assistant.outcome');
  const { icon: Icon, tone } = LOOK[outcome.outcome];
  const reason = reasonOf(outcome.reason);

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <Marker className="items-start text-text">
        <MarkerIcon className={`mt-0.5 ${tone}`}>
          <Icon />
        </MarkerIcon>
        <MarkerContent>{t(outcome.outcome)}</MarkerContent>
      </Marker>
      {reason !== null && <p className="mt-1 text-sm text-text-muted">{t(`reason.${reason}`)}</p>}
      {ATTEMPTED.has(outcome.outcome) && (
        <ol aria-label={t('steps')} className="mt-2 grid gap-1 text-sm">
          {outcome.steps.map((s) => (
            <li key={s.ordinal} className="flex min-w-0 flex-wrap gap-x-3">
              <span className="min-w-0 font-mono break-all">{s.tool}</span>
              <span className="text-text-muted">
                {s.status === 'FAILED'
                  ? t('step.failed', { code: s.error })
                  : t(`step.${s.status.toLowerCase() as 'done' | 'skipped' | 'running'}`)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
