'use client';

import { Check, Plus, X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Field } from '@/components/form/field';
import { minorDigits, toMinorAmount, toWhole } from '@/components/missions/browse-query';
import type { CategoryOption } from '@/components/missions/filter-sheet';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { NativeSelect } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { MissionFields, SubjectRelationship } from '@/lib/api/types';
import type { CodeOption } from '@/lib/codes';
import { cn } from '@/lib/utils';
import { PERSONAL, RELATIONSHIPS, today } from './steps';

/** What every question gets: the answers so far, a way to change them, and which to flag. */
export interface QuestionProps {
  fields: MissionFields;
  edit: (patch: Partial<MissionFields>) => void;
  /** Fields to mark as needing an answer — only after the customer tried to move on. */
  flagged: ReadonlySet<keyof MissionFields>;
}

/** Text as the API stores it: an emptied field is no answer, not an empty one. */
const text = (value: string): string | null => (value === '' ? null : value);

function Label({ id, children }: { id: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="text-sm font-medium">
      {children}
    </label>
  );
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm text-text-muted">
      {children}
    </p>
  );
}

function Problem({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm text-danger">
      {children}
    </p>
  );
}

/** A labelled textarea, wired like `Field`: hint and error describe it, an error marks it invalid. */
function LongText({
  label,
  hint,
  error,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  hint: string;
  error?: string | undefined;
  value: string | null;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  const id = useId();
  const described = [`${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="grid gap-1.5">
      <Label id={id}>{label}</Label>
      <Textarea
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={5}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
      />
      <Hint id={`${id}-hint`}>{hint}</Hint>
      {error && <Problem id={`${id}-error`}>{error}</Problem>}
    </div>
  );
}

/** A labelled select, wired like `Field`. */
function Select({
  label,
  error,
  value,
  onChange,
  placeholder,
  children,
}: {
  label: string;
  error?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label id={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <option value="">{placeholder}</option>
        {children}
      </NativeSelect>
      {error && <Problem id={`${id}-error`}>{error}</Problem>}
    </div>
  );
}

export function NeedQuestion({ fields, edit, flagged }: QuestionProps) {
  const t = useTranslations('missions.intake');
  return (
    <>
      <Field
        label={t('need.title')}
        hint={t('need.title_hint')}
        error={flagged.has('title') ? t('required') : undefined}
        value={fields.title ?? ''}
        onChange={(e) => edit({ title: text(e.target.value) })}
        maxLength={120}
      />
      <LongText
        label={t('need.description')}
        hint={t('need.description_hint')}
        error={flagged.has('description') ? t('required') : undefined}
        value={fields.description}
        onChange={(v) => edit({ description: text(v) })}
        maxLength={5000}
      />
    </>
  );
}

/**
 * The kind of help, from the shared taxonomy: a searchable list, because the tree is long and a
 * customer knows the words for what they need, not where it sits in a tree.
 */
export function KindQuestion({
  fields,
  edit,
  flagged,
  categories,
}: QuestionProps & { categories: readonly CategoryOption[] }) {
  const t = useTranslations('missions.intake');
  const chosen = fields.taxonomyNodeId;
  if (categories.length === 0) {
    return <p className="text-text-muted">{t('kind.unavailable')}</p>;
  }
  return (
    <div className="grid gap-1.5">
      <Command
        label={t('kind.search')}
        value={chosen ?? ''}
        filter={(value, search) => {
          const option = categories.find((c) => c.id === value);
          return option?.label.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
        }}
        className="rounded-lg border border-border-control"
      >
        <CommandInput placeholder={t('kind.search')} />
        <CommandList className="max-h-80">
          <CommandEmpty>{t('kind.none')}</CommandEmpty>
          {categories.map((c) => (
            <CommandItem
              key={c.id}
              value={c.id}
              onSelect={() => edit({ taxonomyNodeId: c.id })}
              aria-selected={chosen === c.id}
              className={cn(c.depth === 0 && 'font-medium')}
            >
              <Check
                aria-hidden
                className={cn('size-4', chosen === c.id ? 'opacity-100' : 'opacity-0')}
              />
              <span className={cn(c.depth === 1 && 'pl-4', c.depth >= 2 && 'pl-8')}>{c.label}</span>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
      {flagged.has('taxonomyNodeId') && <p className="text-sm text-danger">{t('kind.required')}</p>}
    </div>
  );
}

export function WhereQuestion({
  fields,
  edit,
  flagged,
  countries,
}: QuestionProps & { countries: readonly CodeOption[] }) {
  const t = useTranslations('missions.intake');
  return (
    <>
      <Select
        label={t('where.country')}
        placeholder={t('where.country_placeholder')}
        error={flagged.has('countryCode') ? t('required') : undefined}
        value={fields.countryCode ?? ''}
        onChange={(v) => edit({ countryCode: text(v) })}
      >
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </Select>
      <Field
        label={t('where.place')}
        hint={t('where.place_hint')}
        value={fields.locationLabel ?? ''}
        onChange={(e) => edit({ locationLabel: text(e.target.value) })}
        maxLength={120}
      />
    </>
  );
}

/** A start date after the finish date: said here, and never sent — the database refuses it. */
export const timelineInverted = (f: MissionFields): boolean =>
  f.startBy !== null && f.deadline !== null && f.startBy > f.deadline;

export function WhenQuestion({ fields, edit, flagged }: QuestionProps) {
  const t = useTranslations('missions.intake');
  const min = today();
  return (
    <>
      <Field
        label={t('when.deadline')}
        type="date"
        min={min}
        error={flagged.has('deadline') ? t('required') : undefined}
        value={fields.deadline ?? ''}
        onChange={(e) => edit({ deadline: text(e.target.value) })}
      />
      <Field
        label={t('when.start')}
        hint={t('when.start_hint')}
        type="date"
        min={min}
        error={timelineInverted(fields) ? t('when.order') : undefined}
        value={fields.startBy ?? ''}
        onChange={(e) => edit({ startBy: text(e.target.value) })}
      />
    </>
  );
}

/** A budget whose first amount is above its second: said here, and never sent. */
export const budgetInverted = (f: MissionFields): boolean =>
  f.budgetMinMinor !== null && f.budgetMaxMinor !== null && f.budgetMinMinor > f.budgetMaxMinor;

/**
 * The budget, in whole units of the chosen currency. The amounts are kept as typed — "250." is on
 * its way to "250.50" — and each becomes minor units, or no answer, as it changes.
 */
export function BudgetQuestion({
  fields,
  edit,
  flagged,
  currencies,
}: QuestionProps & { currencies: readonly string[] }) {
  const t = useTranslations('missions.intake');
  const currency = fields.currency ?? undefined;
  const shown = (minor: number | null) => (minor === null ? '' : toWhole(minor, currency));
  const [min, setMin] = useState(() => shown(fields.budgetMinMinor));
  const [max, setMax] = useState(() => shown(fields.budgetMaxMinor));
  const minor = (raw: string, cur: string | undefined) =>
    toMinorAmount(raw.trim() || undefined, cur) ?? null;
  const unreadable = (raw: string) => raw.trim() !== '' && minor(raw, currency) === null;
  const problem = (field: 'budgetMinMinor' | 'budgetMaxMinor', raw: string) =>
    unreadable(raw) ? t('budget.amount') : flagged.has(field) ? t('required') : undefined;

  return (
    <>
      <Select
        label={t('budget.currency')}
        placeholder={t('budget.currency_placeholder')}
        error={flagged.has('currency') ? t('required') : undefined}
        value={fields.currency ?? ''}
        onChange={(v) => {
          const cur = text(v);
          // The same typed amounts mean different minor units in another currency.
          edit({
            currency: cur,
            budgetMinMinor: minor(min, cur ?? undefined),
            budgetMaxMinor: minor(max, cur ?? undefined),
          });
        }}
      >
        {currencies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t('budget.min')}
          inputMode={minorDigits(currency) === 0 ? 'numeric' : 'decimal'}
          error={problem('budgetMinMinor', min)}
          value={min}
          onChange={(e) => {
            setMin(e.target.value);
            edit({ budgetMinMinor: minor(e.target.value, currency) });
          }}
        />
        <Field
          label={t('budget.max')}
          inputMode={minorDigits(currency) === 0 ? 'numeric' : 'decimal'}
          error={problem('budgetMaxMinor', max)}
          value={max}
          onChange={(e) => {
            setMax(e.target.value);
            edit({ budgetMaxMinor: minor(e.target.value, currency) });
          }}
        />
      </div>
      {budgetInverted(fields) && <p className="text-sm text-danger">{t('budget.order')}</p>}
      <p className="text-sm text-text-muted">{t('budget.note')}</p>
    </>
  );
}

/**
 * The languages the work needs. Starts with the reader's own, since they will talk to whoever they
 * hire — shown, saved, and removable like any other.
 */
export function LanguagesQuestion({
  fields,
  edit,
  flagged,
  languages,
}: QuestionProps & { languages: readonly CodeOption[] }) {
  const t = useTranslations('missions.intake');
  const locale = useLocale();
  const names = new Map(languages.map((l) => [l.code, l.name]));
  const chosen = fields.languages;
  const [adding, setAdding] = useState('');
  const own = locale.slice(0, 2);

  useEffect(() => {
    if (chosen.length === 0 && names.has(own)) edit({ languages: [own] });
    // Once, on arriving at the question — not again after the customer removes it.
  }, []);

  return (
    <>
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('languages.chosen')}>
          {chosen.map((code) => (
            <li
              key={code}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-primary bg-primary-subtle pl-4 text-sm font-semibold text-primary"
            >
              {names.get(code) ?? code}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label={t('languages.remove', { name: names.get(code) ?? code })}
                onClick={() => edit({ languages: chosen.filter((c) => c !== code) })}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select
            label={t('languages.add')}
            placeholder={t('languages.add_placeholder')}
            error={flagged.has('languages') ? t('languages.required') : undefined}
            value={adding}
            onChange={setAdding}
          >
            {languages
              .filter((l) => !chosen.includes(l.code))
              .map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={adding === '' || chosen.length >= 10}
          onClick={() => {
            edit({ languages: [...chosen, adding] });
            setAdding('');
          }}
        >
          <Plus aria-hidden />
          {t('languages.add_button')}
        </Button>
      </div>
    </>
  );
}

/** One choice of a radio group, as a row the thumb can hit. */
function Choice({ value, label }: { value: string; label: string }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-subtle"
    >
      <RadioGroupItem id={id} value={value} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Who the work concerns, to the customer — standing decides what can lawfully be done — and, where
 * the relationship is personal, whether a protective order stands between them.
 */
export function WhoQuestion({ fields, edit, flagged }: QuestionProps) {
  const t = useTranslations('missions');
  const personal = fields.subjectRelationship !== null && PERSONAL.has(fields.subjectRelationship);
  const who = useId();
  const order = useId();
  return (
    <>
      <div className="grid gap-2">
        <p id={who} className="text-sm font-medium">
          {t('intake.who.relationship')}
        </p>
        <RadioGroup
          aria-labelledby={who}
          aria-invalid={flagged.has('subjectRelationship') ? true : undefined}
          value={fields.subjectRelationship ?? ''}
          onValueChange={(v) => edit({ subjectRelationship: v as SubjectRelationship })}
        >
          {RELATIONSHIPS.map((r) => (
            <Choice key={r} value={r} label={t(`brief.relationship.${r}`)} />
          ))}
        </RadioGroup>
        {flagged.has('subjectRelationship') && (
          <p className="text-sm text-danger">{t('intake.required')}</p>
        )}
      </div>
      {personal && (
        <div className="grid gap-2">
          <p id={order} className="text-sm font-medium">
            {t('intake.who.protective')}
          </p>
          <p className="text-sm text-text-muted">{t('intake.who.protective_hint')}</p>
          <RadioGroup
            aria-labelledby={order}
            aria-invalid={flagged.has('protectiveOrderDeclared') ? true : undefined}
            value={
              fields.protectiveOrderDeclared === null
                ? ''
                : fields.protectiveOrderDeclared
                  ? 'yes'
                  : 'no'
            }
            onValueChange={(v) => edit({ protectiveOrderDeclared: v === 'yes' })}
          >
            <Choice value="yes" label={t('intake.who.yes')} />
            <Choice value="no" label={t('intake.who.no')} />
          </RadioGroup>
          {flagged.has('protectiveOrderDeclared') && (
            <p className="text-sm text-danger">{t('intake.required')}</p>
          )}
        </div>
      )}
    </>
  );
}

export function WhyQuestion({ fields, edit, flagged }: QuestionProps) {
  const t = useTranslations('missions.intake');
  return (
    <LongText
      label={t('why.purpose')}
      hint={t('why.purpose_hint')}
      error={flagged.has('purpose') ? t('required') : undefined}
      value={fields.purpose}
      onChange={(v) => edit({ purpose: text(v) })}
      maxLength={2000}
    />
  );
}
