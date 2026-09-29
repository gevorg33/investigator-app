import type { Mailer, MailMessage } from './mailer';
import { renderEmail } from './email';

export const RESEND_URL = 'https://api.resend.com/emails';

/** Why a send failed, in our words: the provider's reply is not repeated, and never logged. */
export class MailDeliveryError extends Error {
  constructor(readonly status: number) {
    super(`mail provider answered ${status}`);
    this.name = 'MailDeliveryError';
  }
}

/**
 * Sending through Resend (T-036, ACTIONS-FOR-ME #5), from the transactional domain `mail.` —
 * never the apex (ADR-0002). Sends with an `Idempotency-Key` when the message has one, so a job
 * retried after a send that succeeded mails once; and with `List-Unsubscribe` and the one-click
 * `List-Unsubscribe-Post` (RFC 8058) when the mail can be stopped. A failure throws: the job that
 * asked retries it, and dead-letters it in the end.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly config: { apiKey: string; from: string; overrideTo?: string | undefined },
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const { subject, text, html } = await renderEmail(message);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.apiKey}`,
      'content-type': 'application/json',
      ...(message.idempotencyKey !== undefined && { 'idempotency-key': message.idempotencyKey }),
    };
    const res = await this.doFetch(RESEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: this.config.from,
        // In Resend's sandbox only the account's own address receives mail (REVIEW_REQUEST_EMAIL_OVERRIDE).
        to: [this.config.overrideTo ?? message.to],
        subject,
        text,
        html,
        ...(message.unsubscribeUrl !== undefined && {
          headers: {
            'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new MailDeliveryError(res.status);
  }
}

/** The configured transport, or null: without a key and a sender the development transport stays. */
export function resendFromEnv(env: Record<string, string | undefined>): ResendMailer | null {
  const apiKey = env['RESEND_API_KEY'];
  const from = env['MAIL_FROM_ADDRESS'];
  const overrideTo = env['REVIEW_REQUEST_EMAIL_OVERRIDE'] || undefined;
  return apiKey && from ? new ResendMailer({ apiKey, from, overrideTo }) : null;
}
