'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

const Hide = createContext<(() => void) | null>(null);

/** The listing a block was made from, to take away at once (T-052); null outside one. */
export const useHideListing = () => useContext(Hide);

/**
 * A listing that disappears the moment its person is blocked (T-052), without waiting on the
 * page's refresh: the API has already said the block is made, and the refresh that follows — which
 * brings the rest of the page up to date — is not something the reader should have to watch for.
 */
export function BlockableListing({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return <Hide.Provider value={() => setHidden(true)}>{children}</Hide.Provider>;
}
