import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiMessage, AssistantApi, Plan } from '@/lib/api/assistant';
import { ApiError } from '@/lib/api/errors';
import { useConversation } from './use-conversation';
import { POLL_MS, usePlans } from './use-plans';

/** A reply the spec settles itself, to answer late — after the reader moved on. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const S1 = '00000000-0000-4000-8000-0000000000d1';
const S2 = '00000000-0000-4000-8000-0000000000d2';

const plan = (id: string, over: Partial<Plan> = {}): Plan => ({
  id,
  sessionId: S1,
  planHash: 'a'.repeat(64),
  status: 'PROPOSED',
  confirmation: 'PENDING',
  reason: null,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  confirmedAt: null,
  finishedAt: null,
  createdAt: new Date().toISOString(),
  steps: [],
  ...over,
});

const fakeApi = (over: Partial<AssistantApi> = {}) =>
  ({
    openPlans: vi.fn(),
    plan: vi.fn(),
    confirm: vi.fn(),
    decline: vi.fn(),
    page: vi.fn(),
    ...over,
  }) as unknown as AssistantApi & {
    openPlans: ReturnType<typeof vi.fn>;
    plan: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    decline: ReturnType<typeof vi.fn>;
    page: ReturnType<typeof vi.fn>;
  };

/** The hook on conversation `S1`, which can be moved to another conversation with `rerender`. */
const mount = (api: ReturnType<typeof fakeApi>, onEnded = vi.fn()) =>
  renderHook(({ id }: { id: string | null }) => usePlans(api, id, onEnded), {
    initialProps: { id: S1 as string | null },
  });

describe('the plans of the open conversation (T-058)', () => {
  afterEach(() => vi.useRealTimers());

  it('answers one plan and leaves the others as they were', async () => {
    const api = fakeApi();
    api.openPlans.mockResolvedValue([plan('p1'), plan('p2')]);
    api.confirm.mockResolvedValue(plan('p1', { status: 'CONFIRMED', confirmation: 'CONFIRMED' }));
    const { result } = mount(api);
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await act(() => result.current.confirm('p1'));
    expect(result.current.entries.map((e) => [e.plan.id, e.plan.status])).toEqual([
      ['p1', 'CONFIRMED'],
      ['p2', 'PROPOSED'],
    ]);
  });

  it('keeps what the person is doing to a plan when the list is read again', async () => {
    const api = fakeApi();
    api.openPlans.mockResolvedValue([plan('p1')]);
    const pending = later<Plan>();
    api.confirm.mockReturnValue(pending.promise);
    const { result } = mount(api);
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    act(() => {
      void result.current.confirm('p1');
    });
    await waitFor(() => expect(result.current.entries[0]!.acting).toBe('confirm'));

    api.openPlans.mockResolvedValue([plan('p1', { reason: null })]);
    await act(() => result.current.refresh());
    expect(result.current.entries[0]!.acting).toBe('confirm');
    await act(async () =>
      pending.resolve(plan('p1', { status: 'CONFIRMED', confirmation: 'CONFIRMED' })),
    );
  });

  it('sends one answer however often it is asked, and none for a plan it does not hold', async () => {
    const api = fakeApi();
    api.openPlans.mockResolvedValue([plan('p1')]);
    const pending = later<Plan>();
    api.confirm.mockReturnValue(pending.promise);
    const { result } = mount(api);
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    act(() => {
      void result.current.confirm('p1');
    });
    await waitFor(() => expect(result.current.entries[0]!.acting).toBe('confirm'));
    await act(() => result.current.confirm('p1'));
    await act(() => result.current.decline('p1'));
    await act(() => result.current.confirm('nobody'));
    expect(api.confirm).toHaveBeenCalledTimes(1);
    expect(api.decline).not.toHaveBeenCalled();
    await act(async () =>
      pending.resolve(plan('p1', { status: 'CONFIRMED', confirmation: 'CONFIRMED' })),
    );
  });

  describe('ignores what arrives for a conversation no longer open', () => {
    it('a list', async () => {
      const api = fakeApi();
      const first = later<Plan[]>();
      api.openPlans.mockReturnValueOnce(first.promise).mockResolvedValue([]);
      const { result, rerender } = mount(api);
      rerender({ id: S2 });
      await act(async () => first.resolve([plan('p1')]));
      expect(result.current.entries).toEqual([]);
    });

    it('a list that could not be read', async () => {
      const api = fakeApi();
      const first = later<Plan[]>();
      api.openPlans.mockReturnValueOnce(first.promise).mockResolvedValue([]);
      const { result, rerender } = mount(api);
      rerender({ id: S2 });
      await act(async () => first.reject(new Error('down')));
      expect(result.current.failed).toBe(false);
    });

    it('a running plan read again', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      const api = fakeApi();
      api.openPlans.mockResolvedValueOnce([
        plan('p1', { status: 'EXECUTING', confirmation: 'CONFIRMED' }),
      ]);
      api.openPlans.mockResolvedValue([]);
      const read = later<Plan>();
      api.plan.mockReturnValue(read.promise);
      const onEnded = vi.fn();
      const { result, rerender } = mount(api, onEnded);
      await waitFor(() => expect(result.current.entries).toHaveLength(1));
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      expect(api.plan).toHaveBeenCalledTimes(1);
      rerender({ id: S2 });
      await act(async () =>
        read.resolve(plan('p1', { status: 'COMPLETED', confirmation: 'CONFIRMED' })),
      );
      expect(onEnded).not.toHaveBeenCalled();
    });

    it.each([
      [
        'an answer',
        (p: ReturnType<typeof later<Plan>>) => p.resolve(plan('p1', { status: 'CONFIRMED' })),
      ],
      [
        'a refusal',
        (p: ReturnType<typeof later<Plan>>) => p.reject(new ApiError(409, 'STATE_CONFLICT', 'x')),
      ],
    ])('%s to the person’s confirmation', async (_what, settle) => {
      const api = fakeApi();
      api.openPlans.mockResolvedValueOnce([plan('p1')]).mockResolvedValue([]);
      const answer = later<Plan>();
      api.confirm.mockReturnValue(answer.promise);
      const onEnded = vi.fn();
      const { result, rerender } = mount(api, onEnded);
      await waitFor(() => expect(result.current.entries).toHaveLength(1));
      act(() => {
        void result.current.confirm('p1');
      });
      await waitFor(() => expect(api.confirm).toHaveBeenCalled());
      rerender({ id: S2 });
      await act(async () => settle(answer));
      expect(api.plan).not.toHaveBeenCalled();
      expect(onEnded).not.toHaveBeenCalled();
      expect(result.current.entries).toEqual([]);
    });

    it('the plan read again after a refusal', async () => {
      const api = fakeApi();
      api.openPlans.mockResolvedValueOnce([plan('p1')]).mockResolvedValue([]);
      api.confirm.mockRejectedValue(new ApiError(409, 'STATE_CONFLICT', 'x'));
      const read = later<Plan>();
      api.plan.mockReturnValue(read.promise);
      const onEnded = vi.fn();
      const { result, rerender } = mount(api, onEnded);
      await waitFor(() => expect(result.current.entries).toHaveLength(1));
      act(() => {
        void result.current.confirm('p1');
      });
      await waitFor(() => expect(api.plan).toHaveBeenCalled());
      rerender({ id: S2 });
      await act(async () => read.resolve(plan('p1', { status: 'CANCELLED' })));
      expect(onEnded).not.toHaveBeenCalled();
      expect(result.current.entries).toEqual([]);
    });
  });
});

