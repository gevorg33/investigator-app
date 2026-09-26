'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { breakpoints } from '@investigator/ui-tokens';
import { assistantApi, type AssistantApi } from '@/lib/api/assistant';
import { useConversation, type Conversation } from './use-conversation';

/** The panel's id, for the controls that open it. Here, not with the panel, which loads later. */
export const PANEL_ID = 'assistant-panel';

/**
 * Who the assistant is talking to, for what it offers to help with (the empty state). `NONE` is an
 * account with no role yet: the API answers it from the public policies only (T-017, audience by
 * role), so it is offered only what those answer.
 */
export type AssistantAudience = 'CUSTOMER' | 'INVESTIGATOR' | 'NONE';

interface AssistantValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Closes, and gives focus back to whatever opened it — the docked panel has no dialog to. */
  close: () => void;
  /**
   * Closes the assistant if it covers the page — the phone's sheet — before following a link out
   * of it (a citation, the policy). Docked beside the page, it stays: the page opens next to it.
   */
  closeIfCovering: () => void;
  audience: AssistantAudience;
  api: AssistantApi;
  conversation: Conversation;
}

const AssistantContext = createContext<AssistantValue | null>(null);

/**
 * The assistant across the workspace (T-056): whether it is open, and its conversation. Mounted by
 * the workspace layout, which outlives every page, so a conversation stays where it was while the
 * reader moves between screens. The conversation is read when the assistant first opens, never on
 * a page load that does not use it.
 */
export function AssistantProvider({
  audience,
  activeRole,
  children,
}: {
  audience: AssistantAudience;
  /** The role the reader chose to act as, forwarded so answers are for that role. */
  activeRole: string | null;
  children: ReactNode;
}) {
  const api = useMemo(() => assistantApi(activeRole), [activeRole]);
  const conversation = useConversation(api);
  const [open, setOpenState] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const { load, state } = conversation;
  const idle = state.status === 'idle';

  const setOpen = useCallback(
    (next: boolean) => {
      if (next) {
        opener.current = document.activeElement as HTMLElement | null;
        if (idle) void load();
      }
      setOpenState(next);
    },
    [idle, load],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const close = useCallback(() => {
    setOpenState(false);
    opener.current?.focus();
  }, []);

  const closeIfCovering = useCallback(() => {
    if (!window.matchMedia(`(min-width: ${breakpoints.lg})`).matches) setOpenState(false);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, toggle, close, closeIfCovering, audience, api, conversation }),
    [open, setOpen, toggle, close, closeIfCovering, audience, api, conversation],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantValue {
  const value = useContext(AssistantContext);
  if (value === null) throw new Error('useAssistant is used outside AssistantProvider');
  return value;
}
