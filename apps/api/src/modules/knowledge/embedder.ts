/** DI token: an interface does not exist at runtime, so Nest cannot inject one. */
export const EMBEDDER = Symbol('EMBEDDER');

/**
 * Turns text into vectors (T-016). One implementation per provider; the sync and, later, session
 * search (T-133) and retrieval (T-017) use this and nothing more specific.
 *
 * `version` names what the vector depends on besides the model: the text fed to it and its width.
 * A chunk embedded under another model or version is re-embedded; one under the same is left alone.
 */
export interface Embedder {
  readonly model: string;
  readonly version: string;
  embed(texts: readonly string[]): Promise<number[][]>;
}

/**
 * What a chunk is embedded from. Bumping {@link EMBEDDING_INPUT_REVISION} re-embeds everything,
 * which is the point: a vector made from different input is not comparable with this one.
 */
export const EMBEDDING_INPUT_REVISION = 'input-v1';
export const embeddingInput = (chunk: { heading: string; content: string }): string =>
  `${chunk.heading}\n\n${chunk.content}`;

/**
 * OpenAI's embeddings endpoint, called with `fetch` rather than an SDK: one request shape, and
 * nothing added to the dependency tree for it (T-016). Knowledge-base text is written by the
 * platform and holds no personal data.
 */
export class OpenAiEmbedder implements Embedder {
  readonly version: string;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly dimensions: number,
    private readonly http: typeof fetch = fetch,
  ) {
    this.version = `${EMBEDDING_INPUT_REVISION}/${dimensions}d`;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.http('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }),
    });
    if (!res.ok) {
      // The status and nothing else: an error body can echo the request, and the request is ours.
      throw new Error(`embedding request failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    const byIndex = [...json.data].sort((a, b) => a.index - b.index);
    if (
      byIndex.length !== texts.length ||
      byIndex.some((d) => d.embedding.length !== this.dimensions)
    ) {
      throw new Error('embedding response did not match the request');
    }
    return byIndex.map((d) => d.embedding);
  }
}
