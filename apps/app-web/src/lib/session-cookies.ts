/**
 * The API's session cookie (T-005, T-025): one name, shared with the API that sets and clears it.
 * Read here only to forward it.
 */
export { SESSION_COOKIE } from '@investigator/config';

/**
 * The role the reader chose to act as, when they hold both. A UI choice, not authority: the API
 * intersects it with the roles actually held, so it can only narrow (ActorGuard).
 */
export const ACTIVE_ROLE_COOKIE = 'active_role';
