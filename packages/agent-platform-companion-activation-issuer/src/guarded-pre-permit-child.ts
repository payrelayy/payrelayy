import type { ChildProcess } from 'node:child_process';

import {
  guardedPrePermitChallengeDigest,
  guardedPrePermitStopRequest,
  guardedRuntimeStopRequest,
  isGuardedPrePermitStopped,
  isGuardedRuntimeStopped,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type { GuardedProcessRehearsalChild } from './guarded-process-launch-rehearsal.js';

const STOP_WAIT_MS = 10_000;

export interface GuardedCompanionHostStopResult {
  readonly processStopped: true;
  /** A clean host exit cannot establish what the provider did after the final-action fence. */
  readonly providerOutcomeRequiresReconciliation: true;
}

export interface GuardedCompanionOwnedChild extends GuardedProcessRehearsalChild {
  /** Stop the exact child if a permit may have been sent; never retry on uncertainty. */
  stopAfterPermit(): Promise<GuardedCompanionHostStopResult>;
}

export class GuardedPrePermitChildStopUnavailableError extends Error {
  constructor() {
    super('The guarded companion child could not be confirmed stopped.');
    this.name = 'GuardedPrePermitChildStopUnavailableError';
  }
}

/**
 * Binds only the exact already-spawned IPC child. Windows child.kill() is an
 * abrupt termination, so it is never treated as confirmation of browser and
 * profile-lock cleanup. A post-permit acknowledgement and exact clean exit prove
 * only that this host process stopped, not the provider outcome. This adapter
 * does not launch, activate, permit work, revoke database credentials, or
 * reconcile an in-flight provider action.
 */
export function bindGuardedPrePermitChild(
  child: ChildProcess,
  challenge: string,
): GuardedCompanionOwnedChild {
  guardedPrePermitChallengeDigest(challenge);
  const processId = child.pid;
  if (!Number.isInteger(processId) || processId === undefined || processId < 1) {
    throw new GuardedPrePermitChildStopUnavailableError();
  }
  const onSpawnError = (): void => undefined;
  child.on('error', onSpawnError);
  const stopped = new Promise<void>((resolve) => {
    child.once('close', () => {
      child.off('error', onSpawnError);
      resolve();
    });
  });
  // A spawn error is followed by 'close'; observing it avoids an unhandled emitter error.
  let stopKind: 'pre_permit' | 'runtime' | undefined;
  let stopPromise: Promise<void> | undefined;
  const stopWith = (kind: 'pre_permit' | 'runtime'): Promise<void> => {
    if (stopKind !== undefined && stopKind !== kind) {
      return Promise.reject(new GuardedPrePermitChildStopUnavailableError());
    }
    if (stopPromise) return stopPromise;
    stopKind = kind;
    stopPromise = (async () => {
      let remove = (): void => undefined;
      try {
        if (!child.connected || child.exitCode !== null || child.signalCode !== null) {
          throw new Error();
        }
        await new Promise<void>((resolve, reject) => {
          let acknowledged = false;
          const fail = (): void => reject(new Error());
          const onMessage = (message: unknown): void => {
            if (
              kind === 'pre_permit'
                ? isGuardedPrePermitStopped(message, challenge)
                : isGuardedRuntimeStopped(message, challenge)
            ) {
              acknowledged = true;
            }
          };
          const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
            if (acknowledged && code === 0 && signal === null) resolve();
            else fail();
          };
          const timer = setTimeout(fail, STOP_WAIT_MS);
          remove = () => {
            clearTimeout(timer);
            child.off('message', onMessage);
            child.off('close', onClose);
          };
          child.on('message', onMessage);
          child.once('close', onClose);
          try {
            child.send(
              kind === 'pre_permit'
                ? guardedPrePermitStopRequest(challenge)
                : guardedRuntimeStopRequest(challenge),
              (error) => {
                if (error) fail();
              },
            );
          } catch {
            fail();
          }
        });
        await stopped;
      } catch {
        throw new GuardedPrePermitChildStopUnavailableError();
      } finally {
        remove();
      }
    })();
    return stopPromise;
  };
  return Object.freeze({
    processId,
    stopped,
    stop: () => stopWith('pre_permit'),
    stopAfterPermit: async () => {
      await stopWith('runtime');
      return Object.freeze({
        processStopped: true,
        providerOutcomeRequiresReconciliation: true,
      });
    },
  });
}
