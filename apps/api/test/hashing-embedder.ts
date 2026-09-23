import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '../src/database/schema';
import type { Embedder } from '../src/modules/knowledge/embedder';

/**
 * A deterministic stand-in for a real embedding model (T-016). Each word lights up a dimension
 * chosen by its hash, and the vector is normalised — so the same text always gives the same vector,
 * and texts sharing most of their words point the same way. Nothing here is a model; it exists so
 * the sync's embedding paths can be tested without a network or a key.
 */
export class HashingEmbedder implements Embedder {
  readonly calls: string[][] = [];

  constructor(
    readonly model = 'test-hashing',
    readonly version = 'input-v1/1536d',
  ) {}

  async embed(texts: readonly string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    return texts.map((text) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
        const h = createHash('sha256').update(word).digest();
        v[h.readUInt32BE(0) % EMBEDDING_DIMENSIONS]! += 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
