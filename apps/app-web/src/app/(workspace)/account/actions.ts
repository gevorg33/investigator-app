'use server';

import { cookies } from 'next/headers';
import { ACTIVE_ROLE_COOKIE } from '@/lib/session-cookies';

/**
 * Which role the platform is shown as, for someone who holds both (T-127). `CUSTOMER` or
 * `INVESTIGATOR` narrows; anything else — "both" — clears the choice. The cookie lasts the browser
 * session: the API treats the role as per-request narrowing, never a stored preference, and it can
 * only ever narrow (ActorGuard intersects it with the roles held).
 */
export async function chooseActiveRole(form: FormData): Promise<void> {
  const role = form.get('role');
  const jar = await cookies();
  if (role === 'CUSTOMER' || role === 'INVESTIGATOR') {
    jar.set(ACTIVE_ROLE_COOKIE, role, { path: '/', sameSite: 'lax', secure: true, httpOnly: true });
  } else {
    jar.delete(ACTIVE_ROLE_COOKIE);
  }
}
