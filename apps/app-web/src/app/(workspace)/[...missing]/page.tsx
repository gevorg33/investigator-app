import { notFound } from 'next/navigation';

/**
 * An address nothing in the app answers (T-151). Without this it reaches Next's own page — in
 * English, outside the shell; through here it gets the workspace's, like any other `notFound()`.
 * Every named route is more specific and wins, and the `/api` rewrite runs before dynamic routes.
 */
export default function Missing(): never {
  notFound();
}
