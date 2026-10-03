'use client';

import { formatDateTime, formatMoneyRange, type Locale } from '@investigator/i18n';
import { Fragment, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import type { MissionFields } from '@/lib/api/types';
import type { Named } from '@/lib/taxonomy';
import { cn } from '@/lib/utils';
import { PERSONAL, STEPS, type Step } from './steps';

/** What the brief names rather than codes: the category, the country, the languages and the tags. */
export interface BriefNames {
  category: Named | null;
  country: string | null;
  languages: string[];
  /** Tags' names (T-055), in the reader's language: the suggestions, unless `tagsPublished`. */
  tags: Named[];
  /** The tags are the ones the mission was published with, not the suggestions (T-194). */
  tagsPublished?: boolean;
}

/** A name in the language it is in, which is not always the page's (T-197). */
const named = (n: Named) => <span lang={n.lang}>{n.label}</span>;

const day = (date: string, locale: Locale) =>
  formatDateTime(date, { locale, timeZone: 'UTC', style: 'date' });

/**
 * The structured brief a customer's answers make (T-119): each question's answer under a plain
 * heading, in the order they were asked. On the last step of the intake every section has a
 * "Change" that goes back to its question, and a section still unanswered says so; on a sent
 * mission it is read-only. Names come from the server, so the page hydrates as it rendered.
 */
export function Brief({
  fields,
  names,
  onEdit,
  gaps = new Set(),
}: {
  fields: MissionFields;
  names: BriefNames;
  onEdit?: (step: Step) => void;
  /** Steps with an answer still missing, marked as such. */
  gaps?: ReadonlySet<Step>;
}) {
  const t = useTranslations('missions.brief');
  const locale = useLocale() as Locale;
  const f = fields;

  const answer: Record<Exclude<Step, 'review'>, ReactNode[]> = {
    need: [f.title, f.description].filter((v): v is string => v !== null),
    kind: [
      ...(names.category === null ? [] : [named(names.category)]),
      ...(names.tags.length === 0
        ? []
        : [
            t.rich(names.tagsPublished === true ? 'tags_published' : 'tags_suggested', {
              list: () =>
                names.tags.map((n, i) => (
                  <Fragment key={n.label}>
                    {i > 0 && ', '}
                    {named(n)}
                  </Fragment>
                )),
            }),
          ]),
    ],
    where: [names.country, f.locationLabel].filter((v): v is string => v !== null),
    when: [
      ...(f.deadline === null ? [] : [t('deadline', { date: day(f.deadline, locale) })]),
      ...(f.startBy === null ? [] : [t('start', { date: day(f.startBy, locale) })]),
    ],
    budget:
      f.currency === null || f.budgetMinMinor === null || f.budgetMaxMinor === null
        ? []
        : [formatMoneyRange(f.budgetMinMinor, f.budgetMaxMinor, f.currency, locale)],
    languages: names.languages.length === 0 ? [] : [names.languages.join(', ')],
    who: [
      ...(f.subjectRelationship === null ? [] : [t(`relationship.${f.subjectRelationship}`)]),
      ...(f.subjectRelationship !== null &&
      PERSONAL.has(f.subjectRelationship) &&
      f.protectiveOrderDeclared !== null
        ? [t(f.protectiveOrderDeclared ? 'protective_yes' : 'protective_no')]
        : []),
    ],
    why: f.purpose === null ? [] : [f.purpose],
  };

  return (
    <dl className="grid gap-4">
      {STEPS.filter((s): s is Exclude<Step, 'review'> => s !== 'review').map((step) => {
        const lines = answer[step];
        const gap = gaps.has(step);
        return (
          <div
            key={step}
            className={cn('grid gap-1 rounded-lg border border-border p-4', gap && 'border-danger')}
          >
            <div className="flex items-center justify-between gap-2">
              <dt className="font-medium">{t(`section.${step}`)}</dt>
              {onEdit !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onEdit(step)}
                  aria-label={t('change', { section: t(`section.${step}`) })}
                >
                  {t('change_short')}
                </Button>
              )}
            </div>
            {lines.length === 0 ? (
              <dd className={cn('text-text-muted', gap && 'text-danger')}>{t('not_answered')}</dd>
            ) : (
              lines.map((line, i) => (
                <dd
                  key={i}
                  className={cn('whitespace-pre-wrap', i === 0 && step === 'need' && 'font-medium')}
                >
                  {line}
                </dd>
              ))
            )}
          </div>
        );
      })}
    </dl>
  );
}
