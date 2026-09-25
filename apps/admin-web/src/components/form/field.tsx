import { useId, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';

/**
 * A labelled input: the label names it, above it, never inside it as a placeholder
 * (responsive-design). app-web's `Field`, less the hint and error the console has no use for yet.
 */
export function Field({ label, ...input }: { label: string } & ComponentProps<'input'>) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} {...input} />
    </div>
  );
}
