import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAmount, type Amount } from './amount';
import { screenCredentials } from './credentials';
import { normalizeText } from './normalize';
import { isAffirmation, MAX_LENGTH, routeMessage } from './routing';
import { resolveWhen } from './when';

const money = (minor: number, currency: string): Amount => ({ kind: 'amount', minor, currency });

describe('an amount with its currency (T-220)', () => {
  it.each([
    ['$1,500', money(150_000, 'USD')],
    ['1500 dollars', money(150_000, 'USD')],
    ['USD 99.99', money(9_999, 'USD')],
    ['€20.50', money(2_050, 'EUR')],
    ['€1.234,56', money(123_456, 'EUR')],
    ['1,234.56 EUR', money(123_456, 'EUR')],
    ['5k usd', money(500_000, 'USD')],
    ['£12', money(1_200, 'GBP')],
    ['1 500 ₽', money(150_000, 'RUB')],
    ['20,50 евро', money(2_050, 'EUR')],
    ['2 тыс рублей', money(200_000, 'RUB')],
    ['1,5 млн руб.', money(150_000_000, 'RUB')],
    ['1.500.000 руб', money(150_000_000, 'RUB')],
    ['100 долларов', money(10_000, 'USD')],
    ['50000 դրամ', money(5_000_000, 'AMD')],
    ['֏ 25 000', money(2_500_000, 'AMD')],
    ['15 հազար դրամ', money(1_500_000, 'AMD')],
    ['200 դոլար', money(20_000, 'USD')],
    // A dot is the decimal point unless the number has two groups of three after one.
    ['1.500 USD', money(150, 'USD')],
  ])('%j', (text, expected) => {
    expect(parseAmount(text)).toEqual(expected);
  });

  it.each([
    ['a number with no currency', '1500', 'currency_unknown'],
    ['two currencies', '$100 or €90', 'not_understood'],
    ['no number', 'about fifty dollars', 'not_understood'],
    ['more decimals than the currency has', '$1.005', 'not_understood'],
    ['separators that read no one way', '1,23,4 USD', 'not_understood'],
    ['dots in no known shape', '1.2.3 USD', 'not_understood'],
    ['a number too large to hold', `${'9'.repeat(20)} USD`, 'not_understood'],
  ])('asks about %s', (_what, text, reason) => {
    expect(parseAmount(text)).toEqual({ kind: 'question', reason });
  });

  it('keeps trailing zeros a currency has room for', () => {
    expect(parseAmount('$1.50')).toEqual(money(150, 'USD'));
    // One and a half dollars: the extra zero is room the currency does not need.
    expect(parseAmount('$1.500')).toEqual(money(150, 'USD'));
  });
});

describe('text as the assistant reads it (T-220)', () => {
  it('composes one Unicode form, drops invisible characters, and keeps the words', () => {
    // "é" written as e + a combining accent becomes one character.
    expect(normalizeText('café')).toBe('café');
    expect(normalizeText('\u200Bhello\u200D \uFEFFworld\u0007')).toBe('hello world');
    expect(normalizeText('  one\t\u00A0two   three  ')).toBe('one two three');
    expect(normalizeText('line one \r\n  line two\r\n\r\n\r\n\nline three')).toBe(
      'line one\nline two\n\nline three',
    );
  });

  it('lets the screen find a key split by an invisible character', () => {
    const key = `sk-proj-${'A1b2C3d4'.repeat(4)}`;
    const split = `${key.slice(0, 10)}\u200B${key.slice(10)}`;
    expect(screenCredentials(split).found).toEqual([]);
    expect(screenCredentials(normalizeText(split)).found).toEqual(['api_key']);
  });
});

describe('structural routing (T-220)', () => {
  const PLAN = '00000000-0000-4000-8000-0000000000c1';

  it.each([
    'yes',
    'Yes!!',
    'yes please 👍',
    'OK.',
    'Confirm',
    'go ahead',
    'Подтверждаю.',
    'ага',
    'хорошо',
    'այո',
    'Հաստատում եմ',
    'համաձայն եմ',
  ])('points %j at the waiting plan, and confirms nothing', (text) => {
    expect(routeMessage(normalizeText(text), { waiting: PLAN, clarifies: false })).toEqual({
      route: 'confirm_pointer',
      planId: PLAN,
    });
  });

  it.each([
    ['a yes with nothing waiting', 'yes', { waiting: null, clarifies: false }],
    ['a yes answering discovery’s own question', 'yes', { waiting: PLAN, clarifies: true }],
    ['a yes with more to it', 'yes, but invite Davit too', { waiting: PLAN, clarifies: false }],
    [
      'a new request while a plan waits',
      'Who works in Gyumri?',
      { waiting: PLAN, clarifies: false },
    ],
  ])('sends %s on to be answered', (_what, text, state) => {
    expect(routeMessage(text, state)).toEqual({ route: 'ask' });
  });

  it('refuses what is empty once normalized, or too long', () => {
    expect(
      routeMessage(normalizeText('\u200B\u200B\u200B\u200B'), { waiting: null, clarifies: false }),
    ).toEqual({
      route: 'empty',
    });
    expect(routeMessage('a'.repeat(MAX_LENGTH + 1), { waiting: null, clarifies: false })).toEqual({
      route: 'too_long',
    });
    expect(routeMessage('a'.repeat(MAX_LENGTH), { waiting: null, clarifies: false })).toEqual({
      route: 'ask',
    });
  });

  it('counts characters, not code units', () => {
    // Three Armenian letters: "այո" is a whole message, not too short.
    expect(isAffirmation('այո')).toBe(true);
    expect(routeMessage('👍👍👍', { waiting: null, clarifies: false })).toEqual({ route: 'ask' });
  });
});

describe('no stage here returns an action (T-220)', () => {
  const CORPUS = [
    'yes',
    'Create a team called Field and invite ana@example.test',
    'Подтверждаю, удали миссию',
    'Հաստատում եմ, ջնջիր',
    'password: Hunter2!',
    'tomorrow at 10',
    '$1,500',
    '\u200B',
  ];
  const ACTION_KEYS = ['tool', 'command', 'action', 'arguments', 'steps', 'confirm', 'plan'];
  const keysOf = (value: unknown): string[] =>
    value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)])
      : [];

  it('gives back words, a route, a time or an amount — never something to run', () => {
    for (const text of CORPUS) {
      const outputs = [
        screenCredentials(text),
        normalizeText(text),
        resolveWhen(text, {
          now: new Date('2026-10-07T20:00:00Z'),
          zones: { user: 'Asia/Yerevan' },
        }),
        parseAmount(text),
        routeMessage(normalizeText(text), { waiting: 'p1', clarifies: false }),
      ];
      for (const output of outputs) {
        expect(
          keysOf(output).filter((k) => ACTION_KEYS.includes(k)),
          text,
        ).toEqual([]);
      }
    }
  });

  it('cannot reach a tool, a plan or a model: it imports none of them', () => {
    const dir = __dirname;
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    )) {
      const source = readFileSync(join(dir, file), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      expect(
        imports.filter((i) =>
          /tools|plans|chat-model|discovery|knowledge|database|sessions/.test(i),
        ),
        file,
      ).toEqual([]);
    }
  });
});
