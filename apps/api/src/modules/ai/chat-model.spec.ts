import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../common/errors/provider-error';
import { chatModelFromEnv, OpenAiChatModel } from './chat-model';

const reply = (status: number, body: unknown) =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );

describe('the OpenAI chat model (T-017)', () => {
  it('sends the instructions and the material as two messages, asking for JSON', async () => {
    const http = reply(200, {
      choices: [{ message: { content: '{"answer":null,"sources":[]}' } }],
    });
    const model = new OpenAiChatModel('sk-test', 'a-model', http);
    expect(await model.complete({ system: 'rules', user: 'material' })).toBe(
      '{"answer":null,"sources":[]}',
    );
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer sk-test');
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'a-model',
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'material' },
      ],
      response_format: { type: 'json_object' },
    });
    expect(init?.signal).toBeUndefined();
  });

  it('abandons the call when the signal it was given is aborted (T-056)', async () => {
    const http = reply(200, { choices: [{ message: { content: '{}' } }] });
    const stop = new AbortController();
    await new OpenAiChatModel('sk-test', 'm', http).complete(
      { system: 's', user: 'u' },
      stop.signal,
    );
    expect(http.mock.calls[0]![1]?.signal).toBe(stop.signal);
  });

  it('reports a failure by its status alone, as a provider failure', async () => {
    const http = reply(500, { error: { message: 'your question was: my home address' } });
    const failure = new OpenAiChatModel('sk-test', 'm', http).complete({ system: 's', user: 'u' });
    await expect(failure).rejects.toBeInstanceOf(ProviderError);
    await expect(failure).rejects.toThrow('chat request failed: HTTP 500');
    await expect(failure).rejects.not.toThrow(/address/);
  });

  it.each([
    ['no choices', {}],
    ['no message', { choices: [{}] }],
    ['content that is not text', { choices: [{ message: { content: 42 } }] }],
  ])('refuses a reply with %s', async (_label, body) => {
    await expect(
      new OpenAiChatModel('sk-test', 'm', reply(200, body)).complete({ system: 's', user: 'u' }),
    ).rejects.toThrow(new ProviderError('chat response had no content'));
  });

  it('is configured only with both a key and a model — there is no default model', () => {
    expect(chatModelFromEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_CHAT_MODEL: 'm' })?.model).toBe(
      'm',
    );
    expect(chatModelFromEnv({ OPENAI_API_KEY: 'sk-test' })).toBeNull();
    expect(chatModelFromEnv({ OPENAI_CHAT_MODEL: 'm' })).toBeNull();
    expect(chatModelFromEnv({ OPENAI_API_KEY: '', OPENAI_CHAT_MODEL: 'm' })).toBeNull();
  });
});
