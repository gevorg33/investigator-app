import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { IsTimeZone, isTimeZone } from './time-zone';

class Probe {
  @IsTimeZone()
  zone!: unknown;
}

describe('time zones', () => {
  it.each(['Asia/Yerevan', 'Europe/Moscow', 'UTC', 'America/Los_Angeles', 'Europe/Kiev'])(
    'accepts %s',
    (zone) => {
      expect(isTimeZone(zone)).toBe(true);
    },
  );

  it.each([['Mars/Olympus_Mons'], [''], ['Asia/' + 'x'.repeat(70)], [42], [null], ['+04:00']])(
    'refuses %j',
    (zone) => {
      expect(isTimeZone(zone)).toBe(false);
    },
  );

  it('reports a translatable key when a DTO field is not one', () => {
    const [error] = validateSync(plainToInstance(Probe, { zone: 'Nowhere/Land' }));
    expect(error?.constraints).toEqual({ isTimeZone: 'error.validation.timezone.invalid' });
    expect(validateSync(plainToInstance(Probe, { zone: 'Asia/Yerevan' }))).toEqual([]);
  });
});
