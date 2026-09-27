import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('lets a later token class replace an earlier one of the same kind', () => {
    expect(cn('shadow-raised', 'shadow-overlay')).toBe('shadow-overlay');
    expect(cn('rounded-md', 'rounded-lg')).toBe('rounded-lg');
    expect(cn('text-text', 'text-text-muted')).toBe('text-text-muted');
    expect(cn('bg-surface', 'bg-surface-raised')).toBe('bg-surface-raised');
  });

  it('keeps a colour and a size apart, though both are text-*', () => {
    expect(cn('text-sm', 'text-text-muted')).toBe('text-sm text-text-muted');
  });

  it('knows what our own utilities set, so a later class of the same kind replaces them (T-166)', () => {
    const bottom = 'data-[vaul-drawer-direction=bottom]:';
    expect(cn(`${bottom}max-h-sheet`, `${bottom}max-h-dvh`)).toBe(`${bottom}max-h-dvh`);
    expect(cn('max-h-sheet', 'max-h-dvh')).toBe('max-h-dvh');
    expect(cn('pb-safe', 'pb-4')).toBe('pb-4');
    expect(cn('pb-bottom-nav', 'pb-0')).toBe('pb-0');
    // Still one property each: padding below is not height.
    expect(cn('max-h-sheet', 'pb-safe')).toBe('max-h-sheet pb-safe');
  });

  it('drops what is not wanted', () => {
    expect(cn('p-4', false, undefined, null, 'md:p-8')).toBe('p-4 md:p-8');
  });
});
