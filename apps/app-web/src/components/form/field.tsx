import { useId, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';

/**
 * A labelled input with its hint and its error, wired for assistive technology: the label names
 * it, the hint and error describe it, and an error marks it invalid. The label sits above the
 * input, never inside it as a placeholder (responsive-design).
 */
export function Field({
  label,
  hint,
  error,
  ...input
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
} & ComponentProps<'input'>) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        {...input}
      />
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
