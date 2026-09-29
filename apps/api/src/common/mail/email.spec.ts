import { catalogs, LOCALES } from '@investigator/i18n';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailCopy, fill, renderEmail } from './email';
import { MAIL_TEMPLATES, type MailTemplate } from './mailer';
import { mailerFromEnv } from './mail.module';
import { MailDeliveryError, RESEND_URL, ResendMailer, resendFromEnv } from './resend.mailer';

/** The variables each template is given — copy may use these and no others. */
const GIVEN: Readonly<Record<MailTemplate, readonly string[]>> = {
  email_verification: [],
  password_reset: [],
  workspace_invitation: ['workspace'],
  mission_published: [],
  mission_returned: [],
  mission_rejected: [],
  assignment_new: [],
  assignment_accepted: [],
  assignment_declined: [],
  assignment_report_ready: [],
};

describe('email copy (T-036)', () => {
  it.each(LOCALES)('exists for every template in %s, naming only what it is given', (locale) => {
    for (const template of MAIL_TEMPLATES) {
      const copy = catalogs[locale].email[template];
      for (const text of [copy.subject, copy.body, copy.action]) {
        const named = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        expect(
          named.filter((n) => !GIVEN[template].includes(n!)),
          `${locale} ${template}`,
        ).toEqual([]);
      }
    }
  });

  it('fills what it is given and leaves anything else as written', () => {
    expect(fill('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });

  it('writes transactional mail with why it came, and no way to stop it', async () => {
    const mail = await renderEmail({
      to: 'a@b.test',
      template: 'workspace_invitation',
      variables: { workspace: 'Ararat', url: 'https://app.test/invitations/accept?token=t' },
      locale: 'ru',
    });
    expect(mail.subject).toBe('Вас приглашают в Ararat');
    expect(mail.text).toContain('https://app.test/invitations/accept?token=t');
    expect(mail.text).toContain(catalogs.ru.email.footer.transactional);
    expect(mail.html).toContain('<html lang="ru">');
  });

  it('writes a notification with the way to stop it, in text and as a link', async () => {
    const mail = await renderEmail({
      to: 'a@b.test',
      template: 'mission_published',
      variables: { url: 'https://app.test/missions/m' },
      locale: 'hy',
      unsubscribeUrl: 'https://app.test/api/v1/notifications/unsubscribe?token=a.b',
    });
    expect(mail.subject).toBe(catalogs.hy.email.mission_published.subject);
    expect(mail.text).toContain('https://app.test/api/v1/notifications/unsubscribe?token=a.b');
    expect(mail.html).toContain(
      '<a href="https://app.test/api/v1/notifications/unsubscribe?token=a.b">',
    );
  });

  it('writes in English for a language it does not have, and escapes what it puts in HTML', async () => {
    const mail = await renderEmail({
      to: 'a@b.test',
      template: 'workspace_invitation',
      variables: { workspace: '<b>A&B</b>' },
      locale: 'fr',
    });
    expect(mail.subject).toBe('You are invited to join <b>A&B</b>');
    expect(mail.html).toContain('&#60;b&#62;A&#38;B&#60;/b&#62;');
    expect(mail.html).toContain('<a href="">');
    expect((await emailCopy(undefined)).lang).toBe('en');
  });
});

describe('sending through Resend', () => {
  afterEach(() => vi.restoreAllMocks());

  const sent = (fetch: ReturnType<typeof vi.fn>) => {
    const [url, init] = fetch.mock.calls[0]! as [string, RequestInit];
    return {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    };
  };

  it('posts the rendered mail from the one sender, with the idempotency key and one-click unsubscribe', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    await new ResendMailer({ apiKey: 're_test', from: 'no-reply@mail.test' }, fetch).send({
      to: 'ana@example.test',
      template: 'mission_published',
      variables: { url: 'https://app.test/missions/m' },
      locale: 'en',
      idempotencyKey: 'event-user-email',
      unsubscribeUrl: 'https://app.test/api/v1/notifications/unsubscribe?token=t',
    });
    const { url, headers, body } = sent(fetch);
    expect(url).toBe(RESEND_URL);
    expect(headers).toEqual({
      authorization: 'Bearer re_test',
      'content-type': 'application/json',
      'idempotency-key': 'event-user-email',
    });
    expect(body).toMatchObject({
      from: 'no-reply@mail.test',
      to: ['ana@example.test'],
      subject: 'Your mission is published',
      headers: {
        'List-Unsubscribe': '<https://app.test/api/v1/notifications/unsubscribe?token=t>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  });

  it('sends transactional mail with neither, and to the review address when one is set', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    await new ResendMailer(
      { apiKey: 'k', from: 'no-reply@mail.example.test', overrideTo: 'owner@example.test' },
      fetch,
    ).send({ to: 'someone@example.test', template: 'password_reset', variables: { url: 'u' } });
    const { headers, body } = sent(fetch);
    expect(headers['idempotency-key']).toBeUndefined();
    expect(body.headers).toBeUndefined();
    expect(body.to).toEqual(['owner@example.test']);
  });

  it('fails in its own words when the provider refuses, so the job retries', async () => {
    const fetch = vi.fn(async () => new Response('{"message":"secret detail"}', { status: 422 }));
    const error = await new ResendMailer({ apiKey: 'k', from: 'f@x.test' }, fetch)
      .send({ to: 't@x.test', template: 'password_reset', variables: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailDeliveryError);
    expect((error as Error).message).toBe('mail provider answered 422');
  });

  it('is chosen with a key and a sender, and says which transport it is, never the key', () => {
    const said = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    expect(resendFromEnv({ RESEND_API_KEY: 'k' })).toBeNull();
    expect(resendFromEnv({ MAIL_FROM_ADDRESS: 'f@x.test' })).toBeNull();
    const env = { RESEND_API_KEY: 're_secret_value', MAIL_FROM_ADDRESS: 'f@x.test' };
    expect(mailerFromEnv(env)).toBeInstanceOf(ResendMailer);
    expect(mailerFromEnv({ ...env, REVIEW_REQUEST_EMAIL_OVERRIDE: 'o@x.test' })).toBeInstanceOf(
      ResendMailer,
    );
    expect(mailerFromEnv({}).constructor.name).toBe('LogMailer');
    expect(said.mock.calls.map(([line]) => line)).toEqual([
      'Resend',
      'Resend, every email redirected to the review address',
      'development transport: mail is written to the log, not sent',
    ]);
    expect(JSON.stringify(said.mock.calls)).not.toMatch(/re_secret_value|o@x\.test|f@x\.test/);
  });
});
