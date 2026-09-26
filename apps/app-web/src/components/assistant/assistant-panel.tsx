'use client';

import { breakpoints } from '@investigator/ui-tokens';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/use-media-query';
import { PANEL_ID, useAssistant } from './assistant-provider';
import { COMPOSER_ID } from './composer';
import { Conversation } from './conversation';
import { SessionList } from './session-list';

const focusComposer = () => document.getElementById(COMPOSER_ID)?.focus();
/** Where focus lands on opening: the composer, or — with no conversation — the first control. */
const focusStart = (unconfirmed: boolean) =>
  unconfirmed
    ? document.getElementById(PANEL_ID)?.querySelector('button')?.focus()
    : focusComposer();

type TitleTag = ComponentType<{ className: string; children: ReactNode }> | 'h2';

/**
 * The assistant while the address is unconfirmed (T-165): its name, a way to close it, and what
 * opens it in place of a conversation the API would refuse.
 */
function ConfirmFirstBody({
  Title,
  onClose,
  children,
}: {
  Title: TitleTag;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('assistant');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-1 border-b border-border px-2 py-2">
        <Title className="min-w-0 flex-1 truncate px-2 py-2 text-base font-semibold">
          {t('label')}
        </Title>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('close')}>
          <X aria-hidden />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
    </div>
  );
}

/**
 * What the assistant shows: the conversation, or the list of conversations in its place (T-057) —
 * on a phone that is the full-screen sheet, never a sidebar squeezed beside it. Focus follows:
 * into the list when it opens, back to the composer when it closes.
 */
function AssistantBody({ Title = 'h2', onClose }: { Title?: TitleTag; onClose: () => void }) {
  const { api, conversation, confirmFirst } = useAssistant();
  const [view, setView] = useState<'conversation' | 'sessions'>('conversation');
  const switched = useRef(false);

  useEffect(() => {
    if (view === 'conversation' && switched.current) focusComposer();
    switched.current = true;
  }, [view]);

  if (confirmFirst !== undefined) {
    return (
      <ConfirmFirstBody Title={Title} onClose={onClose}>
        {confirmFirst}
      </ConfirmFirstBody>
    );
  }
  if (view === 'sessions') {
    const current = conversation.state.session?.id ?? null;
    return (
      <SessionList
        api={api}
        currentId={current}
        Title={Title}
        onOpen={(session, focus) => {
          setView('conversation');
          // The one already open, with nothing to find in it, is simply returned to.
          if (session.id !== current || focus !== null) void conversation.open(session, focus);
        }}
        onBack={() => setView('conversation')}
        onClose={onClose}
      />
    );
  }
  return <Conversation Title={Title} onSessions={() => setView('sessions')} onClose={onClose} />;
}

/**
 * Where the assistant opens (T-056, responsive-design): docked beside the page from `lg` up, where
 * there is room to read both, and a full-screen sheet below it, where there is not.
 *
 * The docked panel is not a dialog — the page beside it stays usable — so Escape inside it closes
 * it, and focus returns to what opened it. The sheet is a dialog: focus is held inside it until it
 * closes. It has no handle and is never dragged: scrolling a conversation must not close it. Close
 * and Escape do.
 */
export function AssistantPanel() {
  const t = useTranslations('assistant');
  const { open, setOpen, close, confirmFirst } = useAssistant();
  const docked = useMediaQuery(`(min-width: ${breakpoints.lg})`);
  const unconfirmed = confirmFirst !== undefined;

  useEffect(() => {
    if (open && docked) focusStart(unconfirmed);
  }, [open, docked, unconfirmed]);

  if (docked) {
    if (!open) return null;
    return (
      <aside
        id={PANEL_ID}
        aria-label={t('label')}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        className="sticky top-0 flex h-dvh w-96 shrink-0 flex-col border-l border-border bg-surface-raised"
      >
        <AssistantBody onClose={close} />
      </aside>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen} handleOnly>
      <DrawerContent
        id={PANEL_ID}
        handle={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusStart(unconfirmed);
        }}
        className="h-dvh data-[vaul-drawer-direction=bottom]:max-h-dvh data-[vaul-drawer-direction=bottom]:rounded-t-none"
      >
        <AssistantBody Title={DrawerTitle} onClose={() => setOpen(false)} />
      </DrawerContent>
    </Drawer>
  );
}
