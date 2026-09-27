import {
  guardedPrePermitChallengeDigest,
  guardedPrePermitStopped,
  guardedRuntimeStopped,
  isGuardedPrePermitStopRequest,
  isGuardedRuntimeStopRequest,
} from '@fetanagent/agent-platform-companion-execution-contracts';

export interface GuardedPrePermitShutdown {
  requested(): boolean;
  /** Keep the parent stop channel armed after permit; only the pre-permit frame is retired. */
  markPermitReceived(): void;
  disarm(): void;
}

/**
 * Only the parent that launched this process with an IPC channel can request this stop.
 * The listener stays armed through the execution worker lifetime. A pre-permit
 * request is accepted only before a permit; a runtime request is accepted both
 * before and after, avoiding a permit/stop race. Neither acknowledgement claims
 * that a provider action is settled. No acknowledgement is sent unless the
 * protected browser, profile lock, and worker have stopped cleanly.
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
  let permitReceived = false;
  const remove = (): void => {
    active = false;
    endpoint.off('message', onMessage);
    endpoint.off('disconnect', onDisconnect);
  };
  const requestStop = (acknowledgement: 'pre_permit' | 'runtime' | null): void => {
    if (!active) return;
    stopRequested = true;
    remove();
    abort();
    void (async () => {
      try {
        await stopAndConfirm();
        if (acknowledgement) {
          await new Promise<void>((resolve, reject) => {
            if (!endpoint.connected || typeof endpoint.send !== 'function') {
              reject(new Error());
              return;
            }
            const response =
              acknowledgement === 'pre_permit'
                ? guardedPrePermitStopped(challenge)
                : guardedRuntimeStopped(challenge);
            endpoint.send(response, (error) => {
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
    if (!active) return;
    if (isGuardedRuntimeStopRequest(message, challenge)) requestStop('runtime');
    else if (!permitReceived && isGuardedPrePermitStopRequest(message, challenge)) {
      requestStop('pre_permit');
    }
  };
  const onDisconnect = (): void => requestStop(null);
  endpoint.on('message', onMessage);
  endpoint.on('disconnect', onDisconnect);
  return Object.freeze({
    requested: () => stopRequested,
    markPermitReceived: () => {
      if (!active || stopRequested) throw new Error('The guarded companion stop channel closed.');
      permitReceived = true;
    },
    disarm: remove,
  });
}
