import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { EmailField } from '../../common/validation/email';
import { IsTimeZone } from '../../common/validation/time-zone';

/**
 * What a client may say when creating an agency (T-083).
 *
 * What it may **not** say is as much of the point: no status, no verification state, no kind, no
 * workspace id. Those are the server's, and there is nowhere in this shape to put them — a
 * whitelisting pipe drops anything else before the service ever sees it.
 *
 * Everything but the name is optional, because onboarding is progressive: an agency exists from
 * the first step and becomes usable when the minimum is complete. Time zone and currency default
 * from the creator's account when they are not given.
 */
export class CreateAgencyDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'error.validation.country_code.invalid' })
  countryCode?: string;

  /** Where the platform writes to the business, which is not the creator's personal address. */
  @IsOptional()
  @IsEmail({}, { message: 'error.validation.email.invalid' })
  @Length(3, 254)
  businessEmail?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'error.validation.currency.invalid' })
  currency?: string;

  /**
   * The agency terms the creator is accepting, by id — so the record says which exact version and
   * locale they were shown (T-021), rather than the server deciding after the fact.
   */
  @IsString()
  @Length(36, 36)
  agreementDocumentId!: string;
}

/**
 * Optional, but not nullable. `IsOptional` skips validation for `null` too, and a `null` here would
 * clear one of the five — which an ACTIVE agency's constraint refuses as a 500. Only an absent
 * field is skipped; `null` is validated, and refused.
 */
const Present = () => ValidateIf((_, value: unknown) => value !== undefined);

/**
 * Completing or changing an agency's core details (T-150). Absent is left alone; there is no
 * clearing — each of the five is part of the minimum an agency needs, and an ACTIVE agency must keep
 * all of them. `version` is the one read, so two owners editing at once cannot overwrite each other.
 */
export class UpdateAgencyDetailsDto {
  @IsInt()
  @Min(1)
  version!: number;

  @Present()
  @IsString()
  @Length(2, 120)
  name?: string;

  @Present()
  @Matches(/^[A-Z]{2}$/, { message: 'error.validation.country_code.invalid' })
  countryCode?: string;

  @Present()
  @EmailField()
  businessEmail?: string;

  @Present()
  @IsTimeZone()
  timezone?: string;

  @Present()
  @Matches(/^[A-Z]{3}$/, { message: 'error.validation.currency.invalid' })
  currency?: string;
}
