import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Characters that are invisible, change rendering direction, or are otherwise not
 * something a person can see in an address.
 *
 * `IsEmail` accepts several of these. That is how two accounts end up with addresses
 * that render identically — `staff@x.test` and `staff‍@x.test` are different byte
 * sequences, so citext uniqueness does not collapse them, and no human reading a
 * verification queue or a message header can tell them apart. On a platform where
 * knowing which investigator you are talking to is the product, that is impersonation.
 *
 * | | |
 * |---|---|
 * | `Cc` | control characters |
 * | `Cf` | format: zero-width joiner/non-joiner, bidi overrides, soft hyphen |
 * | `Cs` | lone surrogates |
 * | `Co` | private use, which renders as whatever the font decides |
 * | `Zl` `Zp` | line and paragraph separators |
 * | `Zs` | space separators, including non-breaking and ideographic space |
 *
 * Deliberately NOT a ban on non-ASCII. Internationalised addresses are legitimate and
 * this product ships in Armenian and Russian; the target is characters with no visible
 * form, not characters from another script.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}\p{Zs}]/u;

export function IsVisibleEmail(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isVisibleEmail',
      target: target.constructor,
      propertyName: String(propertyKey),
      // Spread rather than `options,`: under exactOptionalPropertyTypes an explicit
      // `undefined` is not the same as an absent key, and the option is optional.
      ...(options ? { options } : {}),
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && !INVISIBLE.test(value);
        },
      },
    });
  };
}

/**
 * An address field. Normalised to NFC first, because the same address typed on two
 * systems can arrive as different byte sequences for identical text — and two byte
 * sequences mean two accounts.
 */
export function EmailField(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.normalize('NFC').trim() : value,
    ),
    IsVisibleEmail({ message: 'error.validation.email.invalid' }),
    IsEmail({}, { message: 'error.validation.email.invalid' }),
    MaxLength(254), // RFC 5321 maximum
  );
}
