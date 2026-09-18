/**
 * Proof that money was authorized for an accepted quote, as the assignments module needs it.
 *
 * Deliberately small: a reference, an instant and the amount. Payment intents, webhook
 * signature verification, the ledger, fees, refunds, payouts and reconciliation belong to the
 * payments module (Phase 5). `payments-webhooks` forbids moving money without a ledger entry
 * and an audit event in the same transaction, and the owning agent for this task is told in so
 * many words not to touch Stripe, ledger, fee or payout logic.
 *
 * There is no `PaymentAuthorizer` port here, and that is the design rather than an omission.
 * Truth about payment arrives **from** the provider — "an assignment becomes paid because a
 * verified webhook said so" — so the payments module calls the assignments module with the
 * authorization in hand. Nothing in this module goes looking for one, which means there is no
 * code path that could invent a payment when no provider is configured.
 */
export interface PaymentAuthorization {
  /** The provider's reference for the authorization. Opaque here; payments owns its meaning. */
  reference: string;
  authorizedAt: Date;
  /** Minor units, and the currency it is denominated in. Checked against the quote. */
  amountMinor: number;
  currency: string;
}
