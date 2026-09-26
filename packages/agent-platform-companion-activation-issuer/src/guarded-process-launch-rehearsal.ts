import { randomBytes } from 'node:crypto';

import {
  openGuardedLocalLaunchProofChannel,
  type GuardedLocalLaunchProofChannel,
} from './guarded-local-launch-channel.js';
import {
  observeGuardedWindowsCompanionProcess,
  type GuardedCompanionProcessObservationInputs,
} from './guarded-process-observation.js';

const STOP_WAIT_MS = 10_000;

export class GuardedProcessLaunchRehearsalUnavailableError extends Error {
  constructor() {
    super('The guarded process launch rehearsal is unavailable.');
    this.name = 'GuardedProcessLaunchRehearsalUnavailableError';
  }
}

export interface GuardedProcessRehearsalChild {
  /** The exact child returned immediately by a protected local process starter. */
  readonly processId: number;
  /** Settles only when the child process has exited, including abnormal exits. */
  readonly stopped: Promise<void>;
  /** Must terminate this exact child and wait for exit; never a process-name or profile sweep. */
  stop(): Promise<void>;
}

export interface GuardedProcessLaunchRehearsalInputs extends Omit<
  GuardedCompanionProcessObservationInputs,
  'proof' | 'challenge' | 'challengeIssuedAt'
> {
  /** Ownership transfers synchronously. A starter that throws must clean up its own partial launch. */
  readonly start: (
    request: Readonly<{ challenge: string; pipePath: string }>,
  ) => GuardedProcessRehearsalChild;
  readonly signal?: AbortSignal;
}

interface GuardedProcessLaunchRehearsalAdapters {
  readonly openChannel: (challenge: string) => Promise<GuardedLocalLaunchProofChannel>;
  readonly observe: (
    input: GuardedCompanionProcessObservationInputs,
  ) => Promise<{ processId: number }>;
}

export interface GuardedProcessLaunchRehearsalResult {
  readonly proofObserved: true;
  readonly processObserved: true;
  readonly processStopped: true;
  readonly permitSent: false;
}

function trustedTimestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error();
  return value.toISOString();
}

async function bounded(pending: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), STOP_WAIT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rehearses receipt and observation of a guarded v2 proof without issuing a permit.
 * Success requires confirmed child exit. On failure it attempts a bounded stop
 * and reports only a redacted error, including when exit cannot be confirmed.
 * The fixed result cannot be used as an activation attestation or execution grant.
 * No production process starter or invocation is provided by this package.
 */
export async function rehearseGuardedWindowsCompanionLaunch(
  input: GuardedProcessLaunchRehearsalInputs,
  adapters: GuardedProcessLaunchRehearsalAdapters = {
    openChannel: openGuardedLocalLaunchProofChannel,
    observe: observeGuardedWindowsCompanionProcess,
  },
): Promise<GuardedProcessLaunchRehearsalResult> {
  let channel: GuardedLocalLaunchProofChannel | undefined;
  let child: GuardedProcessRehearsalChild | undefined;
  let observed = false;
  let cleanupFailed = false;
  try {
    if (input.signal?.aborted) throw new Error();
    const challenge = randomBytes(32).toString('base64url');
    const challengeIssuedAt = trustedTimestamp(input.trustedNow);
    channel = await adapters.openChannel(challenge);
    if (input.signal?.aborted) throw new Error();
    child = input.start({ challenge, pipePath: channel.pipePath });
    if (
      !child ||
      !Number.isInteger(child.processId) ||
      child.processId < 1 ||
      child.processId > 2_147_483_647 ||
      typeof child.stop !== 'function' ||
      typeof child.stopped?.then !== 'function'
    ) {
      throw new Error();
    }
    const proof = await Promise.race([
      channel.receiveProof(input.signal),
      child.stopped.then(
        () => {
          throw new Error();
        },
        () => {
          throw new Error();
        },
      ),
    ]);
    if (input.signal?.aborted) throw new Error();
    const process = await adapters.observe({
      request: input.request,
      certificate: input.certificate,
      release: input.release,
      dataRoot: input.dataRoot,
      installationRoot: input.installationRoot,
      proof,
      challenge,
      challengeIssuedAt,
      powershellExecutable: input.powershellExecutable,
      verifierScriptPath: input.verifierScriptPath,
      trustedNow: input.trustedNow,
    });
    if (process.processId !== child.processId || input.signal?.aborted) throw new Error();
    observed = true;
  } catch {
    observed = false;
  } finally {
    if (channel) {
      try {
        await bounded(channel.close());
      } catch {
        cleanupFailed = true;
      }
    }
    if (child) {
      try {
        await bounded(child.stop());
      } catch {
        cleanupFailed = true;
      }
      try {
        await bounded(child.stopped);
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (!observed || cleanupFailed) throw new GuardedProcessLaunchRehearsalUnavailableError();
  return Object.freeze({
    proofObserved: true,
    processObserved: true,
    processStopped: true,
    permitSent: false,
  });
}
