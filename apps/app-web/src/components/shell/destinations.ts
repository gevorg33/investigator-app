import {
  Bot,
  BriefcaseBusiness,
  House,
  MessagesSquare,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '@/i18n/messages';

export interface Destination {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
}

/**
 * The primary destinations: the bottom navigation on a phone and the sidebar from tablet up
 * (responsive-design — 3 to 5, and never hidden behind a menu on the smallest screen).
 *
 * The core loop's places (TODO.md, "Core loop"): what needs you, your missions, your
 * conversations, the assistant, and your account. Each screen is built by its own task; until
 * then its route says what will be there.
 */
export const DESTINATIONS: readonly Destination[] = [
  { href: '/', label: 'nav.home', icon: House },
  { href: '/missions', label: 'nav.missions', icon: BriefcaseBusiness },
  { href: '/messages', label: 'nav.messages', icon: MessagesSquare },
  { href: '/assistant', label: 'nav.assistant', icon: Bot },
  { href: '/account', label: 'nav.account', icon: UserRound },
];

/** Whether `href` is where the reader is: itself, or anywhere beneath it. Home only exactly. */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
