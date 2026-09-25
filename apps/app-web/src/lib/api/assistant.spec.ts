import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { aiMessage, aiReply, aiSession, emptyPage } from '@/test/fixtures';
import { assistantApi, knowledgeReply, sseParser, type TurnEvent } from './assistant';
import { ApiError } from './errors';

const ID = aiSession().id;

describe('reading server-sent events (T-056)', () => {
  it('completes an event only at its blank line, however the text is cut', () => {
    const parse = sseParser();
    expect(parse('event: step\ndata: {"step":{"st')).toEqual([]);
    expect(parse('ep":"searching"}}\n')).toEqual([]);
    expect(parse('\nevent: done\ndata: {}\n\n')).toEqual([
      { type: 'step', step: { step: 'searching' } },
      { type: 'done' },
    ]);
  });

  it('reads CRLF line ends, joins data lines, and takes an event with no data or name', () => {
    const parse = sseParser();
    expect(parse('event: session\r\ndata: {"session":\r\ndata: {"id":"s"}}\r\n\r\n')).toEqual([
      { type: 'session', session: { id: 's' } },
    ]);
    expect(parse(': a comment\nevent: done\n\n')).toEqual([{ type: 'done' }]);
    expect(parse('data: {"x":1}\n\n')).toEqual([{ type: 'message', x: 1 }]);
  });
});

