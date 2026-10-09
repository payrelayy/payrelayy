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
    const session = { stop: vi.fn(async () => undefined), executeRoutineOneUseDeposit: vi.fn() };
    const options: RoutineDepositQueueOptions = {
      signal: controller.signal,
      session,
      store: {
        leaseNext: vi.fn(),
        fenceFinalAction: vi.fn(),
        recordDispatch: vi.fn(),
        reconcile: vi.fn(),
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
    expect(session.stop).toHaveBeenCalledTimes(1);
    await queue.stop();
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
    expect(session.stop).toHaveBeenCalledTimes(1);
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
    expect(session.stop).toHaveBeenCalledTimes(1);
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
