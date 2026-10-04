import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from './drawer';

/**
 * A sheet is a modal dialog: the keyboard goes into it and stays there (T-093), and with motion
 * reduced it is simply there (T-207). vaul animates the sheet and its scrim for 0.5s in CSS of its
 * own, which the duration tokens never reach — admin-web found it in T-205, and app-web's sheets
 * still slid for half a second under `prefers-reduced-motion`.
 */
describe('Drawer', () => {
  const sheet = () =>
    render(
      <>
        <button type="button">Behind the sheet</button>
        <Drawer>
          <DrawerTrigger>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerTitle>A sheet</DrawerTitle>
            <DrawerDescription>What it is for.</DrawerDescription>
            <input aria-label="First field" />
            <button type="button">Last control</button>
          </DrawerContent>
        </Drawer>
      </>,
    );

  it('moves focus into the sheet when it opens, and keeps Tab inside it', async () => {
    sheet();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog', { name: 'A sheet' });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    expect(within(dialog).getByRole('textbox', { name: 'First field' })).toBeInTheDocument();
  });

  it('opts the sheet and its scrim out of vaul’s own animation under reduced motion', async () => {
    // jsdom applies no media query, so this holds the opt-out is there; the browser check that it
    // takes effect — no animation, closed in milliseconds — is recorded in app-web.md (T-207).
    sheet();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog', { name: 'A sheet' });
    const overlay = document.querySelector('[data-slot="drawer-overlay"]')!;
    for (const el of [dialog, overlay]) {
      expect(el).toHaveClass('motion-reduce:animate-none!', 'motion-reduce:transition-none!');
    }
  });
});
