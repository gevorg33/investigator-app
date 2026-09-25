/** The API's session cookie (T-005, T-025). Set and cleared by the API only; read here to forward. */
export const SESSION_COOKIE = 'investigator_session';

/**
 * The role the reader chose to act as, when they hold both. A UI choice, not authority: the API
 * intersects it with the roles actually held, so it can only narrow (ActorGuard).
 */
export const ACTIVE_ROLE_COOKIE = 'active_role';
