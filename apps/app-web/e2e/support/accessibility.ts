import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * axe over the rendered page, WCAG 2.2 A and AA (`frontend-accessibility`). A violation is listed
 * by rule and element, so a failure says what to fix rather than only that something is wrong.
 * It complements the keyboard and screen-reader review; it does not replace it.
 */
export async function expectAccessible(page: Page): Promise<void> {
  // Next streams a page's metadata after its first HTML, so the title can land a moment after the
  // page is otherwise ready. Waited for, not skipped: a page without one still fails here.
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map((v) => ({ rule: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })),
    `accessibility violations on ${page.url()}`,
  ).toEqual([]);
}
