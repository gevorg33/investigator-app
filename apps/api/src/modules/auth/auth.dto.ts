import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * whitelist + forbidNonWhitelisted are on globally (main.ts), so a client cannot
 * set a field we did not declare here — mass-assignment protection.
 */
export class CredentialsDto {
  @IsEmail({}, { message: 'error.validation.email.invalid' })
  @MaxLength(254) // RFC 5321 maximum
  email!: string;

  @IsString()
  // 12 is above the common 8 because argon2id cost cannot rescue a short password.
  @MinLength(12, { message: 'error.validation.password.too_short' })
  // Bounded: an unbounded password is a denial-of-service against a memory-hard hash.
  @MaxLength(200, { message: 'error.validation.password.too_long' })
  password!: string;
}
