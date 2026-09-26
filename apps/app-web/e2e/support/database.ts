import postgres from 'postgres';
import { ownerUrl } from './stack';

/**
 * Reading back what the browser caused, as the owner (T-073) — for the records a screen does not
 * show, such as which document version and language an acceptance recorded. Never written to by
 * a spec: everything a flow changes, it changes through the app.
 */
export function owner(): postgres.Sql {
  return postgres(ownerUrl(), { max: 1, onnotice: () => {} });
}
