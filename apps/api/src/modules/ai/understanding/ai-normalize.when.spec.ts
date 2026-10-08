import { describe, expect, it } from 'vitest';
import { resolveWhen, zoneFor, type When } from './when';

/**
 * Wednesday 7 October 2026, 20:00 UTC — 16:00 that Wednesday in New York, 23:00 in Moscow, and
 * already 00:00 on Thursday the 8th in Yerevan: one moment, three different "tomorrow"s.
 */
const NOW = new Date('2026-10-07T20:00:00Z');
const YEREVAN = { user: 'Asia/Yerevan' };
const MOSCOW = { user: 'Europe/Moscow' };
const NEW_YORK = { user: 'America/New_York' };

const at = (iso: string, zone: string): When => ({ kind: 'instant', at: iso, zone });
const on = (date: string, zone: string): When => ({ kind: 'date', date, zone });
const question = (reason: Extract<When, { kind: 'question' }>['reason']): When => ({
  kind: 'question',
  reason,
});

describe('a relative time, resolved where it happens (T-220)', () => {
  describe('in English', () => {
    it.each([
      ['tomorrow at 3pm', NEW_YORK, at('2026-10-08T19:00:00.000Z', 'America/New_York')],
      ['today at 10:30 am', NEW_YORK, at('2026-10-07T14:30:00.000Z', 'America/New_York')],
      [
        'at 12am the day after tomorrow',
        NEW_YORK,
        at('2026-10-09T04:00:00.000Z', 'America/New_York'),
      ],
      ['at noon tomorrow — 12pm', NEW_YORK, at('2026-10-08T16:00:00.000Z', 'America/New_York')],
      ['tomorrow at 9', NEW_YORK, at('2026-10-08T13:00:00.000Z', 'America/New_York')],
      ['yesterday', NEW_YORK, on('2026-10-06', 'America/New_York')],
      ['in 30 minutes', NEW_YORK, at('2026-10-07T20:30:00.000Z', 'America/New_York')],
      ['in an hour', NEW_YORK, at('2026-10-07T21:00:00.000Z', 'America/New_York')],
      ['in 3 days', NEW_YORK, on('2026-10-10', 'America/New_York')],
      ['in 2 weeks at 17:45', NEW_YORK, at('2026-10-21T21:45:00.000Z', 'America/New_York')],
      ['next Monday', NEW_YORK, on('2026-10-12', 'America/New_York')],
      ['on Friday at 10:00', NEW_YORK, at('2026-10-09T14:00:00.000Z', 'America/New_York')],
      ['tomorrow 10:30', NEW_YORK, at('2026-10-08T14:30:00.000Z', 'America/New_York')],
      // A time with no day is today's.
      ['at 18:15', NEW_YORK, at('2026-10-07T22:15:00.000Z', 'America/New_York')],
    ])('%j', (expr, zones, expected) => {
      expect(resolveWhen(expr, { now: NOW, zones })).toEqual(expected);
    });
  });

  describe('in Russian', () => {
    it.each([
      ['завтра в 10', MOSCOW, at('2026-10-08T07:00:00.000Z', 'Europe/Moscow')],
      ['послезавтра', MOSCOW, on('2026-10-09', 'Europe/Moscow')],
      ['сегодня в 23:30', MOSCOW, at('2026-10-07T20:30:00.000Z', 'Europe/Moscow')],
      ['через 2 часа', MOSCOW, at('2026-10-07T22:00:00.000Z', 'Europe/Moscow')],
      ['через час', MOSCOW, at('2026-10-07T21:00:00.000Z', 'Europe/Moscow')],
      ['через 3 дня в 9:30', MOSCOW, at('2026-10-10T06:30:00.000Z', 'Europe/Moscow')],
      ['в пятницу в 10 вечера', MOSCOW, at('2026-10-09T19:00:00.000Z', 'Europe/Moscow')],
      ['в субботу в 9 утра', MOSCOW, at('2026-10-10T06:00:00.000Z', 'Europe/Moscow')],
      ['в 2 ночи послезавтра', MOSCOW, at('2026-10-08T23:00:00.000Z', 'Europe/Moscow')],
      ['через неделю', MOSCOW, on('2026-10-14', 'Europe/Moscow')],
      // Today is Wednesday in Moscow: the next one is a week away.
      ['в среду', MOSCOW, on('2026-10-14', 'Europe/Moscow')],
      ['вчера', MOSCOW, on('2026-10-06', 'Europe/Moscow')],
    ])('%j', (expr, zones, expected) => {
      expect(resolveWhen(expr, { now: NOW, zones })).toEqual(expected);
    });
  });

  describe('in Armenian', () => {
    it.each([
      ['վաղը ժամը 10-ին', YEREVAN, at('2026-10-09T06:00:00.000Z', 'Asia/Yerevan')],
      ['այսօր ժամը 18:30-ին', YEREVAN, at('2026-10-08T14:30:00.000Z', 'Asia/Yerevan')],
      ['վաղը չէ մյուս օրը', YEREVAN, on('2026-10-10', 'Asia/Yerevan')],
      ['երեկ', YEREVAN, on('2026-10-07', 'Asia/Yerevan')],
      ['2 ժամից', YEREVAN, at('2026-10-07T22:00:00.000Z', 'Asia/Yerevan')],
      ['3 օրից', YEREVAN, on('2026-10-11', 'Asia/Yerevan')],
      ['մեկ շաբաթից', YEREVAN, on('2026-10-15', 'Asia/Yerevan')],
      ['կիրակի', YEREVAN, on('2026-10-11', 'Asia/Yerevan')],
      // Armenian's Saturday is also its "week": alone, it is the day.
      ['շաբաթ ժամը 9-ին', YEREVAN, at('2026-10-10T05:00:00.000Z', 'Asia/Yerevan')],
      // Today is already Thursday in Yerevan: the next Thursday is a week away.
      ['հինգշաբթի', YEREVAN, on('2026-10-15', 'Asia/Yerevan')],
      ['ուրբաթ', YEREVAN, on('2026-10-09', 'Asia/Yerevan')],
    ])('%j', (expr, zones, expected) => {
      expect(resolveWhen(expr, { now: NOW, zones })).toEqual(expected);
    });
  });

  describe('across zones', () => {
    it('reads one phrase as a different moment, and a different day, where it happens', () => {
      const tomorrow = (zones: { user: string }) =>
        resolveWhen('tomorrow at 10:00', { now: NOW, zones });
      expect(tomorrow(NEW_YORK)).toEqual(at('2026-10-08T14:00:00.000Z', 'America/New_York'));
      // Already Thursday in Yerevan: tomorrow is Friday.
      expect(tomorrow(YEREVAN)).toEqual(at('2026-10-09T06:00:00.000Z', 'Asia/Yerevan'));
      expect(resolveWhen('on Thursday', { now: NOW, zones: NEW_YORK })).toEqual(
        on('2026-10-08', 'America/New_York'),
      );
      expect(resolveWhen('on Thursday', { now: NOW, zones: YEREVAN })).toEqual(
        on('2026-10-15', 'Asia/Yerevan'),
      );
    });

    it('reads it where the mission is, before the person’s own zone', () => {
      expect(
        resolveWhen('tomorrow at 10:00', {
          now: NOW,
          zones: { mission: 'Asia/Yerevan', user: 'America/New_York' },
        }),
      ).toEqual(at('2026-10-09T06:00:00.000Z', 'Asia/Yerevan'));
    });
  });

  describe('where the zone is not known', () => {
    it.each([
      ['no zone at all', {}],
      ['the UTC default nobody chose', { user: 'UTC' }],
      ['a zone nobody knows', { mission: 'Mars/Olympus_Mons', user: null }],
      ['an empty one', { mission: '', user: undefined }],
    ])('asks, given %s', (_what, zones) => {
      expect(resolveWhen('tomorrow at 10', { now: NOW, zones })).toEqual(question('zone_unknown'));
    });

    it('falls back from a zone nobody knows to the person’s', () => {
      expect(zoneFor({ mission: 'Mars/Olympus_Mons', user: 'Asia/Yerevan' })).toBe('Asia/Yerevan');
    });
  });

  describe('across a change of the clocks', () => {
    // 8 March 2026: New York's clocks go from 02:00 to 03:00. 1 November: from 02:00 back to 01:00.
    const spring = new Date('2026-03-07T17:00:00Z');
    const autumn = new Date('2026-10-31T17:00:00Z');

    it('asks about a time the change skips', () => {
      expect(resolveWhen('tomorrow at 2:30 am', { now: spring, zones: NEW_YORK })).toEqual(
        question('dst_gap'),
      );
    });

    it('asks about a time the change repeats', () => {
      expect(resolveWhen('tomorrow at 1:30 am', { now: autumn, zones: NEW_YORK })).toEqual(
        question('dst_overlap'),
      );
      // Berlin's clocks go back on 25 October: 02:30 happens twice.
      expect(
        resolveWhen('завтра в 2:30', {
          now: new Date('2026-10-24T10:00:00Z'),
          zones: { user: 'Europe/Berlin' },
        }),
      ).toEqual(question('dst_overlap'));
    });

    it('reads a time either side of the change in the offset that holds then', () => {
      expect(resolveWhen('tomorrow at 3:30 am', { now: spring, zones: NEW_YORK })).toEqual(
        at('2026-03-08T07:30:00.000Z', 'America/New_York'),
      );
      expect(resolveWhen('tomorrow at 1:30 am', { now: spring, zones: NEW_YORK })).toEqual(
        at('2026-03-08T06:30:00.000Z', 'America/New_York'),
      );
      expect(resolveWhen('tomorrow at 3:30 am', { now: autumn, zones: NEW_YORK })).toEqual(
        at('2026-11-01T08:30:00.000Z', 'America/New_York'),
      );
    });
  });

  describe('what it does not understand', () => {
    it.each([
      'sometime soon',
      'when you can',
      'at 25:00',
      'at 10:75',
      'tomorrow at 13pm',
      'завтра в 15 утра',
      'в 13 вечера',
      'in 3 fortnights',
      '',
    ])('asks about %j rather than guess', (expr) => {
      expect(resolveWhen(expr, { now: NOW, zones: NEW_YORK })).toEqual(question('not_understood'));
    });

    it('says it did not understand before asking for a zone', () => {
      expect(resolveWhen('whenever', { now: NOW, zones: {} })).toEqual(question('not_understood'));
    });
  });
});
