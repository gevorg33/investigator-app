import { Global, Module } from '@nestjs/common';
import { LogMailer, MAILER } from './mailer';

/**
 * One transport for now. When a provider is chosen (ACTIONS-FOR-ME #5) it replaces the
 * binding here and nothing upstream changes — callers depend on the Mailer port.
 */
@Global()
@Module({
  providers: [{ provide: MAILER, useClass: LogMailer }],
  exports: [MAILER],
})
export class MailModule {}
