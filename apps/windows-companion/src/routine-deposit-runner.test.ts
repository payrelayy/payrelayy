import { afterEach, describe, expect, it, vi } from 'vitest';

const selected = vi.hoisted(() => ({ runOnce: vi.fn() }));
vi.mock('./routine-deposit-worker.js', () => ({ createRoutineDepositWorker: () => selected }));

import {
  startRoutineDepositQueue,
  type RoutineDepositQueueOptions,
} from './routine-deposit-runner.js';

describe('automatic routine queue loop', () => {
  afterEach(() => {
    vi.useRealTimers();
    selected.runOnce.mockReset();
  });

  function fixture() {
    const controller = new AbortController();
    const session = {
      stop: vi.fn(async () => undefined),
      pauseForReview: vi.fn(),
      executeRoutineOneUseDeposit: vi.fn(),
      scanRoutineDepositHistory: vi.fn(),
      isSignedInVerified: vi.fn(() => true),
    };
    const options: RoutineDepositQueueOptions = {
      signal: controller.signal,
      session,
      store: {
        leaseNext: vi.fn(),
        fenceFinalAction: vi.fn(),
        recordDispatch: vi.fn(),
        reconcile: vi.fn(),
        confirmHistory: vi.fn(),
        completeConfirmed: vi.fn(),
        pause: vi.fn(),
      },
      idleDelayMs: 100,
    };
    return { controller, session, options };
  }

  it('automatically processes confirmed jobs in order and stops immediately on uncertainty', async () => {
    const { options, session } = fixture();
    selected.runOnce
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ status: 'paused', reason: 'reconciliation_uncertain' });
    const queue = startRoutineDepositQueue(options);
    await expect(queue.done).resolves.toEqual({
      status: 'paused',
      reason: 'reconciliation_uncertain',
    });
    expect(selected.runOnce).toHaveBeenCalledTimes(3);
    expect(session.pauseForReview).toHaveBeenCalledTimes(1);
    expect(session.stop).not.toHaveBeenCalled();
    await queue.stop();
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(selected.runOnce).toHaveBeenCalledTimes(3);
  });

  it('does not poll or overlap while the previous workflow is awaiting completion', async () => {
    const { options, session } = fixture();
    let resolve!: (result: { status: 'completed' }) => void;
    selected.runOnce
      .mockImplementationOnce(
        () =>
          new Promise((complete) => {
            resolve = complete;
          }),
      )
      .mockResolvedValueOnce({ status: 'paused', reason: 'execution_uncertain' });
    const queue = startRoutineDepositQueue(options);
    await Promise.resolve();
    await Promise.resolve();
    expect(selected.runOnce).toHaveBeenCalledTimes(1);
    resolve({ status: 'completed' });
    await queue.done;
    expect(selected.runOnce).toHaveBeenCalledTimes(2);
    expect(session.pauseForReview).toHaveBeenCalledTimes(1);
    expect(session.stop).not.toHaveBeenCalled();
  });

  it('runs one read-only Find only after an idle lease and before the next credit claim', async () => {
    const { options, session } = fixture();
    const order: string[] = [];
    let completeLookup!: () => void;
    selected.runOnce
      .mockImplementationOnce(async () => {
        order.push('financial_idle');
        return { status: 'idle' };
      })
      .mockImplementationOnce(async () => {
        order.push('financial_stop');
        return { status: 'paused', reason: 'operator_stopped' };
      });
    const runReadOnlyIdleWorkOnce = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('find_started');
          completeLookup = () => {
            order.push('find_completed');
            resolve();
          };
        }),
    );
    const queue = startRoutineDepositQueue({ ...options, runReadOnlyIdleWorkOnce });
    await vi.waitFor(() => expect(runReadOnlyIdleWorkOnce).toHaveBeenCalledOnce());
    expect(selected.runOnce).toHaveBeenCalledTimes(1);
    expect(session.stop).not.toHaveBeenCalled();
    completeLookup();
    await expect(queue.done).resolves.toEqual({ status: 'paused', reason: 'operator_stopped' });
    expect(order).toEqual(['financial_idle', 'find_started', 'find_completed', 'financial_stop']);
  });

  it('checks for a new Find at the next idle slot before another financial lease', async () => {
    vi.useFakeTimers();
    const { options } = fixture();
    const order: string[] = [];
    let queued = false;
    selected.runOnce
      .mockImplementationOnce(async () => {
        order.push('financial_idle');
        return { status: 'idle' };
      })
      .mockImplementationOnce(async () => {
        order.push('financial_stop');
        return { status: 'paused', reason: 'operator_stopped' };
      });
    const runReadOnlyIdleWorkOnce = vi.fn(async () => {
      order.push(queued ? 'find_processed' : 'find_empty');
    });
    const queue = startRoutineDepositQueue({ ...options, runReadOnlyIdleWorkOnce });
    await Promise.resolve();
    await Promise.resolve();
    expect(selected.runOnce).toHaveBeenCalledOnce();
    expect(runReadOnlyIdleWorkOnce).not.toHaveBeenCalled();
    queued = true;
    await vi.advanceTimersByTimeAsync(100);
    await expect(queue.done).resolves.toEqual({ status: 'paused', reason: 'operator_stopped' });
    expect(order).toEqual(['financial_idle', 'find_processed', 'financial_stop']);
  });

  it('does not run read-only work while a credit is completed, uncertain, or signed out', async () => {
    vi.useFakeTimers();
    const { options, session } = fixture();
    const runReadOnlyIdleWorkOnce = vi.fn(async () => undefined);
    selected.runOnce
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ status: 'awaiting_reconciliation' })
      .mockImplementationOnce(async () => {
        session.isSignedInVerified.mockReturnValue(false);
        return { status: 'idle' };
      });
    const queue = startRoutineDepositQueue({ ...options, runReadOnlyIdleWorkOnce });
    await vi.advanceTimersByTimeAsync(200);
    expect(selected.runOnce).toHaveBeenCalledTimes(3);
    expect(runReadOnlyIdleWorkOnce).not.toHaveBeenCalled();
    await queue.stop();
  });

  it('never claims another credit after stopping during an idle Find', async () => {
    const { options, controller } = fixture();
    let completeLookup!: () => void;
    selected.runOnce.mockResolvedValue({ status: 'idle' });
    const runReadOnlyIdleWorkOnce = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeLookup = resolve;
        }),
    );
    const queue = startRoutineDepositQueue({ ...options, runReadOnlyIdleWorkOnce });
    await vi.waitFor(() => expect(runReadOnlyIdleWorkOnce).toHaveBeenCalledOnce());
    controller.abort();
    completeLookup();
    await expect(queue.done).resolves.toEqual({ status: 'stopped' });
    expect(selected.runOnce).toHaveBeenCalledOnce();
  });

  it('processes a burst of 100 queued credits in one ordered lane', async () => {
    const { options } = fixture();
    const order: number[] = [];
    let active = 0;
    let peak = 0;
    selected.runOnce.mockImplementation(async () => {
      const sequence = order.length;
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      order.push(sequence);
      active--;
      return sequence < 100
        ? { status: 'completed' }
        : { status: 'paused', reason: 'operator_stopped' };
    });
    const queue = startRoutineDepositQueue(options);
    await expect(queue.done).resolves.toMatchObject({ status: 'paused' });
    expect(order).toEqual(Array.from({ length: 101 }, (_, index) => index));
    expect(peak).toBe(1);
  });

  it('cancels idle delay promptly and closes the browser once', async () => {
    vi.useFakeTimers();
    const { options, controller, session } = fixture();
    selected.runOnce.mockResolvedValue({ status: 'idle' });
    const queue = startRoutineDepositQueue({ ...options, idleDelayMs: 60000 });
    await Promise.resolve();
    controller.abort();
    await expect(queue.done).resolves.toEqual({ status: 'stopped' });
    expect(selected.runOnce).toHaveBeenCalledTimes(1);
    expect(session.pauseForReview).not.toHaveBeenCalled();
    expect(session.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps Chrome open through an idle database outage and backs off before retrying', async () => {
    vi.useFakeTimers();
    const { options, session } = fixture();
    selected.runOnce
      .mockResolvedValueOnce({ status: 'temporarily_unavailable' })
      .mockResolvedValueOnce({ status: 'idle' })
      .mockResolvedValueOnce({ status: 'paused', reason: 'operator_stopped' });
    const queue = startRoutineDepositQueue(options);
    await Promise.resolve();
    expect(selected.runOnce).toHaveBeenCalledTimes(1);
    expect(session.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(selected.runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(selected.runOnce).toHaveBeenCalledTimes(2);
    expect(session.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await expect(queue.done).resolves.toEqual({ status: 'paused', reason: 'operator_stopped' });
    expect(session.pauseForReview).not.toHaveBeenCalled();
    expect(session.stop).toHaveBeenCalledTimes(1);
  });

  it('does not lease a Player credit while KemerBet is signed out, then resumes in order', async () => {
    vi.useFakeTimers();
    const { options, session } = fixture();
    session.isSignedInVerified.mockReturnValue(false);
    selected.runOnce.mockResolvedValueOnce({ status: 'paused', reason: 'operator_stopped' });
    const queue = startRoutineDepositQueue(options);
    await vi.advanceTimersByTimeAsync(500);
    expect(selected.runOnce).not.toHaveBeenCalled();
    session.isSignedInVerified.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(100);
    await expect(queue.done).resolves.toEqual({ status: 'paused', reason: 'operator_stopped' });
    expect(selected.runOnce).toHaveBeenCalledTimes(1);
    expect(session.pauseForReview).not.toHaveBeenCalled();
    expect(session.stop).toHaveBeenCalledTimes(1);
  });

  it('cannot turn a reporting error into a retry or lose the shutdown', async () => {
    const { options, session } = fixture();
    selected.runOnce.mockResolvedValue({ status: 'paused', reason: 'confirmation_mismatch' });
    const queue = startRoutineDepositQueue({
      ...options,
      report: () => {
        throw new Error('report failed');
      },
    });
    await expect(queue.done).resolves.toMatchObject({ status: 'paused' });
    expect(selected.runOnce).toHaveBeenCalledTimes(1);
    expect(session.pauseForReview).toHaveBeenCalledTimes(1);
    expect(session.stop).not.toHaveBeenCalled();
  });

  it('does not start an already-aborted queue', async () => {
    const { options, controller, session } = fixture();
    controller.abort();
    await expect(startRoutineDepositQueue(options).done).resolves.toEqual({ status: 'stopped' });
    expect(selected.runOnce).not.toHaveBeenCalled();
    expect(session.stop).toHaveBeenCalledTimes(1);
  });

  it.each([0, 99, 60001, NaN, 100.5])(
    'rejects invalid poll interval %s before starting',
    (idleDelayMs) => {
      const { options } = fixture();
      expect(() => startRoutineDepositQueue({ ...options, idleDelayMs })).toThrow();
      expect(selected.runOnce).not.toHaveBeenCalled();
    },
  );
});
