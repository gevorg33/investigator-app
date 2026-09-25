import { ProviderError } from '../../common/errors/provider-error';

/** DI token: an interface does not exist at runtime, so Nest cannot inject one. */
export const CHAT_MODEL = Symbol('CHAT_MODEL');

/** What reaches a model: instructions, and the material to apply them to. Nothing else. */
export interface ChatPrompt {
  system: string;
  user: string;
}

/**
 * A language model that answers one prompt with one JSON object (T-017). One implementation per
 * provider; nothing outside this file knows which provider it is.
 *
 * It is given no tools. Whatever it writes is text for the caller to validate — it cannot read,
 * write or decide anything (CLAUDE.md, core principle).
 */
export interface ChatModel {
  readonly model: string;
  /**
   * The model's reply, which should be a JSON object — and is checked, never trusted to be.
   * `signal` abandons the call: a person who pressed Stop is not kept waiting for, or charged
   * for, an answer nobody will read (T-056).
   */
  complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string>;
}

/** OpenAI's chat completions endpoint, called with `fetch` like the embedder (T-016). */
export class OpenAiChatModel implements ChatModel {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  async complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string> {
    const res = await this.http('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    // The status and nothing else: an error body can echo the request, and the request holds
    // the user's question.
    if (!res.ok) throw new ProviderError(`chat request failed: HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new ProviderError('chat response had no content');
    return content;
  }
}

/**
 * The chat model the environment configures, or null. Both `OPENAI_API_KEY` and
 * `OPENAI_CHAT_MODEL` are required, with no default model: which model answers users is a cost
 * and quality decision for the owner (ACTIONS-FOR-ME #6), not one to make by leaving a variable out.
 */
export function chatModelFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ChatModel | null {
  const key = env['OPENAI_API_KEY'];
  const model = env['OPENAI_CHAT_MODEL'];
  return key && model ? new OpenAiChatModel(key, model) : null;
}
