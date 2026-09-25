import { describe, expect, it } from 'vitest';
import {
  clock,
  countryName,
  labels,
  languageName,
  list,
  placeName,
  weekday,
  windowParts,
} from './discovery-format';

describe('saying discovery’s data in the reader’s language (T-059)', () => {
  it('names languages and countries — and falls back to the code for one it cannot name', () => {
    expect([languageName('hy', 'en'), languageName('hy', 'ru'), languageName('ru', 'hy')]).toEqual([
      'Armenian',
      'армянский',
      'ռուսերեն',
    ]);
    expect(countryName('AM', 'en')).toBe('Armenia');
    expect(languageName('qq', 'en')).toBe('qq');
  });

  it('says a place most specific first, with whatever parts it has', () => {
    expect(placeName({ city: 'Gyumri', region: 'Shirak', countryCode: 'AM' }, 'en')).toBe(
      'Gyumri, Shirak, Armenia',
    );
    expect(placeName({ city: 'Gyumri' }, 'en')).toBe('Gyumri');
    expect(placeName({ countryCode: 'GE' }, 'ru')).toBe('Грузия');
  });

  it('reads the week from Monday, and the end of the day as midnight', () => {
    expect([weekday(0, 'en'), weekday(6, 'en'), weekday(0, 'ru')]).toEqual([
      'Monday',
      'Sunday',
      'понедельник',
    ]);
    expect(clock(540, 'ru')).toBe('9:00');
    expect(clock(1440, 'ru')).toBe('0:00');
    expect(windowParts({ dayOfWeek: 2, startMinute: 600, endMinute: 690 }, 'ru')).toEqual({
      day: 'среда',
      from: '10:00',
      to: '11:30',
    });
  });

  it('joins lists the reader’s way, and leaves out a specialty with no name in this language', () => {
    expect(list(['fraud', 'audit', 'tracing'], 'en')).toBe('fraud, audit, and tracing');
    expect(list(['мошенничество', 'аудит'], 'ru')).toBe('мошенничество и аудит');
    expect(
      labels([
        { id: 'a', label: 'Fraud' },
        { id: 'b', label: null },
      ]),
    ).toEqual(['Fraud']);
  });
});
