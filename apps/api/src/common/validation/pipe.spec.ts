import { describe, expect, it } from 'vitest';
import { Type } from 'class-transformer';
import { IsString, Length, Matches, ValidateNested } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { EmailField } from './email';
import { fieldIssues, validationPipe } from './pipe';

class Address {
  @IsString()
  @Length(2, 80)
  city!: string;
}

class Profile {
  @IsString()
  @Matches(/\S/, { message: 'error.validation.display_name.blank' })
  displayName!: string;

  @EmailField()
  email!: string;

  @ValidateNested()
  @Type(() => Address)
  address!: Address;
}

/** What the pipe refuses, exactly as the client receives it (T-157). */
const refusal = async (value: unknown) => {
  try {
    await validationPipe().transform(value, { type: 'body', metatype: Profile });
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as { details: unknown }).details;
  }
  throw new Error('accepted');
};

const valid = { displayName: 'Ani', email: 'ani@example.test', address: { city: 'Yerevan' } };

describe('the validation pipe', () => {
  it('names the property a DTO’s own message is about, and passes the message on as the key', async () => {
    expect(await refusal({ ...valid, displayName: '   ' })).toEqual([
      { field: 'displayName', code: 'INVALID', messageKey: 'error.validation.display_name.blank' },
    ]);
  });

  it('gives an email field its own message, as the sign-up form expects', async () => {
    expect(await refusal({ ...valid, email: 'not an email' })).toEqual([
      { field: 'email', code: 'INVALID', messageKey: 'error.validation.email.invalid' },
    ]);
  });

  it('names the property and the generic key where the message is class-validator’s English', async () => {
    // "city must be longer than or equal to 2 characters" is not ours to show anyone.
    expect(await refusal({ ...valid, address: { city: 'Y' } })).toEqual([
      { field: 'address.city', code: 'INVALID', messageKey: 'error.common.validation_failed' },
    ]);
  });

  it('reports a field the DTO does not declare under its own name, not as `property`', async () => {
    expect(await refusal({ ...valid, status: 'DONE' })).toEqual([
      { field: 'status', code: 'NOT_ALLOWED', messageKey: 'error.common.validation_failed' },
    ]);
  });

  it('lists each refused property once, whatever number of its rules failed', async () => {
    const issues = (await refusal({ displayName: 3, address: { city: 'Yerevan' } })) as Array<{
      field: string;
    }>;
    expect(issues.map((i) => i.field)).toEqual(['displayName', 'email']);
  });

  it('keeps a message that only looks like a sentence out of messageKey', () => {
    expect(
      fieldIssues([
        { property: 'x', constraints: { isString: 'error. not a key' }, children: [] },
      ] as never),
    ).toEqual([{ field: 'x', code: 'INVALID', messageKey: 'error.common.validation_failed' }]);
  });

  it('lets a valid body through, transformed', async () => {
    const out = await validationPipe().transform(valid, { type: 'body', metatype: Profile });
    expect(out).toBeInstanceOf(Profile);
  });
});
