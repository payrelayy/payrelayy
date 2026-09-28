import { COMPANION_EXECUTION_HANDOFF_SIGN_PATH } from '@fetanagent/agent-platform-companion-execution-contracts';

import { createProtectedHandoffLoopbackServer } from './protected-handoff-loopback-server.js';
import type {
  ProtectedHandoffHttpRequest,
  ProtectedHandoffHttpResponse,
} from './protected-handoff-request.js';
import { createProtectedOperatorQueryRequestHandler } from './protected-operator-query-request.js';
import {
  createProtectedOperatorQuerySession,
  type ProtectedOperatorQuerySessionInput,
} from './protected-operator-query-session.js';
import { PROTECTED_OPERATOR_QUERY_LOOPBACK_PORT } from './protected-operator-query-port.js';

const MAX_HOST_LIFETIME_MS = 2 * 60 * 60_000;
const RESPONSE_DRAIN_MS = 100;

export interface ProtectedOperatorQueryHostInput extends ProtectedOperatorQuerySessionInput {
  readonly trustedNoMoneySignerKeyId: string;
  readonly trustedNoMoneySignerPublicKeySpkiDer: Uint8Array;
  readonly trustedNow: () => Date;
  /** One server-owned signing operation before the finite query session opens. */
  readonly signHandoff?: (
    request: ProtectedHandoffHttpRequest,
  ) => Promise<ProtectedHandoffHttpResponse>;
  /** A caller-owned cancellation, independent of the Windows process. */
  readonly signal?: AbortSignal;
}

export interface ProtectedOperatorQueryHost {
  /** Only the host's loopback port. A separately authenticated tunnel is required. */
  readonly port: number;
  /** Resolves only after the listener and exact administrator session are closed. */
  readonly stopped: Promise<void>;
  stop(): Promise<void>;
}

export class ProtectedOperatorQueryHostUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The protected operator host could not be confirmed closed.');
    this.name = 'ProtectedOperatorQueryHostUnavailableError';
  }
}

/**
 * One on-demand protected-host lifecycle. This composes the existing finite
 * SQL session, paired-certificate request handler, and loopback-only listener.
 * It intentionally has no credential loader, network listener, SSH tunnel,
 * production CLI, or Windows-side administrator connection. Its caller must
 * own the independent database stop and the authenticated private tunnel.
 */
export async function openProtectedOperatorQueryHostWithPort(
  input: ProtectedOperatorQueryHostInput,
  port: number,
): Promise<ProtectedOperatorQueryHost> {
  let session: ReturnType<typeof createProtectedOperatorQuerySession> | undefined;
  let server: ReturnType<typeof createProtectedHandoffLoopbackServer> | undefined;
  let stopPromise: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let responseTimer: NodeJS.Timeout | undefined;
  let resolveStopped!: () => void;
  let rejectStopped!: (error: ProtectedOperatorQueryHostUnavailableError) => void;
  let signingState: 'pending' | 'succeeded' | 'failed' = input?.signHandoff
    ? 'pending'
    : 'succeeded';
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });
  void stopped.catch(() => undefined);

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    clearTimeout(timer);
    clearTimeout(responseTimer);
    input?.signal?.removeEventListener('abort', onAbort);
    stopPromise = (async () => {
      const results = await Promise.allSettled([
        server?.close() ?? Promise.resolve(),
        session?.close() ??
          (typeof input?.closeAdministrator === 'function'
            ? input.closeAdministrator()
            : Promise.resolve()),
      ]);
      if (results.some((result) => result.status === 'rejected'))
        throw new ProtectedOperatorQueryHostUnavailableError();
    })();
    void stopPromise.then(resolveStopped, () =>
      rejectStopped(new ProtectedOperatorQueryHostUnavailableError()),
    );
    return stopPromise;
  };
  const onAbort = (): void => {
    void stop().catch(() => undefined);
  };
  const retireAfterResponse = (): void => {
    if (!responseTimer)
      responseTimer = setTimeout(() => void stop().catch(() => undefined), RESPONSE_DRAIN_MS);
  };

  try {
    if (
      !input ||
      input.signal?.aborted ||
      typeof input.trustedNoMoneySignerKeyId !== 'string' ||
      input.trustedNoMoneySignerKeyId.length === 0 ||
      !(input.trustedNoMoneySignerPublicKeySpkiDer instanceof Uint8Array) ||
      input.trustedNoMoneySignerPublicKeySpkiDer.byteLength === 0 ||
      typeof input.trustedNow !== 'function'
    )
      throw new Error();
    session = createProtectedOperatorQuerySession(input);
    let sessionCloseRequested = false;
    const handler = createProtectedOperatorQueryRequestHandler({
      administrator: input.administrator,
      session: {
        ...session,
        async close() {
          sessionCloseRequested = true;
          await session!.close();
        },
      },
      requestKey: input.requestKey,
      trustedNoMoneySignerKeyId: input.trustedNoMoneySignerKeyId,
      trustedNoMoneySignerPublicKeySpkiDer: input.trustedNoMoneySignerPublicKeySpkiDer,
      trustedNow: input.trustedNow,
    });
    server = createProtectedHandoffLoopbackServer(async (request) => {
      if (request.path === COMPANION_EXECUTION_HANDOFF_SIGN_PATH) {
        if (signingState !== 'pending' || !input.signHandoff) {
          retireAfterResponse();
          throw new Error();
        }
        // A concurrent command cannot overtake the one-use signing response.
        signingState = 'failed';
        try {
          const signed = await input.signHandoff(request);
          if (signed.statusCode !== 200) {
            retireAfterResponse();
            return signed;
          }
          signingState = 'succeeded';
          return signed;
        } catch {
          retireAfterResponse();
          throw new Error();
        }
      }
      if (signingState !== 'succeeded') {
        retireAfterResponse();
        throw new Error();
      }
      const response = await handler(request);
      if (sessionCloseRequested && !responseTimer) {
        // Let the loopback HTTP adapter write the terminal response first.
        retireAfterResponse();
      }
      return response;
    }, port);
    const listeningPort = await server.listen();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(onAbort, MAX_HOST_LIFETIME_MS);
    void session.lost.then(onAbort, onAbort);
    if (input.signal?.aborted) throw new Error();
    return Object.freeze({ port: listeningPort, stopped, stop });
  } catch {
    try {
      await stop();
    } catch {
      // The caller must still run its independent stop and host reconciliation.
    }
    throw new ProtectedOperatorQueryHostUnavailableError();
  }
}

/** Production accepts only the loopback port allowlisted by the operator's SSH key. */
export function openProtectedOperatorQueryHost(
  input: ProtectedOperatorQueryHostInput,
): Promise<ProtectedOperatorQueryHost> {
  return openProtectedOperatorQueryHostWithPort(input, PROTECTED_OPERATOR_QUERY_LOOPBACK_PORT);
}
