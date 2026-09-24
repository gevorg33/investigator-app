import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/test/request';
import { LanguageChoice } from './language-choice';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
const action = vi.hoisted(() => vi.fn());
vi.mock('@/app/(workspace)/account/actions', () => ({ chooseLocale: action }));

describe('choosing a language', () => {
  beforeEach(() => request.reset());

  it('offers every language by its own name, marks the one in use, and needs no JavaScript', async () => {
    request.cookies.set('locale', 'ru');
    render(await LanguageChoice());
    const section = screen.getByRole('region', { name: 'Язык' });
    const buttons = within(section).getAllByRole('button');
    expect(
      buttons.map((b) => [b.textContent, b.getAttribute('lang'), b.getAttribute('aria-pressed')]),
    ).toEqual([
      ['English', 'en', 'false'],
      ['Русский', 'ru', 'true'],
      ['Հայերեն', 'hy', 'false'],
    ]);
    // A plain form: each button submits its own value.
    for (const b of buttons) {
      expect(b).toHaveAttribute('type', 'submit');
      expect(b).toHaveAttribute('name', 'locale');
      expect(b.closest('form')).not.toBeNull();
    }
    // Pressed is marked by a check and weight as well as colour, and every button is a full target.
    expect(buttons[1]!.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(buttons[1]).toHaveClass('font-semibold', 'min-h-11');
    expect(buttons[0]!.querySelector('svg')).toBeNull();
  });

  it('follows the browser until the reader chooses', async () => {
    request.acceptLanguage = 'hy';
    render(await LanguageChoice());
    expect(screen.getByRole('button', { name: 'Հայերեն', pressed: true })).toBeInTheDocument();
    expect(screen.getByText(/Քանի դեռ չեք ընտրել/)).toBeInTheDocument();
  });
});