describe('reading how plans ended into the conversation (T-058)', () => {
  const outcome = { id: 'o1', sequence: 2, role: 'SYSTEM', kind: 'PLAN_OUTCOME' } as AiMessage;

  it('reads nothing while no conversation is open', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useConversation(api));
    await act(() => result.current.readOutcomes());
    expect(api.page).not.toHaveBeenCalled();
  });

  it('adds only the outcome messages, and nothing that arrives once the reader moved on', async () => {
    const api = fakeApi({
      open: vi.fn().mockResolvedValue({ id: S1, title: null, status: 'ACTIVE' }),
      workspaces: vi.fn().mockResolvedValue([]),
    } as Partial<AssistantApi>);
    api.page.mockResolvedValue({
      items: [{ id: 'q1', sequence: 1, role: 'USER', kind: 'TEXT', content: 'Hi' } as AiMessage],
      earlier: null,
    });
    const { result } = renderHook(() => useConversation(api));
    await act(() => result.current.openById(S1));
    expect(result.current.state.messages.map((m) => m.id)).toEqual(['q1']);

    api.page.mockResolvedValueOnce({
      items: [
        { id: 'q1', sequence: 1, role: 'USER', kind: 'TEXT', content: 'Hi' } as AiMessage,
        {
          id: 'x9',
          sequence: 3,
          role: 'USER',
          kind: 'TEXT',
          content: 'Not yet shown',
        } as AiMessage,
        outcome,
      ],
      earlier: null,
    });
    await act(() => result.current.readOutcomes());
    expect(result.current.state.messages.map((m) => m.id)).toEqual(['q1', 'o1']);

    // Read, then the reader starts afresh before it answers: nothing is added.
    const late = later<{ items: AiMessage[]; earlier: null }>();
    api.page.mockReturnValueOnce(late.promise);
    let reading!: Promise<void>;
    act(() => {
      reading = result.current.readOutcomes();
    });
    act(() => result.current.startNew());
    await act(async () => {
      late.resolve({ items: [{ ...outcome, id: 'o2' }], earlier: null });
      await reading;
    });
    expect(result.current.state.messages).toEqual([]);

    // And a page that cannot be read adds nothing and says nothing.
    await act(() => result.current.openById(S1));
    api.page.mockRejectedValueOnce(new Error('down'));
    await act(() => result.current.readOutcomes());
    expect(result.current.state.messages.map((m) => m.id)).toEqual(['q1']);
  });
});
