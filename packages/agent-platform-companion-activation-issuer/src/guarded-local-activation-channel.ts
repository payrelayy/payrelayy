import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import {
  COMPANION_EXECUTION_LAUNCH_PROOF_PURPOSE,
  COMPANION_EXECUTION_LOCAL_PERMIT_ACK_PREFIX,
  COMPANION_EXECUTION_LOCAL_PERMIT_PREFIX,
  COMPANION_EXECUTION_LOCAL_EXPIRY_SAFETY_MARGIN_MS,
  COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS,
  type SignedCompanionExecutionLaunchProof,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  invokeCompanionActivationTransitionInternal,
  type CompanionActivationTransitionQuery,
} from './activation-transition.js';
import type { GuardedCompanionEmergencyStopRehearsalResult } from './guarded-emergency-stop-rehearsal.js';

const PIPE_PREFIX = '\\\\.\\pipe\\fetanagent-companion-launch-';
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RUNTIME_PASSWORD = /^[0-9a-f]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MAX_PROOF_BYTES = 2_048;
const MAX_ACK_BYTES = 192;
const PROOF_WAIT_MS = 90_000;
const COMMIT_WAIT_MS = 60_000;
const ACK_WAIT_MS = 15_000;
const WATCHDOG_READY_WAIT_MS = 15_000;

export const ATTESTATION_SQL = `select launch_proof_digest::text as proof_digest
  from app.agent_platform_companion_execution_activation_attestations
 where request_key = $1::uuid and session_user = 'postgres'`;

export class GuardedLocalActivationUnavailableError extends Error {
  constructor() {
    super('The guarded local activation channel is unavailable.');
    this.name = 'GuardedLocalActivationUnavailableError';
  }
}

export class GuardedLocalActivationUncertainError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The guarded local activation may have committed; stop and reconcile.');
    this.name = 'GuardedLocalActivationUncertainError';
  }
}

export interface GuardedLocalActivationCommitInput {
  readonly actorAuthUserId: string;
  readonly requestKey: string;
  /** The digest returned by independent release, handoff, certificate, and OS-process verification. */
  readonly verifiedProofDigest: string;
  readonly runtimePassword: string;
  readonly administrator: CompanionActivationTransitionQuery;
  readonly trustedNow: () => Date;
  /** One-use, independent database-and-exact-host stop, bound before the transition. */
  readonly stopOnUncertainty: () => Promise<GuardedCompanionEmergencyStopRehearsalResult>;
  /**
   * A separately owned stop supervisor. The future protected operator must attest
   * this process and its database/host stop authority independently; this callback
   * is not itself such an attestation or a production activation entry point.
   */
  readonly independentStop: Readonly<{
    confirmReady(): Promise<void>;
    /** Establish the database heartbeat before any execution permit is sent. */
    onActivated(validUntil: string): Promise<void>;
    /** Resolving or rejecting means the supervisor is no longer reliable. */
    readonly lost: Promise<unknown>;
  }>;
  readonly signal?: AbortSignal;
}

export interface GuardedLocalActivationChannel {
  readonly pipePath: string;
  receiveProof(signal?: AbortSignal): Promise<SignedCompanionExecutionLaunchProof>;
  /** Internal only: exact attestation read, one-use transition, then proof-bound permit and ACK. */
  commitAndPermit(input: GuardedLocalActivationCommitInput): Promise<
    Readonly<{
      validUntil: string;
      permitAcknowledged: true;
      runtimeConfirmationRequired: true;
      /** Rejects on later supervisor loss after invoking the one-use bound stop. */
      independentStopLoss: Promise<never>;
    }>
  >;
  close(): Promise<void>;
}

function canonicalChallenge(value: string): boolean {
  return (
    typeof value === 'string' &&
    CHALLENGE.test(value) &&
    Buffer.from(value, 'base64url').length === 32 &&
    Buffer.from(value, 'base64url').toString('base64url') === value
  );
}

