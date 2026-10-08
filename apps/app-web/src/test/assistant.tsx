import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import {
  AssistantProvider,
  useAssistant,
  type AssistantAudience,
} from '@/components/assistant/assistant-provider';
import type { AiMessage } from '@/lib/api/assistant';
import { api } from './api';
import { emptyPage } from './fixtures';
import { renderIntl } from './intl';

/** The name of the button that stands in for the navigation's Assistant. */
export const OPENER = 'Open assistant';

/** What opens the assistant in the shell — here, one button. */
export function Opener() {
  const { toggle } = useAssistant();
  return (
    <button type="button" onClick={toggle}>
      {OPENER}
    </button>
  );
}

/** A window as wide as `docked` says, which the spec can resize while it runs. */
export function viewport(docked: boolean) {
  const listeners = new Set<() => void>();
  const size = { docked };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: size.docked,
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return (next: boolean) => {
    size.docked = next;
    act(() => listeners.forEach((l) => l()));
  };
}

/** A page of messages as the API returns it: newest first. */
export const newestFirst = (messages: AiMessage[], earlier: string | null = null) => ({
  ...emptyPage,
  items: [...messages].reverse(),
  pageInfo: { nextCursor: earlier, hasNextPage: earlier !== null },
});

/**
 * Conversations with no plan waiting or running (T-058). Opening a conversation reads its open plans,
 * so a spec says what each conversation it opens answers — here, none.
 */
export const noPlans = (...sessionIds: string[]) => {
  for (const id of sessionIds) api.on(`GET /ai/sessions/${id}/plans?open=true`, 200, []);
};

/** Renders the assistant as the workspace layout mounts it, and opens it. */
export async function openAssistant(audience: AssistantAudience = 'CUSTOMER') {
  renderIntl(
    <AssistantProvider audience={audience}>
      <Opener />
      <AssistantPanel />
    </AssistantProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: OPENER }));
}
