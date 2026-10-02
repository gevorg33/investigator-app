'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { OWN_PROFILE, type ProfileTarget } from './profile-target-paths';

const Target = createContext<ProfileTarget>(OWN_PROFILE);

/** The profile the sections below edit (T-093); without one, they edit the reader's own. */
export function ProfileTargetProvider({
  target,
  children,
}: {
  target: ProfileTarget;
  children: ReactNode;
}) {
  return <Target.Provider value={target}>{children}</Target.Provider>;
}

/** The profile the section is editing; the reader's own unless a provider says otherwise. */
export function useProfileTarget(): ProfileTarget {
  return useContext(Target);
}
