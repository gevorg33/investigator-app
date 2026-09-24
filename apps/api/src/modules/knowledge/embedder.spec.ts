import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../common/errors/provider-error';
import {
  EMBEDDING_INPUT_REVISION,
  embedderFromEnv,
  embeddingInput,
  OpenAiEmbedder,
} from './embedder';

const reply = (status: number, body: unknown) =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );

describe('the OpenAI embedder (T-016)', () => {
  it('names its version after what the vector depends on: the input and the width', () => {
    const e = new OpenAiEmbedder('sk-test', 'text-embedding-3-small', 3, reply(200, {}));
    expect([e.model, e.version]).toEqual([
      'text-embedding-3-small',
      `${EMBEDDING_INPUT_REVISION}/3d`,
    ]);
  });

  it('embeds a chunk from its heading and its content', () => {
    expect(embeddingInput({ heading: 'Can I?', content: 'Yes.' })).toBe('Can I?\n\nYes.');
  });

  it('sends the texts, the model and the width, and returns vectors in the order asked', async () => {
    const http = reply(200, {
      data: [
        { index: 1, embedding: [0, 1, 0] },
        { index: 0, embedding: [1, 0, 0] },
      ],
    });
    const e = new OpenAiEmbedder('sk-test', 'm', 3, http);
    expect(await e.embed(['first', 'second'])).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer sk-test');
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'm',
      input: ['first', 'second'],
      dimensions: 3,
    });
  });

  it('makes no request for nothing', async () => {
    const http = reply(200, {});
    expect(await new OpenAiEmbedder('sk-test', 'm', 3, http).embed([])).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it('reports a failure by its status alone — the body may echo the request', async () => {
    const http = reply(401, { error: { message: 'Incorrect API key provided: sk-test' } });
    const failure = new OpenAiEmbedder('sk-test', 'm', 3, http).embed(['x']);
    await expect(failure).rejects.toThrow('embedding request failed: HTTP 401');
    await expect(failure).rejects.not.toThrow(/sk-test/);
  });

  it.each([
    ['too few vectors', { data: [] }],
    ['a vector of the wrong width', { data: [{ index: 0, embedding: [1, 0] }] }],
  ])('refuses a response with %s rather than store it', async (_label, body) => {
    await expect(
      new OpenAiEmbedder('sk-test', 'm', 3, reply(200, body)).embed(['x']),
    ).rejects.toThrow('embedding response did not match the request');
  });

  it('fails as a provider failure, so a caller can tell an outage from a bug', async () => {
    await expect(
      new OpenAiEmbedder('sk-test', 'm', 3, reply(503, {})).embed(['x']),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('is configured by a key, with the small model at the table’s width unless another is named', () => {
    expect(embedderFromEnv({})).toBeNull();
    expect(embedderFromEnv({ OPENAI_API_KEY: '' })).toBeNull();
    expect(embedderFromEnv({ OPENAI_API_KEY: 'sk-test' })).toMatchObject({
      model: 'text-embedding-3-small',
      version: `${EMBEDDING_INPUT_REVISION}/1536d`,
    });
    expect(
      embedderFromEnv({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
      })?.model,
    ).toBe('text-embedding-3-large');
  });
});
