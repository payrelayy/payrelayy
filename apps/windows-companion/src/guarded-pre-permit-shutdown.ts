import {
  guardedPrePermitChallengeDigest,
  guardedPrePermitStopped,
  isGuardedPrePermitStopRequest,
} from '@fetanagent/agent-platform-companion-execution-contracts';

export interface GuardedPrePermitShutdown {
  requested(): boolean;
  disarm(): void;
}

/**
 * Only the parent that launched this process with an IPC channel can request this stop.
 * It is armed only before a guarded execution permit is received. No acknowledgement is
 * sent unless the protected browser, its lock, and startup work have stopped cleanly.
 */
export function installGuardedPrePermitShutdown(
  endpoint: NodeJS.Process,
  challenge: string,
  abort: () => void,
  stopAndConfirm: () => Promise<void>,
): GuardedPrePermitShutdown {
  guardedPrePermitChallengeDigest(challenge);
  if (!endpoint.connected || typeof endpoint.send !== 'function') {
    throw new Error('The guarded local stop channel is unavailable.');
  }
  let active = true;
  let stopRequested = false;
  const remove = (): void => {
    active = false;
    endpoint.off('message', onMessage);
    endpoint.off('disconnect', onDisconnect);
  };
  const requestStop = (acknowledge: boolean): void => {
    if (!active) return;
    stopRequested = true;
    remove();
    abort();
    void (async () => {
      try {
        await stopAndConfirm();
        if (acknowledge) {
          await new Promise<void>((resolve, reject) => {
            if (!endpoint.connected || typeof endpoint.send !== 'function') {
              reject(new Error());
              return;
            }
            endpoint.send(guardedPrePermitStopped(challenge), (error) => {
              if (error) reject(new Error());
              else resolve();
            });
          });
        }
      } catch {
        // No clean-shutdown acknowledgement. The parent must fail and reconcile.
      } finally {
        try {
          if (endpoint.connected) endpoint.disconnect();
        } catch {
          // The channel may already have closed; no acknowledgement was fabricated.
        }
      }
    })();
  };
  const onMessage = (message: unknown): void => {
    if (active && isGuardedPrePermitStopRequest(message, challenge)) requestStop(true);
  };
  const onDisconnect = (): void => requestStop(false);
  endpoint.on('message', onMessage);
  endpoint.on('disconnect', onDisconnect);
  return Object.freeze({
    requested: () => stopRequested,
    disarm: remove,
  });
}
