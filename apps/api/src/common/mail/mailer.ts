import { Injectable, Logger } from '@nestjs/common';

export const MAILER = Symbol('MAILER');

export interface MailMessage {
  to: string;
  /** Template identifier, not a subject line — copy is translated at the transport. */
  template: 'email_verification' | 'password_reset';
  /** Substitutions. Carries the one-time link; never persisted, never audited. */
  variables: Record<string, string>;
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