describe('the assistant API from the browser', () => {
  beforeEach(() => api.install());

  it('reads the latest conversation, or none', async () => {
    const client = assistantApi(null);
    api.on('GET /ai/sessions?limit=1', 200, { ...emptyPage, items: [aiSession()] });
    expect(await client.latest()).toEqual(aiSession());
    api.on('GET /ai/sessions?limit=1', 200, emptyPage);
    expect(await client.latest()).toBeNull();
    expect(api.calls[0]).toMatchObject({ origin: '', headers: {} });
    expect(api.calls[0]!.init.credentials).toBe('same-origin');
  });

  it('sends the role the reader acts as, and a JSON body only with a body', async () => {
    api.on('POST /ai/sessions', 201, aiSession());
    api.on('GET /workspaces', 200, []);
    const client = assistantApi('CUSTOMER');
    await client.create();
    await client.workspaces();
    expect(api.calls.map((c) => [c.method, c.path, c.headers, c.body])).toEqual([
      [
        'POST',
        '/ai/sessions',
        { 'content-type': 'application/json', 'x-active-role': 'CUSTOMER' },
        {},
      ],
      ['GET', '/workspaces', { 'x-active-role': 'CUSTOMER' }, undefined],
    ]);
  });

  it('reads a conversation from its end backwards, a page at a time, in reading order (T-057)', async () => {
    const client = assistantApi(null);
    api.on(`GET /ai/sessions/${ID}/messages?order=newest&limit=30`, 200, {
      items: [aiReply(), aiMessage()],
      pageInfo: { nextCursor: 'c/1', hasNextPage: true },
    });
    expect(await client.page(ID)).toEqual({ items: [aiMessage(), aiReply()], earlier: 'c/1' });
    api.on(`GET /ai/sessions/${ID}/messages?order=newest&limit=30&cursor=c%2F1`, 200, emptyPage);
    expect(await client.page(ID, 'c/1')).toEqual({ items: [], earlier: null });
  });

  it('lists, searches, opens and changes conversations — a delete answering with nothing', async () => {
    const client = assistantApi(null);
    const archived = aiSession({ status: 'ARCHIVED' });
    api.on('GET /ai/sessions?archived=false&limit=20', 200, { ...emptyPage, items: [aiSession()] });
    api.on('GET /ai/sessions?archived=true&limit=20&cursor=a%2F2', 200, {
      ...emptyPage,
      items: [archived],
    });
    api.on('GET /ai/sessions/search?q=quote%20%26%20fees', 200, [
      { ...aiSession(), firstMatchSequence: 3 },
    ]);
    api.on(`GET /ai/sessions/${ID}`, 200, aiSession());
    api.on(`PATCH /ai/sessions/${ID}`, 200, aiSession({ title: 'Fees' }));
    api.on(`POST /ai/sessions/${ID}/archive`, 200, archived);
    api.on(`POST /ai/sessions/${ID}/resume`, 200, aiSession());
    api.on(`DELETE /ai/sessions/${ID}`, 204);

    expect((await client.list(false)).items).toEqual([aiSession()]);
    expect((await client.list(true, 'a/2')).items).toEqual([archived]);
    expect(await client.search('quote & fees')).toEqual([{ ...aiSession(), firstMatchSequence: 3 }]);
    expect(await client.open(ID)).toEqual(aiSession());
    expect((await client.rename(ID, 'Fees')).title).toBe('Fees');
    expect((await client.archive(ID)).status).toBe('ARCHIVED');
    expect((await client.restore(ID)).status).toBe('ACTIVE');
    expect(await client.remove(ID)).toBeNull();
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ title: 'Fees' });
  });

  it('refuses in the API’s own words', async () => {
    api.on('GET /workspaces', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    await expect(assistantApi(null).workspaces()).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  describe('a turn', () => {
    const events: TurnEvent[] = [];
    const collect = (e: TurnEvent) => events.push(e);
    beforeEach(() => void (events.length = 0));

    it('asks, and hands over each event as it arrives', async () => {
      api.streamed(`POST /ai/sessions/${ID}/turns`, [
        { type: 'message', message: aiMessage() },
        { type: 'step', step: { step: 'searching' } },
        { type: 'done' },
      ]);
      await assistantApi('INVESTIGATOR').turn(
        ID,
        { content: 'Is a quote binding?' },
        collect,
        new AbortController().signal,
      );
      expect(events.map((e) => e.type)).toEqual(['message', 'step', 'done']);
      expect(api.calls[0]).toMatchObject({
        body: { content: 'Is a quote binding?' },
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          'x-active-role': 'INVESTIGATOR',
        },
      });
    });

    it('retries the unanswered question, sending nothing of its own', async () => {
      api.streamed(`POST /ai/sessions/${ID}/turns/retry`, [{ type: 'done' }]);
      await assistantApi(null).turn(ID, { retry: true }, collect, new AbortController().signal);
      expect(api.calls[0]!.body).toEqual({});
    });

    it('throws the refusal when a turn never started', async () => {
      api.on(
        `POST /ai/sessions/${ID}/turns`,
        503,
        apiError('SERVICE_UNAVAILABLE', 'error.common.service_unavailable'),
      );
      await expect(
        assistantApi(null).turn(ID, { content: 'q?' }, collect, new AbortController().signal),
      ).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
      expect(events).toEqual([]);
    });

    it('treats a reply with no body as a connection failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 200 })),
      );
      await expect(
        assistantApi(null).turn(ID, { content: 'q?' }, collect, new AbortController().signal),
      ).rejects.toEqual(new ApiError(0, 'NETWORK', 'error.common.internal'));
    });

    it('stops reading when stopped, rejecting as an abort', async () => {
      const stream = api.stream(`POST /ai/sessions/${ID}/turns`);
      const stop = new AbortController();
      const turn = assistantApi(null).turn(ID, { content: 'q?' }, collect, stop.signal);
      stream.send({ type: 'step', step: { step: 'searching' } });
      await vi.waitFor(() => expect(events).toHaveLength(1));
      stop.abort();
      await expect(turn).rejects.toMatchObject({ name: 'AbortError' });
      expect(stream.aborted).toBe(true);
    });
  });
});

describe('a knowledge reply', () => {
  it('is recognised by its metadata, and nothing else is one', () => {
    expect(knowledgeReply(aiReply())?.citations).toHaveLength(1);
    expect(knowledgeReply(aiMessage())).toBeNull();
  });
});
