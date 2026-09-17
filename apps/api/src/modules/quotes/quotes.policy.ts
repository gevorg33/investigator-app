/** Field limits, mirrored by CHECK constraints in migration 0009. */
export const SCOPE_MAX = 5000;
export const DELIVERABLES_MAX = 2000;
export const ASSUMPTIONS_MAX = 2000;
export const EXCLUSIONS_MAX = 2000;
export const CANCELLATION_TERMS_MAX = 2000;

/** Comfortably inside a 32-bit integer, so a price can never overflow the column. */
export const PRICE_MAX_MINOR = 2_000_000_000;

/** An estimate the investigator makes for this scope. A year is already implausible. */
export const MAX_ESTIMATED_DURATION_DAYS = 365;

/**
 * How long a quote may stay open.
 *
 * "Long enough for the customer to decide, short enough that you are not held to a price and a
 * timeframe you can no longer meet" (`kb-investigator-quoting`). The investigator picks inside
 * this range; the platform refuses an expiry that is already past or absurdly far out.
 *
 * **Provisional** — engineering bounds, not a product decision.
 */
export const MIN_EXPIRY_MINUTES = 60;
export const MAX_EXPIRY_DAYS = 90;

/**
 * How long an investigator has to accept an assignment once payment is authorized.
 *
 * "You have a window to accept the assignment. Failing to accept it releases the customer and
 * counts against your response record." No document sets the length. **Provisional.**
 */
export const ACCEPTANCE_WINDOW_HOURS = 48;

/** A quote is live only while it is SUBMITTED and its expiry has not passed. */
export const isExpired = (expiresAt: Date, now: Date = new Date()): boolean =>
  expiresAt.getTime() <= now.getTime();

/** The instant an assignment's acceptance window closes, from when payment was authorized. */
export const acceptanceDeadline = (authorizedAt: Date): Date =>
  new Date(authorizedAt.getTime() + ACCEPTANCE_WINDOW_HOURS * 60 * 60 * 1000);
