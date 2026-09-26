import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { FieldIssue } from '../errors/app-error';

/** The generic key, for a constraint whose message is class-validator's own English. */
const GENERIC = 'error.common.validation_failed';

/**
 * A message that is a catalog key — `error.validation.display_name.blank` — rather than
 * class-validator's default English ("displayName must be a string"). Only a key reaches the
 * client as `messageKey`; the English never does (docs/api/errors.md, rule 2).
 */
const CATALOG_KEY = /^error\.[a-z0-9_]+(\.[a-z0-9_]+)+$/;

/**
 * Every refused property, once, named by its path — `address.city` for a nested one — with the
 * message its DTO wrote for it where there is one (T-157).
 *
 * The property comes from the validation error itself, never from the text of a message: a
 * message that is a key has no property name in it to find, which is how `displayName` once
 * reached the client as `field: "error.validation.display_name.blank"`.
 */
export function fieldIssues(errors: readonly ValidationError[], parent = ''): FieldIssue[] {
  return errors.flatMap((e) => {
    const field = parent === '' ? e.property : `${parent}.${e.property}`;
    const constraints = e.constraints ?? {};
    const own: FieldIssue[] = [];
    if (Object.keys(constraints).length > 0) {
      const keyed = Object.values(constraints).find((m) => CATALOG_KEY.test(m));
      own.push({
        field,
        // A field the DTO does not declare is refused by `forbidNonWhitelisted`, not invalid.
        code: 'whitelistValidation' in constraints ? 'NOT_ALLOWED' : 'INVALID',
        messageKey: keyed ?? GENERIC,
      });
    }
    return [...own, ...fieldIssues(e.children ?? [], field)];
  });
}

/**
 * The one validation pipe — `bootstrap.ts` installs it, and route specs install the same, so a
 * spec sees the answer a client gets.
 *
 * - `whitelist` + `forbidNonWhitelisted`: mass-assignment protection. A client can never set a
 *   field the DTO does not declare, and learns which one it tried (platform-security-review).
 * - `transform` without implicit conversion: a DTO is a class instance, and `"5"` is not `5`.
 * - A refusal is a 400 carrying `details`, which `AppExceptionFilter` passes on as they are.
 */
export function validationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => new BadRequestException({ details: fieldIssues(errors) }),
  });
}
