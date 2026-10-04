import { test as base, expect, type BrowserContext } from '@playwright/test';

export { expect };

/**
 * Playwright's `test`, with one guard on every journey: no page breaks its Content-Security-Policy
 * (T-025). A blocked script is a page that renders and then does nothing — the failure a nonce
 * policy invites — so each one fails the test that met it, naming what was refused. Contexts a
 * journey opens itself, for a second person, are watched too.
 *
 * Heard from the page's own `securitypolicyviolation` event, not the console: the browser logs a
 * violation itself, and Playwright's console events carry only what the page's scripts log — a
 * guard listening there passed with every script refused (seen in T-025's verification). The
 * listener is an init script and the report a binding, so the policy cannot block either.
 */
export const test = base.extend<{ contentSecurityPolicy: void }>({
  contentSecurityPolicy: [
    async ({ browser, context }, use) => {
      const refused: string[] = [];
      const watch = async (c: BrowserContext) => {
        await c.exposeBinding('__reportPolicyViolation', ({ page }, what: string) => {
          refused.push(`${page.url()}: ${what}`);
        });
        await c.addInitScript(() => {
          document.addEventListener('securitypolicyviolation', (e) => {
            const report = (window as unknown as Record<string, (what: string) => void>)[
              '__reportPolicyViolation'
            ];
            report?.(`${e.effectiveDirective} refused ${e.blockedURI || 'inline'}`);
          });
        });
      };
      await watch(context);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...options) => {
        const opened = await newContext(...options);
        await watch(opened);
        return opened;
      };
      try {
        await use();
      } finally {
        browser.newContext = newContext;
      }
      expect(refused).toEqual([]);
    },
    { auto: true },
  ],
});
