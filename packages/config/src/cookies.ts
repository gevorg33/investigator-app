// The session cookie's name, shared by the API that sets it and the web apps that forward it.

/**
 * `__Host-` makes host-only a rule the browser enforces, not one this code keeps (ADR-0002, T-025):
 * a cookie with this prefix is refused unless it is `Secure`, has `Path=/` and has **no** `Domain`.
 * So no future change can widen it to the parent domain, and no sibling — `news.`, the apex, any
 * subdomain added to the domain map — can plant a cookie of this name for `app.` to read (cookie
 * tossing), because a cookie a sibling sets for the parent domain must carry `Domain`.
 */
export const SESSION_COOKIE = '__Host-investigator_session';
