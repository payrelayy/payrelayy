import type { LocalKemerBetSession } from './local-kemerbet-session.js';
import {
  createRoutineDepositWorker,
  type RoutineDepositWorkerOptions,
  type RoutineDepositWorkerResult,
} from './routine-deposit-worker.js';

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export interface RoutineDepositQueueOptions extends Omit<RoutineDepositWorkerOptions, 'session'> {
  readonly session: Pick<
    LocalKemerBetSession,
    'executeRoutineOneUseDeposit' | 'isSignedInVerified' | 'stop'
  >;
  readonly idleDelayMs?: number;
  readonly report?: (result: RoutineDepositWorkerResult) => void;
}

/** Explicitly invoked, never started by the read-only/v2 entry points. No deposit-count limit. */
export function startRoutineDepositQueue(options: RoutineDepositQueueOptions) {
  const idleDelayMs = options.idleDelayMs ?? 1000;
  if (!Number.isSafeInteger(idleDelayMs) || idleDelayMs < 100 || idleDelayMs > 60000) {
    throw new Error('Routine queue interval is invalid.');
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  if (options.signal.aborted) controller.abort();
  const worker = createRoutineDepositWorker({ ...options, signal: controller.signal });
  const done = (async (): Promise<RoutineDepositWorkerResult> => {
    try {
      while (!controller.signal.aborted) {
        // A signed launch proof does not mean KemerBet is still authenticated. Stop claiming
        // work when its page returns to login; the database watchdog can close live gates.
        if (!options.session.isSignedInVerified()) {
          await delay(idleDelayMs, controller.signal);
          continue;
        }
        // The await is the execution sequence: reconciliation finishes before the next run.
        const result = await worker.runOnce();
        try {
          options.report?.(result);
        } catch {
          /* Reporting cannot authorize or retry a deposit. */
        }
        if (result.status === 'paused' || result.status === 'stopped') return result;
        if (result.status !== 'completed') await delay(idleDelayMs, controller.signal);
      }
      return Object.freeze({ status: 'stopped' });
    } finally {
      controller.abort();
      options.signal.removeEventListener('abort', onAbort);
      // Closing Chrome is not permission to clear a durable fence/uncertain account lane.
      await options.session.stop();
    }
  })();
  // Always observe rejection (e.g. browser shutdown failed), while preserving it for the caller.
  void done.catch(() => undefined);
  return Object.freeze({
    done,
    async stop(): Promise<RoutineDepositWorkerResult> {
      controller.abort();
      return done;
    },
  });
}
