import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EmailField } from '../../common/validation/email';
import { IsTimeZone } from '../../common/validation/time-zone';
import { KNOWLEDGE_LOCALES, type KnowledgeLocale } from '../../database/schema';

/**
 * whitelist + forbidNonWhitelisted are on globally (main.ts), so a client cannot
 * set a field we did not declare here — mass-assignment protection.
 */
export class CredentialsDto {
  @EmailField()
  email!: string;

  @IsString()
  // 12 is above the common 8 because argon2id cost cannot rescue a short password.
  @MinLength(12, { message: 'error.validation.password.too_short' })
  // Bounded: an unbounded password is a denial-of-service against a memory-hard hash.
  @MaxLength(200, { message: 'error.validation.password.too_long' })
  password!: string;
}

/** Registering also accepts the documents registration requires (T-022). */
export class RegisterDto extends CredentialsDto {
  /**
   * The documents being accepted, by id — so the record says which exact version and locale was
   * shown (T-021). Empty is valid: with nothing published there is nothing to accept, and the
   * gate refuses only when something required is in force and missing from this list.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Length(36, 36, { each: true })
  acceptedDocumentIds?: string[];

  /**
   * The language the sign-up screen was shown in (T-127). Saved on the account, so the language
   * someone registered in is the one they get back at every sign-in. Absent: English.
   */
  @IsOptional()
  @IsIn(KNOWLEDGE_LOCALES)
  locale?: KnowledgeLocale;

  /** The browser's time zone, for dates shown to this person (T-127). Absent: UTC. */
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}

export class EmailOnlyDto {
  @EmailField()
  email!: string;
}

export class TokenDto {
  @IsString()
  // Bounded so an oversized body cannot be pushed through hashing.
  @MaxLength(256)
  token!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MaxLength(256)
  token!: string;

  @IsString()
  // Same policy as registration; a reset must not be a way to set a weaker password.
  @MinLength(12, { message: 'error.validation.password.too_short' })
  @MaxLength(200, { message: 'error.validation.password.too_long' })
  password!: string;
}
