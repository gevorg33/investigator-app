/**
 * The model window one call has, and how much of it is kept for the answer (`ai-session-context`):
 *
 * ```
 * window − output reserve − instructions − tool definitions − the request = available for context
 * ```
 *
 * Output space is reserved first and never lent to input: a prompt that fills the window leaves
 * the model nothing to answer in.
 */
export interface ContextBudget {
  /** The model's context window, in tokens. */
  window: number;
  /** Kept for the reply, whatever the input. */
  outputReserve: number;
}

/**
 * Conservative for the smallest window the assistant is expected to run on. Which model answers is
 * the owner's choice (`OPENAI_CHAT_MODEL`, ACTIONS-FOR-ME #6); a larger window only means context
 * compacts later than it could.
 */
export const DEFAULT_BUDGET: ContextBudget = { window: 16_000, outputReserve: 2_000 };

/** Compaction starts here — proactively, never at the hard limit (ADR-0006: ~70–80%). */
export const COMPACT_AT = 0.75;

/**
 * Tokens a text will cost, overestimated rather than under: a character in three. English runs
 * near four per token; Russian and Armenian run nearer two to three, and the estimate must not let
 * them overflow. No tokenizer is bundled for one provider's encoding (`chat-model.ts`).
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

/**
 * What the fixed parts of a call leave for context. `material` is what the caller adds itself, in
 * tokens — the knowledge answer's sources, which are retrieved after context is built. Throws if
 * they leave nothing.
 */
export function availableForContext(
  budget: ContextBudget,
  fixed: { system: string; tools?: string; request: string; material?: number },
): number {
  const left =
    budget.window -
    budget.outputReserve -
    estimateTokens(fixed.system) -
    estimateTokens(fixed.tools ?? '') -
    estimateTokens(fixed.request) -
    (fixed.material ?? 0);
  if (left <= 0)
    throw new RangeError('context budget: the fixed parts of the call fill the window');
  return left;
}
