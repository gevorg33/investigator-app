import 'reflect-metadata';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { describe, expect, it } from 'vitest';
import { addValidationBounds } from './validation-bounds';

const LIMIT = 42;

class ProbeBase {
  @IsEmail()
  @MaxLength(LIMIT)
  email!: string;
}

class ProbeBoundsDto extends ProbeBase {
  @IsInt()
  @Min(1)
  @Max(LIMIT)
  count!: number;

  @Length(2)
  atLeast!: string;

  @Length(2, 9)
  between!: string;

  @MinLength(3)
  short!: string;

  @IsIn(['a', 'b'])
  choice!: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @Matches(/^[a-z]{2}$/, { each: true })
  codes!: string[];

  @IsUUID(undefined, { each: true })
  loose!: string[];

  @IsOptional()
  @IsString()
  plain?: string;

  @Min(0)
  notInTheDocument!: number;
}

void ProbeBoundsDto;

/** Declared, never in any document: its constraints have nowhere to go. */
class ProbeUnusedDto {
  @Min(1)
  n!: number;
}
void ProbeUnusedDto;

const document = (): OpenAPIObject => ({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: {},
  components: {
    schemas: {
      ProbeBoundsDto: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          count: { type: 'number' },
          atLeast: { type: 'string' },
          between: { type: 'string' },
          short: { type: 'string' },
          choice: { type: 'string' },
          codes: { type: 'array', items: { type: 'string' } },
          loose: { type: 'array' },
          plain: { type: 'string' },
        },
      },
      NoProperties: { type: 'object' },
    },
  },
});

describe('the bounds written into the document (T-136)', () => {
  it('are the values the API validates against, inherited ones and constants included', () => {
    const props = (
      addValidationBounds(document()).components!.schemas!['ProbeBoundsDto'] as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    expect(props['email']).toEqual({ type: 'string', format: 'email', maxLength: 42 });
    expect(props['count']).toEqual({ type: 'integer', minimum: 1, maximum: 42 });
    expect(props['atLeast']).toEqual({ type: 'string', minLength: 2 });
    expect(props['between']).toEqual({ type: 'string', minLength: 2, maxLength: 9 });
    expect(props['short']).toEqual({ type: 'string', minLength: 3 });
    expect(props['choice']).toEqual({ type: 'string', enum: ['a', 'b'] });
    // The list's size on the list; each item's pattern on its items.
    expect(props['codes']).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: { type: 'string', pattern: '^[a-z]{2}$' },
    });
    // An array the document gives no items: the bound lands on the array rather than nowhere.
    expect(props['loose']).toEqual({ type: 'array', format: 'uuid' });
    expect(props['plain']).toEqual({ type: 'string' });
  });

  it('leaves a document with no schemas as it is', () => {
    const bare: OpenAPIObject = { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: {} };
    expect(addValidationBounds(bare)).toEqual(bare);
  });
});
