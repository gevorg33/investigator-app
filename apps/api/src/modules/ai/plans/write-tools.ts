import type { Type } from '@nestjs/common';
import type { AssistantTool } from '../tools/assistant-tool';

/**
 * Every write tool, as one list both processes register (T-048): the API proposes with them and the
 * worker runs them, and a plan proposed with a tool the worker lacks could never run. Empty until the
 * first command arrives (T-095); each one added here needs the approval AGENTS.md names for a tool
 * that mutates business state, and runs in the worker — so the services it calls must be there too.
 */
export const WRITE_TOOLS: ReadonlyArray<Type<AssistantTool>> = [];
