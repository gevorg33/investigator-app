import { registerDecorator } from 'class-validator';

/**
 * An IANA time zone the runtime can format in — `Asia/Yerevan`, `UTC` — or false. Asking `Intl` to
 * use it is the test: it accepts every zone (and alias) the runtime knows and nothing else, so no
 * list is kept here to go stale.
 *
 * A fixed offset (`+04:00`) is refused although `Intl` formats it: an offset does not move with
 * daylight saving, so a deadline shown in one would be an hour out for half the year. Names start
 * with a letter; offsets do not.
 */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function IsTimeZone(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isTimeZone',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate: isTimeZone,
        defaultMessage: () => 'error.validation.timezone.invalid',
      },
    });
  };
}
