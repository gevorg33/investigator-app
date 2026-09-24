import { colors, type ColorRole, type Theme } from '@investigator/ui-tokens';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from './button';

describe('@shadcn/button, as adopted', () => {
  it('is a real button that acts on click', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Approve</Button>);
    const button = screen.getByRole('button', { name: 'Approve' });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('data-variant', 'default');
    expect(button).toHaveAttribute('data-size', 'default');
    expect(button).toHaveClass('bg-primary', 'text-primary-foreground');
  });

  it('does not act while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Approve
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders as its child when asked, so a link keeps link semantics', () => {
    render(
      <Button asChild variant="link">
        <a href="/queue">Queue</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Queue' });
    expect(link).toHaveAttribute('href', '/queue');
    expect(link).toHaveClass('text-primary');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets a caller class win over a variant class', () => {
    render(<Button className="rounded-full">Round</Button>);
    const button = screen.getByRole('button', { name: 'Round' });
    expect(button).toHaveClass('rounded-full');
    expect(button).not.toHaveClass('rounded-md');
  });

  it.each(['default', 'lg', 'icon'] as const)(
    'keeps the %s size a 44px tap target or larger',
    (size) => {
      const classes = buttonVariants({ size }).split(' ');
      const height = classes.find((c) => /^(h|size)-\d+$/.test(c));
      expect(Number(height?.split('-')[1]) * 4).toBeGreaterThanOrEqual(44);
    },
  );

  it.each(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const)(
    'draws the %s variant from tokens only, and leaves focus to the app outline',
    (variant) => {
      const classes = buttonVariants({ variant }).split(' ');
      const offending = classes.filter((c) =>
        /(^|:)(outline-none|ring-.*|text-white|text-black|shadow-xs)$|^dark:/.test(c),
      );
      expect(offending).toEqual([]);
      expect(classes).toContain('duration-(--duration-fast)');
    },
  );

  it('uses the control boundary for the outline variant, not the decorative border', () => {
    expect(buttonVariants({ variant: 'outline' })).toContain('border-input');
  });
});

// The filled variants darken on hover by showing 10% of the surface through (`/90`). That tint is
// not a role, so CONTRAST_PAIRS does not measure it; this does, so a token change that pushes it
// below AA fails here (T-014 measured 5.53:1 at the lowest).
describe('filled-button hover tints', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  it.each([
    ['light', 'primary', 'primary-contrast'],
    ['dark', 'primary', 'primary-contrast'],
    ['light', 'danger', 'danger-contrast'],
    ['dark', 'danger', 'danger-contrast'],
  ] as Array<[Theme, ColorRole, ColorRole]>)('%s %s keeps AA text contrast', (theme, bg, fg) => {
    const palette = colors[theme];
    const surface = rgb(palette.surface);
    const hover = rgb(palette[bg]).map((v, i) => Math.round(v * 0.9 + surface[i]! * 0.1));
    expect(ratio(rgb(palette[fg]), hover)).toBeGreaterThanOrEqual(4.5);
  });
});
