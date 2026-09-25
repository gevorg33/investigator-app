import { useId, type ComponentProps } from 'react';
import { NativeSelect } from '@/components/ui/native-select';

/**
 * `Field`, for a native select (T-092): the label names it, the hint and error describe it, and an
 * error marks it invalid. The label does not wrap the hint, so the name stays the label alone.
 */
export function SelectField({
  label,
  hint,
  error,
  children,
  ...select
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
} & ComponentProps<typeof NativeSelect>) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <NativeSelect
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        {...select}
      >
        {children}
      </NativeSelect>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
