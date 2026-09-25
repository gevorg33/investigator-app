'use client';

import {
  Archive,
  ArchiveRestore,
  Check,
  Ellipsis,
  List,
  Pencil,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/errors';
import { useAssistant } from './assistant-provider';
import { COMPOSER_ID } from './composer';

const focusComposer = () => document.getElementById(COMPOSER_ID)?.focus();

/** A title the API accepts (`RenameSessionDto`). */
export const MAX_TITLE = 120;

const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal');

/**
 * The top of a conversation (T-056, T-057): the way to the list of conversations, the title with
 * its workspace — and, once there is a conversation, "new", and its options: rename (in place),
 * archive or bring back, delete (asked first). Nothing is offered while an answer forms; it would
 * act on a conversation that is still changing.
 */
export function ConversationHeader({
  Title,
  onSessions,
  onClose,
}: {
  Title: ComponentType<{ className: string; children: ReactNode }> | 'h2';
  onSessions: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('assistant');
  const { conversation } = useAssistant();
  const { state, workspace, running, startNew, rename, archive, restore, remove } = conversation;
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const deleting = useRef(false);

  const session = state.session;
  const title = session?.title ?? t('untitled');
  const started = state.messages.length > 0 || state.turn !== null;
  const archived = session?.status === 'ARCHIVED';
  // A Personal workspace has no name of its own (`WorkspaceView`).
  const place = workspace === null ? null : (workspace.name ?? t('workspace.personal'));

  /** Runs one option, keeping its refusal to show; a conversation that has gone resets itself. */
  const attempt = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(asApiError(e));
      return false;
    }
  };

  // Escape while renaming cancels the rename and nothing else. The sheet listens for Escape on the
  // document as it travels down (Radix), before the field would see it; the window hears it first.
  useEffect(() => {
    if (!renaming) return;
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setRenaming(false);
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [renaming]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('title')).trim();
    if (name === '' || name === session!.title) return setRenaming(false);
    if (await attempt(() => rename(name))) setRenaming(false);
  };

  return (
    <header className="border-b border-border px-2 py-2">
      <div className="flex items-start gap-1">
        <Button variant="ghost" size="icon" onClick={onSessions} aria-label={t('sessions.open')}>
          <List aria-hidden />
        </Button>

        {renaming ? (
          <form onSubmit={(e) => void save(e)} className="flex min-w-0 flex-1 items-center gap-1">
            {/* The dialog keeps its name while the title is being edited. */}
            <Title className="sr-only">{title}</Title>
            <Input
              name="title"
              aria-label={t('actions.name')}
              defaultValue={session!.title ?? ''}
              maxLength={MAX_TITLE}
              required
              autoFocus
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="ghost" size="icon" aria-label={t('actions.save')}>
              <Check aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setRenaming(false)}
              aria-label={t('actions.cancel')}
            >
              <X aria-hidden />
            </Button>
          </form>
        ) : (
          <div className="min-w-0 flex-1 py-2">
            <Title className="truncate text-base font-semibold">{title}</Title>
            <p className="flex items-center gap-2 text-sm text-text-muted">
              {place !== null && <span className="truncate">{place}</span>}
              {archived && <Badge variant="outline">{t('actions.archived')}</Badge>}
            </p>
          </div>
        )}

        {started && !renaming && (
          <Button variant="ghost" size="icon" onClick={startNew} aria-label={t('new')}>
            <SquarePen aria-hidden />
          </Button>
        )}
        {session !== null && !renaming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuButton}
                variant="ghost"
                size="icon"
                disabled={running}
                aria-label={t('actions.menu')}
              >
                <Ellipsis aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil aria-hidden />
                {t('actions.rename')}
              </DropdownMenuItem>
              {archived ? (
                <DropdownMenuItem onSelect={() => void attempt(restore)}>
                  <ArchiveRestore aria-hidden />
                  {t('actions.restore')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void attempt(archive)}>
                  <Archive aria-hidden />
                  {t('actions.archive')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  deleting.current = false;
                  setConfirming(true);
                }}
              >
                <Trash2 aria-hidden />
                {t('actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!renaming && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('close')}>
            <X aria-hidden />
          </Button>
        )}
      </div>

      {error !== null && (
        <div className="px-2 pt-2">
          <FormError error={error} />
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // Kept: back to the options it was opened from (the menu itself has closed by now).
            // Deleting decides for itself, once it knows how the delete went.
            if (!deleting.current) menuButton.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('delete.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                // Deleted, the options are gone with the conversation: focus goes on to where the
                // next question is typed. Refused, it goes back to the options.
                deleting.current = true;
                void attempt(remove).then((done) =>
                  done ? focusComposer() : menuButton.current?.focus(),
                );
              }}
            >
              {t('delete.confirm')}
            </AlertDialogAction>
            <AlertDialogCancel>{t('delete.cancel')}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
