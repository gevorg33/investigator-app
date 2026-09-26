import { defineConfig, devices } from '@playwright/test';
import { OUTPUT, WEB_URL } from './e2e/support/stack';

/**
 * Browser flows against the real stack (T-139): the built API and app, a database migrated from
 * empty. `e2e/global-setup.ts` starts all of it; nothing here is a stand-in.
 *
 * Two widths, per the product's rule that the phone is a primary target, not a check at the end
 * (ADR-0009): 375px, and 1280px. Specs are `*.e2e.ts`, so Vitest's `*.spec.ts` never collects one.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: `${OUTPUT}/results`,
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: !!process.env['CI'],
  // A retry re-runs a whole journey on a fresh account; more than one would start to meet the
  // API's per-IP limits on registration and sign-in, which are what a real reader meets too.
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Deliberately not UTC, so the time zone sign-up records is visibly the device's own.
    timezoneId: 'Europe/Berlin',
    locale: 'en-GB',
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
