import type { ChildProcess } from 'node:child_process';

import {
  guardedPrePermitChallengeDigest,
  guardedPrePermitStopRequest,
  isGuardedPrePermitStopped,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type { GuardedProcessRehearsalChild } from './guarded-process-launch-rehearsal.js';

export class GuardedPrePermitChildStopUnavailableError extends Error {
  constructor() {
    super('The guarded companion child could not be confirmed stopped.');
    this.name = 'GuardedPrePermitChildStopUnavailableError';
  }
}

/**
 * Binds only the exact already-spawned IPC child. Windows child.kill() is an
 * abrupt termination, so it is never treated as confirmation of browser and
 * profile-lock cleanup. This adapter does not launch, activate, or permit work.
 */
export function bindGuardedPrePermitChild(
  child: ChildProcess,
  challenge: string,
): GuardedProcessRehearsalChild {
  guardedPrePermitChallengeDigest(challenge);
  const processId = child.pid;
  if (!Number.isInteger(processId) || processId === undefined || processId < 1) {
    throw new GuardedPrePermitChildStopUnavailableError();
  }
  let closeCode: number | null | undefined;
  let closeSignal: NodeJS.Signals | null | undefined;
  const onSpawnError = (): void => undefined;
  child.on('error', onSpawnError);
  const stopped = new Promise<void>((resolve) => {
    child.once('close', (code, signal) => {
      closeCode = code;
      closeSignal = signal;
      child.off('error', onSpawnError);
      resolve();
    });
  });
  // A spawn error is followed by 'close'; observing it avoids an unhandled emitter error.
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      if (!child.connected || child.exitCode !== null || child.signalCode !== null) {
        throw new GuardedPrePermitChildStopUnavailableError();
      }
      let remove = (): void => undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          const fail = (): void => reject(new GuardedPrePermitChildStopUnavailableError());
          const onMessage = (message: unknown): void => {
            if (isGuardedPrePermitStopped(message, challenge)) resolve();
          };
          remove = () => {
            child.off('message', onMessage);
            child.off('close', fail);
          };
          child.on('message', onMessage);
          child.once('close', fail);
          try {
            child.send(guardedPrePermitStopRequest(challenge), (error) => {
              if (error) fail();
            });
          } catch {
            fail();
          }
        });
      } finally {
        remove();
      }
      await stopped;
      if (closeCode !== 0 || closeSignal !== null) {
        throw new GuardedPrePermitChildStopUnavailableError();
      }
    })();
    return stopPromise;
  };
  return Object.freeze({ processId, stopped, stop });
}
