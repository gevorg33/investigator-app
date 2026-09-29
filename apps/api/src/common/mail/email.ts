import type { MailMessage } from './mailer';

// The catalogs are an ES module and the API compiles to CommonJS; a dynamic import stays one.
type I18n = typeof import('@investigator/i18n', { with: { 'resolution-mode': 'import' } });
let i18n: Promise<I18n> | undefined;
const load = (): Promise<I18n> => (i18n ??= import('@investigator/i18n'));

/** The email copy in `locale`, English when it is not one of ours. */
export async function emailCopy(locale: string | undefined) {
  const { catalogs, isLocale } = await load();
  const lang = isLocale(locale) ? locale : 'en';
  return { lang, copy: catalogs[lang].email };
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** `{name}` → its value. Copy names only variables its template is given (email.spec.ts). */
export function fill(template: string, variables: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => variables[name] ?? whole);
}

export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * An email in the recipient's language (T-036): subject, a sentence or two, one action link, and
 * the footer that says why it arrived — with the way to stop it, for mail that can be stopped.
 * Plain text and a minimal HTML twin; no images, no tracking, and nothing but what the template
 * and its variables say — which is references and links, never the content they lead to.
 */
export async function renderEmail(message: MailMessage): Promise<RenderedEmail> {
  const { catalogs, isLocale } = await load();
  const catalog = catalogs[isLocale(message.locale) ? message.locale : 'en'].email;
  const copy = catalog[message.template];
  const v = message.variables;
  const subject = fill(copy.subject, v);
  const body = fill(copy.body, v);
  const url = v['url'] ?? '';
  const footer =
    message.unsubscribeUrl === undefined
      ? `${catalog.footer.transactional} ${catalog.footer.not_you}`
      : fill(catalog.footer.activity, { unsubscribe: message.unsubscribeUrl });
  const text = [body, '', `${copy.action}: ${url}`, '', '—', footer].join('\n');
  const htmlFooter =
    message.unsubscribeUrl === undefined
      ? escape(footer)
      : escape(fill(catalog.footer.activity, { unsubscribe: '\u0000' })).replace(
          '\u0000',
          `<a href="${escape(message.unsubscribeUrl)}">${escape(message.unsubscribeUrl)}</a>`,
        );
  const html =
    `<!doctype html><html lang="${isLocale(message.locale) ? message.locale : 'en'}"><body>` +
    `<p>${escape(body)}</p>` +
    `<p><a href="${escape(url)}">${escape(copy.action)}</a></p>` +
    `<p style="color:#666;font-size:12px">${htmlFooter}</p></body></html>`;
  return { subject, text, html };
}
