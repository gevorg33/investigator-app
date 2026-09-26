import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { EmailField } from '../../../common/validation/email';
import { IsTimeZone } from '../../../common/validation/time-zone';
import { KNOWLEDGE_LOCALES, type KnowledgeLocale } from '../../../database/schema';

/** Each refusal said as its own message (T-157), each key written out whole for the catalog check. */
const ROLE_UNKNOWN = 'error.validation.employees.role_unknown';
const TEXT_LENGTH = 'error.validation.employees.text_length';

/**
 * Inviting someone into the agency (T-085): their address, and the one role the membership starts
 * with — named by the catalog's key, which the service looks up; no role is named in this code.
 * Which workspace is the request's, never the body's.
 */
export class InviteEmployeeDto {
  @EmailField()
  email!: string;

  @IsString({ message: ROLE_UNKNOWN })
  @Length(1, 64, { message: ROLE_UNKNOWN })
  role!: string;
}

/** Accepting an invitation: the token from the email, and nothing else. */
export class AcceptInvitationDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

/**
 * An employee's own details in this workspace. Absent is left alone; null clears one — the locale
 * and time zone then follow the account's own. Name and email are the user's, and not here.
 */
export class UpdateEmployeeDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString({ message: TEXT_LENGTH })
  @Length(1, 120, { message: TEXT_LENGTH })
  jobTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString({ message: TEXT_LENGTH })
  @Length(1, 120, { message: TEXT_LENGTH })
  department?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(KNOWLEDGE_LOCALES, { message: 'error.validation.language_code.invalid' })
  locale?: KnowledgeLocale | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsTimeZone()
  timezone?: string | null;
}

/** The roles a member holds from now on — the whole set, by the catalog's keys. */
export class SetEmployeeRolesDto {
  @IsArray({ message: ROLE_UNKNOWN })
  @ArrayMinSize(1, { message: 'error.validation.employees.role_required' })
  @ArrayMaxSize(6, { message: ROLE_UNKNOWN })
  @IsString({ each: true, message: ROLE_UNKNOWN })
  @Length(1, 64, { each: true, message: ROLE_UNKNOWN })
  roles!: string[];
}
