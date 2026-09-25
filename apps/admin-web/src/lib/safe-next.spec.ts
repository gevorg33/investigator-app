import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('where to go after signing in', () => {
  it.each([
    ['/missions', '/missions'],
    ['/account?tab=language#legal', '/account?tab=language#legal'],
    ['/', '/'],
  ])('keeps a page on this site: %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });

  it.each([
    ['//evil.example/phish'],
    ['/\\evil.example'],
    ['https://evil.example'],
    ['javascript:alert(1)'],
    ['/javascript:alert(1)'],
    ['missions'],
    [''],
    [null],
    [undefined],
  ])('sends anything else home: %j', (next) => {
    expect(safeNext(next)).toBe('/');
  });
});
