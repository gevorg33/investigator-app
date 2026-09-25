'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useAssistant } from './assistant-provider';

// The panel, its sheet and its conversation are downloaded when the assistant is first opened —
// not by every page of the workspace, most of whose visits never open it (frontend-performance:
// a modal's body is never in the initial bundle).
const AssistantPanel = dynamic(() => import('./assistant-panel').then((m) => m.AssistantPanel), {
  ssr: false,
});

/**
 * The assistant beside the page (T-056): nothing until it is first opened, then the panel —
 * kept mounted after, so closing it can animate and opening it again costs nothing.
 */
export function AssistantBeside() {
  const { open } = useAssistant();
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  return wanted ? <AssistantPanel /> : null;
}
