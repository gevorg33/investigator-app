'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAssistant } from './assistant-provider';

/** The parameter a link opens a conversation with: `/?assistant=<session id>`. */
export const ASSISTANT_PARAM = 'assistant';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens the assistant on the conversation a link names (T-231) — a notification that a plan failed
 * or was voided leads to `/?assistant=<session>` (`notifications/kinds.ts`, `assistantHref`). On the
 * page it lands on, or as a link followed within the app, the panel opens on that conversation as if
 * it were chosen from the list, and the parameter leaves the address: a reload or a shared address
 * does not open it again. A conversation that is gone, or not the reader's, says so as any other does
 * (`assistant.notice.gone`); a parameter that is not a conversation's id is dropped.
 *
 * Mounted under `AssistantProvider` by the workspace layout, inside `Suspense`: it reads the address.
 */
export function AssistantDeepLink() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { openConversation } = useAssistant();
  const id = params.get(ASSISTANT_PARAM);
  // Opened once per link followed: until the address no longer names it, a re-render is not another.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (id === null) {
      handled.current = null;
      return;
    }
    if (handled.current === id) return;
    handled.current = id;
    if (SESSION_ID.test(id)) openConversation(id);
    const rest = new URLSearchParams(params.toString());
    rest.delete(ASSISTANT_PARAM);
    const query = rest.toString();
    router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
  }, [id, params, router, pathname, openConversation]);

  return null;
}
