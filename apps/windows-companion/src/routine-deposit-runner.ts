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
    | 'executeRoutineOneUseDeposit'
    | 'isSignedInVerified'
    | 'pauseForReview'
    | 'stop'
  >;
  readonly idleDelayMs?: number;
  readonly report?: (result: RoutineDepositWorkerResult) => void;
  /** Runs after an empty lease, contained uncertainty, or a failed pre-lease request. */
  readonly runReadOnlyIdleWorkOnce?: () => Promise<unknown>;
}

/** Explicitly invoked, never started by the read-only/v2 entry points. No deposit-count limit. */
export function startRoutineDepositQueue(options: RoutineDepositQueueOptions) {
  // This is only the empty-queue delay. Browser work remains serial and a
  // completed/fenced credit still follows the one-use modal confirmation path.
  const idleDelayMs = options.idleDelayMs ?? 500;
  if (!Number.isSafeInteger(idleDelayMs) || idleDelayMs < 100 || idleDelayMs > 60000) {
    throw new Error('Routine queue interval is invalid.');
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  if (options.signal.aborted) controller.abort();
  const worker = createRoutineDepositWorker({ ...options, signal: controller.signal });
  let reviewHeld = false;
  const done = (async (): Promise<RoutineDepositWorkerResult> => {
    let consecutiveUnavailable = 0;
    let lastLeaseWasIdle = false;
    try {
      while (!controller.signal.aborted) {
        // A signed launch proof does not mean KemerBet is still authenticated. Stop claiming
        // work when its page returns to login; verified payments remain queued in the database.
        if (!options.session.isSignedInVerified()) {
          lastLeaseWasIdle = false;
          await delay(idleDelayMs, controller.signal);
          continue;
        }
        if (lastLeaseWasIdle && options.runReadOnlyIdleWorkOnce) {
          // A confirmed credit claims the next ready payment first. An empty lease
          // or durably contained uncertainty gives read-only Find a browser slot.
          lastLeaseWasIdle = false;
          await options.runReadOnlyIdleWorkOnce();
          if (controller.signal.aborted) break;
          if (!options.session.isSignedInVerified()) continue;
        }
        // The await is the execution sequence: confirmation finishes before the next run.
        const result = await worker.runOnce();
        lastLeaseWasIdle = result.status === 'idle' || result.status === 'contained';
        try {
          options.report?.(result);
        } catch {
          /* Reporting cannot authorize or retry a deposit. */
        }
        if (result.status === 'paused') {
          if (result.reason === 'operator_stopped') return result;
          // Do not hide the evidence surface, but permanently disarm this launch. The
          // database fence and pause remain authoritative; this cannot retry a credit.
          options.session.pauseForReview();
          reviewHeld = true;
          return result;
        }
        if (result.status === 'stopped') return result;
        if (result.status === 'temporarily_unavailable') {
          consecutiveUnavailable++;
          const backoffMs = Math.min(60_000, 5_000 * 2 ** Math.min(consecutiveUnavailable - 1, 4));
          if (result.readOnlyFindSafe === true && options.runReadOnlyIdleWorkOnce) {
            // A failed lease has not entered the browser or begun a Transfer. Keep Find
            // responsive during the financial retry delay without overlapping a credit.
            const retryAt = Date.now() + backoffMs;
            while (!controller.signal.aborted && Date.now() < retryAt) {
              if (options.session.isSignedInVerified()) await options.runReadOnlyIdleWorkOnce();
              if (controller.signal.aborted) break;
              await delay(Math.min(1_000, retryAt - Date.now()), controller.signal);
            }
          } else {
            await delay(backoffMs, controller.signal);
          }
          continue;
        }
        consecutiveUnavailable = 0;
        if (result.status !== 'completed') await delay(idleDelayMs, controller.signal);
      }
      return Object.freeze({ status: 'stopped' });
    } finally {
      controller.abort();
      options.signal.removeEventListener('abort', onAbort);
      // Closing Chrome is not permission to clear a durable fence/uncertain account lane.
      if (!reviewHeld) await options.session.stop();
    }
  })();
  // Always observe rejection (e.g. browser shutdown failed), while preserving it for the caller.
  void done.catch(() => undefined);
  return Object.freeze({
    done,
    async stop(): Promise<RoutineDepositWorkerResult> {
      controller.abort();
      const result = await done;
      if (reviewHeld) await options.session.stop();
      return result;
    },
  });
}