function parseProof(
  raw: Buffer,
  expectedChallengeDigest: string,
): SignedCompanionExecutionLaunchProof {
  if (raw.length < 3 || raw.length > MAX_PROOF_BYTES || raw.at(-1) !== 10) throw new Error();
  const serialized = raw.subarray(0, -1).toString('utf8');
  const parsed: unknown = JSON.parse(serialized);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    serialized !== JSON.stringify(parsed) ||
    Object.keys(parsed).length !== 2 ||
    !Object.hasOwn(parsed, 'body') ||
    !Object.hasOwn(parsed, 'signature')
  )
    throw new Error();
  const envelope = parsed as Record<string, unknown>;
  const body = envelope.body;
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).contractVersion !== 2 ||
    (body as Record<string, unknown>).purpose !== COMPANION_EXECUTION_LAUNCH_PROOF_PURPOSE ||
    (body as Record<string, unknown>).executionMode !== 'guarded' ||
    (body as Record<string, unknown>).challengeDigest !== expectedChallengeDigest ||
    typeof envelope.signature !== 'string' ||
    !SIGNATURE.test(envelope.signature)
  )
    throw new Error();
  return parsed as SignedCompanionExecutionLaunchProof;
}

async function bounded<T>(task: () => Promise<T>, durationMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), durationMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Internal transport only. It is deliberately absent from package exports and all
 * production entry points. The caller must independently validate the signed proof,
 * measured process, release, handoff, and current financial state; retain the exact
 * attestation; own the exact child and bind its independent emergency stop before
 * calling commitAndPermit. A post-dispatch failure invokes that stop exactly once.
 * Even an ACK proves only receipt of a permit, not that workers started or a provider
 * action succeeded. Every post-transition uncertainty requires independent stop.
 */
