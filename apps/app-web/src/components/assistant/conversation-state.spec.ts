import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { aiMessage, aiReply, aiSession } from '@/test/fixtures';
import {
  awaitingRetry,
  initialState,
  reduce,
  unsentQuestion,
  type Action,
  type ConversationState,
} from './conversation-state';

const run = (actions: Action[], from: ConversationState = initialState) =>
  actions.reduce(reduce, from);

const ready = run([{ type: 'loaded', session: aiSession(), messages: [] }]);
const unavailable = new ApiError(503, 'SERVICE_UNAVAILABLE', 'error.common.service_unavailable');
const question = aiMessage();

describe('a conversation’s state (T-056)', () => {
  it('loads, or says it could not', () => {
    const loading = run([{ type: 'load' }]);
    expect(loading.status).toBe('loading');
    const failed = run([{ type: 'load_failed', error: unavailable }], loading);
    expect([failed.status, failed.loadError]).toEqual(['failed', unavailable]);
    expect(run([{ type: 'load' }], failed).loadError).toBeNull();
    expect(run([{ type: 'loaded', session: null, messages: [question] }]).messages).toEqual([
      question,
    ]);
  });

  it('follows a turn: unsent question, stored, each step, the reply, done', () => {
    const steps = run(
      [
        { type: 'start', question: 'How long?', stored: false },
        { type: 'event', event: { type: 'message', message: question } },
        { type: 'event', event: { type: 'session', session: aiSession({ title: 'How long?' }) } },
        { type: 'event', event: { type: 'step', step: { step: 'searching' } } },
        { type: 'event', event: { type: 'step', step: { step: 'writing', sources: 2 } } },
      ],
      ready,
    );
    expect(steps.turn).toEqual({
      phase: 'running',
      question: 'How long?',
      stored: true,
      step: { step: 'writing', sources: 2 },
    });
    expect(steps.session?.title).toBe('How long?');
    const done = run(
      [
        { type: 'event', event: { type: 'message', message: aiReply() } },
        { type: 'event', event: { type: 'done' } },
      ],
      steps,
    );
    expect([done.turn, done.messages.map((m) => m.sequence)]).toEqual([null, [1, 2]]);
  });

  it('keeps one copy of a message, in its place, however often and in whatever order it comes', () => {
    const s = run(
      [
        { type: 'event', event: { type: 'message', message: aiReply() } },
        { type: 'event', event: { type: 'message', message: question } },
        { type: 'event', event: { type: 'message', message: aiReply() } },
      ],
      ready,
    );
    expect(s.messages.map((m) => m.sequence)).toEqual([1, 2]);
  });

  it('ignores steps and an end that belong to no running turn', () => {
    for (const event of [
      { type: 'step', step: { step: 'searching' } },
      { type: 'done' },
    ] as const) {
      expect(run([{ type: 'event', event }], ready)).toBe(ready);
    }
    // An assistant message never marks a question stored.
    const s = run(
      [
        { type: 'start', question: 'q', stored: false },
        { type: 'event', event: { type: 'message', message: aiReply() } },
      ],
      ready,
    );
    expect(s.turn).toMatchObject({ stored: false });
  });

  it('keeps an unsent question when stopped or refused before storing, and not after', () => {
    const unsent = run([{ type: 'start', question: 'q', stored: false }], ready);
    expect(run([{ type: 'stopped' }], unsent).turn).toEqual({ phase: 'stopped', unsent: 'q' });
    expect(run([{ type: 'failed', error: unavailable }], unsent).turn).toEqual({
      phase: 'failed',
      error: unavailable,
      unsent: 'q',
    });
    const stored = run([{ type: 'start', question: '', stored: true }], ready);
    expect(run([{ type: 'stopped' }], stored).turn).toEqual({ phase: 'stopped', unsent: null });
  });

  it('turns an error in the stream into a failure with the reference support needs', () => {
    const s = run(
      [
        { type: 'start', question: 'q', stored: true },
        {
          type: 'event',
          event: {
            type: 'error',
            error: {
              code: 'SERVICE_UNAVAILABLE',
              messageKey: 'error.common.service_unavailable',
              correlationId: 'req-7',
            },
          },
        },
      ],
      ready,
    );
    expect(s.turn).toMatchObject({
      phase: 'failed',
      unsent: null,
      error: { status: 500, code: 'SERVICE_UNAVAILABLE', correlationId: 'req-7' },
    });
    expect(s.turn?.phase === 'failed' && s.turn.error).toBeInstanceOf(ApiError);
  });

  describe('reading back what the server holds', () => {
    it('learns a stopped question was stored after all, so trying again answers it', () => {
      const stopped = run(
        [{ type: 'start', question: question.content!, stored: false }, { type: 'stopped' }],
        ready,
      );
      const s = run([{ type: 'synced', messages: [question] }], stopped);
      expect([s.turn, s.messages]).toEqual([{ phase: 'stopped', unsent: null }, [question]]);
    });

    it('keeps it unsent when the server has something else last, or nothing', () => {
      const stopped = run(
        [{ type: 'start', question: 'Something else?', stored: false }, { type: 'stopped' }],
        ready,
      );
      expect(run([{ type: 'synced', messages: [question] }], stopped).turn).toEqual({
        phase: 'stopped',
        unsent: 'Something else?',
      });
      expect(run([{ type: 'synced', messages: [] }], stopped).turn).toEqual({
        phase: 'stopped',
        unsent: 'Something else?',
      });
      expect(run([{ type: 'synced', messages: [question, aiReply()] }], stopped).turn).toEqual({
        phase: 'stopped',
        unsent: 'Something else?',
      });
    });

    it('ends a running turn — answered meanwhile elsewhere — and leaves no turn alone', () => {
      const running = run([{ type: 'start', question: '', stored: true }], ready);
      expect(run([{ type: 'synced', messages: [question, aiReply()] }], running).turn).toBeNull();
      expect(run([{ type: 'synced', messages: [question] }], ready).turn).toBeNull();
      const failedStored = run(
        [
          { type: 'start', question: '', stored: true },
          { type: 'failed', error: unavailable },
        ],
        ready,
      );
      expect(run([{ type: 'synced', messages: [question] }], failedStored).turn).toMatchObject({
        phase: 'failed',
        unsent: null,
      });
    });
  });

  it('starts over empty and ready, with nothing carried from the last conversation', () => {
    const busy = run([{ type: 'start', question: 'q', stored: false }], ready);
    expect(run([{ type: 'reset' }], busy)).toEqual({ ...initialState, status: 'ready' });
  });

  describe('what can be tried again', () => {
    it('is nothing while a turn runs, or once the last word is the assistant’s', () => {
      expect(awaitingRetry(run([{ type: 'start', question: 'q', stored: false }], ready))).toBe(
        false,
      );
      expect(awaitingRetry(run([{ type: 'synced', messages: [question, aiReply()] }], ready))).toBe(
        false,
      );
      expect(awaitingRetry(ready)).toBe(false);
    });

    it('is an unsent question, or a stored one with no answer — from any path', () => {
      const unsent = run(
        [{ type: 'start', question: 'q', stored: false }, { type: 'stopped' }],
        ready,
      );
      expect([awaitingRetry(unsent), unsentQuestion(unsent)]).toEqual([true, 'q']);
      const fromHistory = run([{ type: 'loaded', session: aiSession(), messages: [question] }]);
      expect([awaitingRetry(fromHistory), unsentQuestion(fromHistory)]).toEqual([true, null]);
      const running = run([{ type: 'start', question: 'q', stored: false }], ready);
      expect(unsentQuestion(running)).toBeNull();
    });
  });
});
