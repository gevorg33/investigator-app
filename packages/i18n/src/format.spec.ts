import { describe, expect, it } from 'vitest';
import { formatDateTime, formatMoney, formatNumber, formatRelativeTime } from './format.js';

// A deadline at 18:30 UTC — 22:30 in Yerevan, the evening before in Los Angeles.
const AT = '2026-09-24T18:30:00Z';

/** Intl groups digits with non-breaking spaces; compare what a reader sees. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('locale formatting', () => {
  it('formats in the reader’s time zone, which is never defaulted', () => {
    expect(plain(formatDateTime(AT, { locale: 'en', timeZone: 'Asia/Yerevan' }))).toBe(
      'Sep 24, 2026, 10:30 PM',
    );
    expect(plain(formatDateTime(AT, { locale: 'ru', timeZone: 'Asia/Yerevan' }))).toBe(
      '24 сент. 2026 г., 22:30',
    );
    expect(
      formatDateTime(AT, { locale: 'en', timeZone: 'America/Los_Angeles', style: 'date' }),
    ).toBe('Sep 24, 2026');
    expect(
      formatDateTime(new Date(AT), { locale: 'hy', timeZone: 'Asia/Yerevan', style: 'time' }),
    ).toBe('22:30');
  });

  it('formats money from minor units, with the currency’s own digits', () => {
    expect(plain(formatMoney(15_000_000, 'AMD', 'hy'))).toBe('150 000,00 ֏');
    expect(formatMoney(123_450, 'USD', 'en')).toBe('$1,234.50');
    expect(plain(formatMoney(123_450, 'USD', 'ru'))).toBe('1 234,50 $');
    // No minor unit: 5000 minor units of yen are 5000 yen.
    expect(formatMoney(5000, 'JPY', 'en')).toBe('¥5,000');
  });

  it('formats numbers in the reader’s grouping', () => {
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5');
    expect(plain(formatNumber(1234567.5, 'ru'))).toBe('1 234 567,5');
    expect(formatNumber(0.25, 'en', { style: 'percent' })).toBe('25%');
  });

  it('says how long ago, or how long until, in words the language uses', () => {
    const now = new Date(AT);
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    expect(formatRelativeTime(ago(30), now, 'en')).toBe('30 seconds ago');
    expect(formatRelativeTime(ago(5 * 60), now, 'en')).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(3 * 3600), now, 'ru')).toBe('3 часа назад');
    expect(formatRelativeTime(ago(24 * 3600), now, 'hy')).toBe('երեկ');
    expect(formatRelativeTime(ago(-2 * 24 * 3600), now, 'en')).toBe('in 2 days');
    expect(formatRelativeTime(ago(14 * 24 * 3600), now, 'en')).toBe('2 weeks ago');
    expect(formatRelativeTime(ago(60 * 24 * 3600), now, 'en')).toBe('2 months ago');
    expect(formatRelativeTime(ago(800 * 24 * 3600), now, 'en')).toBe('2 years ago');
    expect(formatRelativeTime(now.toISOString(), now, 'en')).toBe('now');
  });
});