export async function openGuardedLocalActivationChannel(
  challenge: string,
): Promise<GuardedLocalActivationChannel> {
  if (process.platform !== 'win32' || !canonicalChallenge(challenge)) {
    throw new GuardedLocalActivationUnavailableError();
  }
  const challengeDigest = `sha256:${createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest('hex')}`;
  const pipePath = `${PIPE_PREFIX}${randomBytes(16).toString('hex')}`;
  let socket: Socket | undefined;
  let receivedProof: SignedCompanionExecutionLaunchProof | undefined;
  let proofRaw: string | undefined;
  let accepted = false;
  let proofSettled = false;
  let proofRead = false;
  let spent = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let proofTimer: NodeJS.Timeout | undefined;
  let ackResolve: (() => void) | undefined;
  let ackReject: (() => void) | undefined;
  let ackExpected: string | undefined;
  let ackReceived = '';
  let resolveProof!: (proof: SignedCompanionExecutionLaunchProof) => void;
  let rejectProof!: () => void;
  const proofPromise = new Promise<SignedCompanionExecutionLaunchProof>((resolve, reject) => {
    resolveProof = resolve;
    rejectProof = () => reject(new GuardedLocalActivationUnavailableError());
  });
  void proofPromise.catch(() => undefined);

  function fail(): void {
    if (!proofSettled) {
      proofSettled = true;
      clearTimeout(proofTimer);
      rejectProof();
    }
    if (ackReject) {
      const reject = ackReject;
      ackReject = undefined;
      ackResolve = undefined;
      reject();
    }
  }

  const server: Server = createServer((candidate) => {
    if (accepted || closed) {
      candidate.destroy();
      return;
    }
    accepted = true;
    socket = candidate;
    candidate.on('data', (chunk: Buffer) => {
      if (closed) return;
      if (!proofSettled) {
        const existing = proofRaw === undefined ? Buffer.alloc(0) : Buffer.from(proofRaw, 'utf8');
        const combined = Buffer.concat([existing, chunk]);
        if (combined.length > MAX_PROOF_BYTES) {
          fail();
          void close();
          return;
        }
        const newline = combined.indexOf(10);
        if (newline < 0) {
          proofRaw = combined.toString('utf8');
          return;
        }
        if (newline !== combined.length - 1) {
          fail();
          void close();
          return;
        }
        try {
          const proof = parseProof(combined, challengeDigest);
          proofRaw = combined.subarray(0, -1).toString('utf8');
          receivedProof = proof;
          proofSettled = true;
          clearTimeout(proofTimer);
          resolveProof(proof);
        } catch {
          fail();
          void close();
        }
        return;
      }
      if (!ackExpected || !ackResolve) {
        fail();
        void close();
        return;
      }
      ackReceived += chunk.toString('utf8');
      if (
        Buffer.byteLength(ackReceived, 'utf8') > MAX_ACK_BYTES ||
        (ackReceived.includes('\n') && ackReceived !== ackExpected)
      ) {
        fail();
        void close();
      } else if (ackReceived === ackExpected) {
        const resolve = ackResolve;
        ackResolve = undefined;
        ackReject = undefined;
        resolve();
      }
    });
    candidate.once('error', () => {
      fail();
      void close();
    });
    candidate.once('end', () => {
      fail();
      void close();
    });
    candidate.once('close', () => {
      fail();
      void close();
    });
  });

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closed = true;
    fail();
    socket?.destroy();
    closePromise = new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    return closePromise;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.once('error', () => {
      fail();
      void close();
    });
    proofTimer = setTimeout(() => {
      fail();
      void close();
    }, PROOF_WAIT_MS);
  } catch {
    await close();
    throw new GuardedLocalActivationUnavailableError();
  }

  return Object.freeze({
    pipePath,
    async receiveProof(signal?: AbortSignal): Promise<SignedCompanionExecutionLaunchProof> {
      if (proofRead || signal?.aborted) {
        await close();
        throw new GuardedLocalActivationUnavailableError();
      }
      proofRead = true;
      const abort = () => {
        void close();
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try {
        return await proofPromise;
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    },
    async commitAndPermit(input: GuardedLocalActivationCommitInput) {
      if (spent) throw new GuardedLocalActivationUnavailableError();
      spent = true;
      let transitionDispatched = false;
      let watchdogLost = false;
      let stopPromise: Promise<GuardedCompanionEmergencyStopRehearsalResult> | undefined;
      const stopOnce = () => {
        stopPromise ??= bounded(() => input.stopOnUncertainty(), 105_000);
        return stopPromise;
      };
      const lost = Promise.resolve(input?.independentStop?.lost).then(
        () => {
          watchdogLost = true;
          throw new Error();
        },
        () => {
          watchdogLost = true;
          throw new Error();
        },
      );
      // A supervisor loss after a successful permit still invokes the bound
      // database-and-host stop and reports uncertainty to the future operator.
      // Provider outcome remains a separate reconciliation obligation.
      const independentStopLoss: Promise<never> = lost.catch(async (): Promise<never> => {
        if (transitionDispatched) {
          try {
            await stopOnce();
          } catch {
            // Both stop failure and a confirmed stop require external review.
          }
        }
        throw transitionDispatched
          ? new GuardedLocalActivationUncertainError()
          : new GuardedLocalActivationUnavailableError();
      });
      void independentStopLoss.catch(() => undefined);
      const abort = () => {
        void close();
      };
      input?.signal?.addEventListener('abort', abort, { once: true });
      try {
        if (
          !proofRead ||
          !receivedProof ||
          !proofRaw ||
          !socket ||
          socket.destroyed ||
          closed ||
          input?.signal?.aborted ||
          !UUID_V4.test(input.actorAuthUserId) ||
          !UUID_V4.test(input.requestKey) ||
          !RUNTIME_PASSWORD.test(input.runtimePassword) ||
          receivedProof.body.requestKey !== input.requestKey ||
          !SHA256.test(input.verifiedProofDigest) ||
          input.verifiedProofDigest !==
            `sha256:${createHash('sha256').update(proofRaw, 'utf8').digest('hex')}` ||
          !input.administrator ||
          typeof input.administrator.query !== 'function' ||
          typeof input.trustedNow !== 'function' ||
          typeof input.stopOnUncertainty !== 'function' ||
          typeof input.independentStop?.confirmReady !== 'function' ||
          typeof input.independentStop?.onActivated !== 'function' ||
          typeof input.independentStop?.lost?.then !== 'function'
        )
          throw new Error();
        await bounded(
          () => Promise.race([input.independentStop.confirmReady(), lost]),
          WATCHDOG_READY_WAIT_MS,
        );
        if (watchdogLost || closed || input.signal?.aborted) throw new Error();
        const beforeDispatch = input.trustedNow();
        if (!(beforeDispatch instanceof Date) || !Number.isFinite(beforeDispatch.getTime()))
          throw new Error();
        const result = await Promise.race([
          input.administrator.query(ATTESTATION_SQL, [input.requestKey]),
          lost,
        ]);
        if (
          result.rows.length !== 1 ||
          !result.rows[0] ||
          Object.keys(result.rows[0]).length !== 1 ||
          result.rows[0]['proof_digest'] !== input.verifiedProofDigest ||
          closed ||
          input.signal?.aborted
        )
          throw new Error();
        if (watchdogLost) throw new Error();
        transitionDispatched = true;
        const validUntil = await bounded(
          () =>
            Promise.race([
              invokeCompanionActivationTransitionInternal(
                {
                  actorAuthUserId: input.actorAuthUserId,
                  requestKey: input.requestKey,
                  runtimePassword: input.runtimePassword,
                },
                input.administrator,
              ),
              lost,
            ]),
          COMMIT_WAIT_MS,
        );
        const now = input.trustedNow();
        if (
          !(now instanceof Date) ||
          !Number.isFinite(now.getTime()) ||
          Date.parse(validUntil) <=
            now.getTime() + 2 * COMPANION_EXECUTION_LOCAL_EXPIRY_SAFETY_MARGIN_MS ||
          Date.parse(validUntil) >
            now.getTime() + COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS + 30_000 ||
          closed ||
          input.signal?.aborted ||
          watchdogLost ||
          socket.destroyed
        )
          throw new Error();
        await bounded(
          () => Promise.race([input.independentStop.onActivated(validUntil), lost]),
          WATCHDOG_READY_WAIT_MS,
        );
        if (watchdogLost || closed || input.signal?.aborted || socket.destroyed) throw new Error();
        const permit = `${COMPANION_EXECUTION_LOCAL_PERMIT_PREFIX}${input.verifiedProofDigest}|${validUntil}\n`;
        ackExpected = `${COMPANION_EXECUTION_LOCAL_PERMIT_ACK_PREFIX}${input.verifiedProofDigest}|${validUntil}\n`;
        const acknowledged = new Promise<void>((resolve, reject) => {
          ackResolve = resolve;
          ackReject = () => reject(new Error());
        });
        const write = new Promise<void>((resolve, reject) => {
          socket!.write(permit, (error) => (error ? reject(new Error()) : resolve()));
        });
        await bounded(
          () => Promise.race([Promise.all([write, acknowledged]).then(() => undefined), lost]),
          ACK_WAIT_MS,
        );
        if (watchdogLost) throw new Error();
        await close();
        return Object.freeze({
          validUntil,
          permitAcknowledged: true as const,
          runtimeConfirmationRequired: true as const,
          independentStopLoss,
        });
      } catch {
        // A query timeout or lost response can conceal a committed transition.
        // Start the independent database/host stop even if closing IPC fails.
        await Promise.allSettled([close(), ...(transitionDispatched ? [stopOnce()] : [])]);
        throw transitionDispatched
          ? new GuardedLocalActivationUncertainError()
          : new GuardedLocalActivationUnavailableError();
      } finally {
        input?.signal?.removeEventListener('abort', abort);
      }
    },
    close,
  });
}
