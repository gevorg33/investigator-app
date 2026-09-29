import { Injectable, Logger } from '@nestjs/common';

export const MAILER = Symbol('MAILER');

/** Every email the platform sends, by the copy it uses (`email.<template>` in the catalogs). */
export const MAIL_TEMPLATES = [
  'email_verification',
  'password_reset',
  'workspace_invitation',
  // Notifications (T-036): about the recipient's own missions and assignments, never their content.
  'mission_published',
  'mission_returned',
  'mission_rejected',
  'assignment_new',
  'assignment_accepted',
  'assignment_declined',
  'assignment_report_ready',
] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

export interface MailMessage {
  to: string;
  /** Template identifier, not a subject line — copy is translated at the transport. */
  template: MailTemplate;
  /** Substitutions. Carries the one-time link; never persisted, never audited. */
  variables: Record<string, string>;
  /** The recipient's language (`users.locale`) — never the sender's. English when unknown. */
  locale?: string | undefined;
  /**
   * Sends with the same key are one email at the provider (T-036): a job retried after the send
   * succeeded but before its record committed does not mail twice.
   */
  idempotencyKey?: string | undefined;
  /**
   * For mail a person may stop (notifications): the one-click link, shown in the footer and sent
   * as `List-Unsubscribe`. Absent for transactional mail, which the account itself requires.
   */
  unsubscribeUrl?: string | undefined;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development transport. Writes the link to the log so local flows are completable
 * without a provider — ACTIONS-FOR-ME #5 is unresolved, so there is no real one yet.
 *
 * It refuses to run under NODE_ENV=production. A silent no-op there would mean
 * password resets that appear to succeed and never arrive; logging there would put
 * live reset links into log storage. Neither is acceptable, so it fails at
 * construction instead and the absence of a provider is a boot failure.
 */
@Injectable()
export class LogMailer implements Mailer {
  private readonly logger = new Logger(LogMailer.name);

  constructor() {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'LogMailer must not run in production: it would write one-time links to the log. ' +
          'Configure a real transport (ACTIONS-FOR-ME #5).',
      );
    }
  }

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      `[dev mail] ${message.template} -> ${message.to} :: ${JSON.stringify(message.variables)}`,
    );
  }
}
