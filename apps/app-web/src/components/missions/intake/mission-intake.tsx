'use client';

import { ArrowLeft, CircleAlert, MessageSquareWarning } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import type { LooseT } from '@/components/form/errors';
import { FormError } from '@/components/form/form-error';
import type { CategoryOption } from '@/components/missions/filter-sheet';
import { Alert, AlertContent, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { ApiError, callApi } from '@/lib/api/browser';
import type { FieldIssue } from '@/lib/api/errors';
import type { MissionFields, OwnMission } from '@/lib/api/types';
import type { CodeOption } from '@/lib/codes';
import { Brief } from './brief';
import {
  BudgetQuestion,
  budgetInverted,
  KindQuestion,
  LanguagesQuestion,
  NeedQuestion,
  timelineInverted,
  WhenQuestion,
  WhereQuestion,
  WhoQuestion,
  WhyQuestion,
  type QuestionProps,
} from './questions';
import { missing, POLICY_HREF, resumeAt, STEPS, stepOf, type Step } from './steps';
import { useDraft } from './use-draft';

const BUDGET: readonly (keyof MissionFields)[] = ['currency', 'budgetMinMinor', 'budgetMaxMinor'];
const DATES: readonly (keyof MissionFields)[] = ['startBy', 'deadline'];

/** Where the intake stands, in the address, so a reload opens the same question. */
const place = (id: string | undefined, step: Step) =>
  window.history.replaceState(null, '', `/missions/${id ?? 'new'}?step=${step}`);

/**
 * Guided mission intake (T-119): plain questions, one per screen on a phone, that make the
 * structured brief a moderator reads and investigators quote on. The draft saves itself as the
 * customer goes; the last screen is the brief, the lawful-purpose confirmation — always the
 * customer's own tick — and sending it for review.
 *
 * A step with a required answer missing does not move on; it says what is missing, beside it. A
 * draft a moderator returned says so on every screen, with the moderator's note.
 */
export function MissionIntake({
  mission,
  categories,
  countries,
  languages,
  currencies,
  step: requested,
}: {
  mission: OwnMission | null;
  categories: readonly CategoryOption[];
  countries: readonly CodeOption[];
  languages: readonly CodeOption[];
  currencies: readonly string[];
  step?: Step | undefined;
}) {
  const t = useTranslations('missions.intake');
  const tb = useTranslations('missions.brief');
  const loose = useTranslations() as unknown as LooseT;
  const router = useRouter();
  const returned = mission?.review?.outcome === 'CHANGES_REQUESTED' ? mission.review : null;

  const stepRef = useRef<Step>('need');
  const draft = useDraft(mission, (created) => place(created.id, stepRef.current));
  const { fields, change, flush, latest } = draft;
  const [step, setStep] = useState<Step>(
    () => requested ?? (returned !== null ? 'review' : resumeAt(fields)),
  );
  stepRef.current = step;
  const [flagged, setFlagged] = useState<ReadonlySet<keyof MissionFields>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<ApiError | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const headingId = useId();
  const confirmId = useId();

  // A new question takes focus to its heading, so a screen reader starts reading it there.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  // An answer found missing on Continue takes focus, so the customer is taken to it.
  useEffect(() => {
    const first = body.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const target =
      first?.getAttribute('role') === 'radiogroup'
        ? first.querySelector<HTMLElement>('[role="radio"]')
        : first;
    target?.focus();
  }, [flagged]);

  const index = STEPS.indexOf(step);

  /**
   * An answer, kept at once and saved after the pause. A budget or a timeline that is inverted is
   * kept but not sent — the database refuses it — and goes, whole, once it is put right.
   */
  const edit = (patch: Partial<MissionFields>) => {
    const next = { ...fields, ...patch };
    if (budgetInverted(next)) return change(patch, BUDGET);
    if (timelineInverted(next)) return change(patch, DATES);
    const touches = (keys: readonly (keyof MissionFields)[]) => keys.some((k) => k in patch);
    const pair = (keys: readonly (keyof MissionFields)[]) =>
      touches(keys) ? Object.fromEntries(keys.map((k) => [k, next[k]])) : {};
    change({ ...patch, ...pair(BUDGET), ...pair(DATES) });
  };

  const go = async (to: Step) => {
    if (!(await flush())) return;
    moved.current = true;
    setFlagged(new Set());
    setStep(to);
    place(latest()?.id, to);
  };

  const onward = () => {
    const gaps = missing(step, fields);
    const inverted =
      (step === 'budget' && budgetInverted(fields)) ||
      (step === 'when' && timelineInverted(fields));
    if (gaps.length > 0 || inverted) {
      setFlagged(new Set(gaps));
      return;
    }
    void go(STEPS[index + 1]!);
  };

  const later = async () => {
    if (await flush()) router.push('/missions');
  };

  const gapsBySteps = new Set(STEPS.filter((s) => missing(s, fields).length > 0));

  const send = async () => {
    setTried(true);
    setSendError(null);
    if (gapsBySteps.size > 0 || !confirmed || sending) return;
    setSending(true);
    try {
      // Nothing can be waiting — every question saves before the brief opens — but a save still
      // under way finishes first, so the version sent is the one it returned.
      await flush();
      const m = latest()!;
      await callApi(`/missions/me/${m.id}/submit`, {
        body: { version: m.version, lawfulPurposeConfirmed: true },
      });
      router.push(`/missions/${m.id}`);
    } catch (e) {
      setSendError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    } finally {
      setSending(false);
    }
  };

  const common: QuestionProps = { fields, edit, flagged };
  const question: Record<Exclude<Step, 'review'>, ReactNode> = {
    need: <NeedQuestion {...common} />,
    kind: <KindQuestion {...common} categories={categories} />,
    where: <WhereQuestion {...common} countries={countries} />,
    when: <WhenQuestion {...common} />,
    budget: <BudgetQuestion {...common} currencies={currencies} />,
    languages: <LanguagesQuestion {...common} languages={languages} />,
    who: <WhoQuestion {...common} />,
    why: <WhyQuestion {...common} />,
  };

  const byCode = (list: readonly CodeOption[], code: string) =>
    list.find((o) => o.code === code)?.name ?? code;
  const names = {
    category: categories.find((c) => c.id === fields.taxonomyNodeId)?.label ?? null,
    country: fields.countryCode === null ? null : byCode(countries, fields.countryCode),
    languages: fields.languages.map((code) => byCode(languages, code)),
  };

  /** Field issues the API found on sending, each with the question that fixes it. */
  const issues: Array<FieldIssue & { step: Exclude<Step, 'review'> }> =
    sendError?.code === 'VALIDATION_FAILED'
      ? sendError.details.flatMap((d) => {
          const s = stepOf(d.field);
          return s === undefined ? [] : [{ ...d, step: s }];
        })
      : [];

  return (
    <div className="mt-4 grid gap-6">
      <div className="grid gap-2">
        <p className="text-sm text-text-muted">
          {t('progress', { step: index + 1, total: STEPS.length })}
        </p>
        <Progress value={((index + 1) / STEPS.length) * 100} aria-label={t('progress_label')} />
      </div>

      {returned !== null && (
        <Alert>
          <MessageSquareWarning aria-hidden />
          <AlertContent>
            <AlertTitle>{t('returned.title')}</AlertTitle>
            <p>{t('returned.body')}</p>
            {returned.reason !== null && (
              <blockquote className="mt-2 border-l-2 border-border-control pl-3 whitespace-pre-wrap">
                {returned.reason}
              </blockquote>
            )}
          </AlertContent>
        </Alert>
      )}

      <section aria-labelledby={headingId} className="grid gap-4">
        <div className="grid gap-1">
          <h2 ref={heading} id={headingId} tabIndex={-1} className="text-xl font-semibold">
            {t(`${step}.question`)}
          </h2>
          <p className="text-sm text-text-muted">{t(`${step}.hint`)}</p>
        </div>

        <div ref={body} className="grid gap-4">
          {step === 'review' ? (
            <>
              <Brief
                fields={fields}
                names={names}
                onEdit={(s) => void go(s)}
                gaps={tried ? gapsBySteps : new Set()}
              />
              {tried && gapsBySteps.size > 0 && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden />
                  <AlertContent>
                    <AlertTitle>{t('review.incomplete')}</AlertTitle>
                  </AlertContent>
                </Alert>
              )}
              <div className="grid gap-2">
                <label
                  htmlFor={confirmId}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-4 has-[[data-state=checked]]:border-primary"
                >
                  <Checkbox
                    id={confirmId}
                    className="mt-0.5"
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(v === true)}
                    aria-invalid={tried && !confirmed ? true : undefined}
                    aria-describedby={tried && !confirmed ? `${confirmId}-error` : undefined}
                  />
                  <span>{t('review.confirm')}</span>
                </label>
                <Link href={POLICY_HREF} className="min-h-11 text-sm text-primary underline">
                  {t('review.policy')}
                </Link>
                {tried && !confirmed && (
                  <p id={`${confirmId}-error`} className="text-sm text-danger">
                    {t('review.confirm_required')}
                  </p>
                )}
              </div>
              {issues.length > 0 ? (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden />
                  <AlertContent>
                    <AlertTitle>{t('review.refused')}</AlertTitle>
                    <ul className="mt-2 grid gap-2">
                      {issues.map((issue) => (
                        <li
                          key={`${issue.field}-${issue.code}`}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <span>
                            <span className="font-medium">{tb(`section.${issue.step}`)}</span>
                            {' — '}
                            {loose(
                              loose.has(issue.messageKey)
                                ? issue.messageKey
                                : 'error.validation.mission.required',
                            )}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void go(issue.step)}
                          >
                            {tb('change', { section: tb(`section.${issue.step}`) })}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </AlertContent>
                </Alert>
              ) : (
                <FormError
                  error={sendError}
                  overrides={{ STATE_CONFLICT: 'missions.intake.conflict' }}
                />
              )}
            </>
          ) : (
            question[step]
          )}
        </div>
      </section>

      <div className="grid gap-3">
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-text-muted">
          {draft.state === 'saving' ? t('saving') : draft.state === 'saved' ? t('saved') : ''}
        </p>
        <FormError
          error={draft.state === 'failed' ? draft.error : null}
          overrides={{ STATE_CONFLICT: 'missions.intake.conflict' }}
        />
        <div className="flex gap-3">
          {index > 0 && (
            <Button type="button" variant="outline" onClick={() => void go(STEPS[index - 1]!)}>
              <ArrowLeft aria-hidden />
              {t('back')}
            </Button>
          )}
          {step === 'review' ? (
            <Button type="button" className="flex-1" disabled={sending} onClick={() => void send()}>
              {t('review.send')}
            </Button>
          ) : (
            <Button type="button" className="flex-1" onClick={onward}>
              {t('next')}
            </Button>
          )}
        </div>
        <Button type="button" variant="ghost" onClick={() => void later()}>
          {t('later')}
        </Button>
      </div>
    </div>
  );
}
