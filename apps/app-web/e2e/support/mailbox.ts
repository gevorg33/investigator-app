import { readFileSync, statSync } from 'node:fs';
import { API_LOG } from './stack';

type Template = 'email_verification' | 'password_reset';

/**
 * The inbox, for as long as there is no mail provider (ACTIONS-FOR-ME #5): the API's development
 * mailer logs every message as `[dev mail] <template> -> <address> :: {"url": …}`, and the global
 * setup sends the API's output to `API_LOG`. Only the token's hash is stored, so the log is the
 * one place a link can be read back from — as it would be from an inbox.
 *
 * `mark()` before the action that sends, `link()` after it: a link is only taken from what was
 * written since, so an older one can never be mistaken for the new one.
 */
export function mark(): number {
  return statSync(API_LOG).size;
}

export async function link(
  since: number,
  to: string,
  template: Template,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = scan(readFileSync(API_LOG).subarray(since).toString('utf8'), to, template);
    if (found !== undefined) return found;
    if (Date.now() > deadline)
      throw new Error(`no ${template} mail to ${to} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function scan(text: string, to: string, template: Template): string | undefined {
  const prefix = `[dev mail] ${template} -> ${to} :: `;
  let url: string | undefined;
  for (const line of text.split('\n')) {
    let msg: unknown;
    try {
      msg = (JSON.parse(line) as { msg?: unknown }).msg;
    } catch {
      continue; // Not one of pino's lines.
    }
    if (typeof msg === 'string' && msg.startsWith(prefix)) {
      url = (JSON.parse(msg.slice(prefix.length)) as { url: string }).url;
    }
  }
  return url;
}
