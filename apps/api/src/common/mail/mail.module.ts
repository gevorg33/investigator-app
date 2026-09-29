import { Global, Logger, Module } from '@nestjs/common';
import { LogMailer, MAILER } from './mailer';
import { resendFromEnv } from './resend.mailer';

/**
 * Resend when `RESEND_API_KEY` and `MAIL_FROM_ADDRESS` are set (T-036); otherwise the
 * development transport, which refuses to run in production. Callers depend on the Mailer port and
 * never know which.
 */
@Global()
@Module({
  providers: [{ provide: MAILER, useFactory: () => mailerFromEnv(process.env) }],
  exports: [MAILER],
})
export class MailModule {}

/**
 * The transport for this process, said once at boot — which one, never a key or an address — so a
 * deployment can see it is really sending (T-036).
 */
export function mailerFromEnv(env: Record<string, string | undefined>) {
  const resend = resendFromEnv(env);
  new Logger('Mail').log(
    resend === null
      ? 'development transport: mail is written to the log, not sent'
      : `Resend${env['REVIEW_REQUEST_EMAIL_OVERRIDE'] ? ', every email redirected to the review address' : ''}`,
  );
  return resend ?? new LogMailer();
}
