import {
  Bot,
  BriefcaseBusiness,
  House,
  MessagesSquare,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { Catalog } from '@investigator/i18n';

/**
 * A place to go, or — the assistant — something that opens beside where the reader already is
 * (T-056): docked from `lg` up, a full-screen sheet below. It has no page of its own.
 */
export type Destination = { label: keyof Catalog['nav']; icon: LucideIcon } & (
  { href: string; opens?: undefined } | { opens: 'assistant'; href?: undefined }
);

/**
 * The primary destinations: the bottom navigation on a phone and the sidebar from tablet up
 * (responsive-design — 3 to 5, and never hidden behind a menu on the smallest screen).
 *
 * The core loop's places (TODO.md, "Core loop"): what needs you, your missions, your
 * conversations, the assistant, and your account. Each screen is built by its own task; until
 * then its route says what will be there.
 */
export const DESTINATIONS: readonly Destination[] = [
  { href: '/', label: 'home', icon: House },
  { href: '/missions', label: 'missions', icon: BriefcaseBusiness },
  { href: '/messages', label: 'messages', icon: MessagesSquare },
  { opens: 'assistant', label: 'assistant', icon: Bot },
  { href: '/account', label: 'account', icon: UserRound },
];

/** Whether `href` is where the reader is: itself, or anywhere beneath it. Home only exactly. */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
