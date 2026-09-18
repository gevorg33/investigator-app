import { IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import {
  ASSUMPTIONS_MAX,
  CANCELLATION_TERMS_MAX,
  DELIVERABLES_MAX,
  EXCLUSIONS_MAX,
  MAX_ESTIMATED_DURATION_DAYS,
  PRICE_MAX_MINOR,
  SCOPE_MAX,
} from './quotes.policy';

/**
 * An offer for a mission.
 *
 * Every field here does work in a dispute — "the quote is the agreement; what is not in it was
 * not agreed" — which is why scope, deliverables and cancellation terms are required rather
 * than optional niceties.
 *
 * There are no fee or tax fields: the investigator's price is what their work is worth, and
 * platform fees are shown to the customer separately by the payments module (Phase 5).
 */
export class SubmitQuoteDto {
  /** Minor units. Money is an integer, never a float. */
  @IsInt()
  @Min(0)
  @Max(PRICE_MAX_MINOR)
  priceMinor!: number;

  /** ISO 4217. */
  @Matches(/^[A-Z]{3}$/, { message: 'error.validation.currency.invalid' })
  currency!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_ESTIMATED_DURATION_DAYS)
  estimatedDurationDays!: number;

  @IsString()
  @Length(1, SCOPE_MAX)
  scope!: string;

  @IsString()
  @Length(1, DELIVERABLES_MAX)
  deliverables!: string;

  @IsOptional()
  @IsString()
  @Length(1, ASSUMPTIONS_MAX)
  assumptions?: string;

  @IsOptional()
  @IsString()
  @Length(1, EXCLUSIONS_MAX)
  exclusions?: string;

  @IsString()
  @Length(1, CANCELLATION_TERMS_MAX)
  cancellationTerms!: string;

  /**
   * When the offer lapses. Bounded by the service: an expiry already in the past, or absurdly
   * far out, is refused. After it passes the quote cannot be accepted or reinstated.
   */
  @IsISO8601()
  expiresAt!: string;
}

/**
 * Accepting a quote carries no body fields.
 *
 * The idempotency key travels in the `Idempotency-Key` header, not here, and everything else
 * about the agreement is already in the quote. An empty, closed DTO means a client cannot
 * smuggle a price, a scope or a payment status into the acceptance.
 */
export class AcceptQuoteDto {}
