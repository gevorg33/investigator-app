import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

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
