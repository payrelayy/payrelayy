import {
  COMPANION_EXECUTION_LOCAL_EXPIRY_SAFETY_MARGIN_MS,
  COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  prepareGuardedCompanionEmergencyStopRehearsal,
  type GuardedCompanionEmergencyStopRehearsalResult,
} from './guarded-emergency-stop-rehearsal.js';
import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const STOP_WAIT_MS = 105_000;

export interface GuardedCompanionLifecycleStopMonitorInput {
  /** The exact protected child, not a PID discovered after activation. */
  readonly child: GuardedCompanionOwnedChild;
  /** Exact expiry returned by the one-use database activation transition. */
  readonly validUntil: string;
  /** Runs the independently reviewed administrator-only emergency SQL. */
  readonly disableDatabase: () => Promise<unknown>;
  /** An operator shutdown request; this is not an authentication mechanism. */
  readonly signal?: AbortSignal;
}

export interface GuardedCompanionLifecycleStopMonitor {
  /** Resolves only after credential/session revocation and exact host exit are proved. */
  readonly done: Promise<GuardedCompanionEmergencyStopRehearsalResult>;
  /** Invoke the same one-use stop early. Races never repeat it. */
  stopNow(): Promise<GuardedCompanionEmergencyStopRehearsalResult>;
}

export class GuardedCompanionLifecycleStopUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The guarded companion lifecycle stop could not be confirmed.');
    this.name = 'GuardedCompanionLifecycleStopUnavailableError';
  }
}

function validStopProof(value: unknown): value is GuardedCompanionEmergencyStopRehearsalResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const expected = [
    'databaseCredentialsAndSessionsRevoked',
    'financialAuthorityDisabled',
    'companionExecutionDisabled',
    'exactHostStopped',
    'providerOutcomeRequiresReconciliation',
  ];
  return (
    Object.keys(result).length === expected.length &&
    expected.every((key) => Object.hasOwn(result, key) && result[key] === true)
  );
}

/**
 * Internal, source-only lifecycle fence. A future protected coordinator must
 * arm it immediately after the database transition and before permitting local
 * work; that production coordinator does not exist yet. A malformed or nearly expired
 * transition expiry stops immediately. Child exit, operator abort, deadline,
 * and manual stop all share one emergency-stop invocation. A confirmed stop
 * still leaves any in-flight provider outcome for independent reconciliation.
 * This in-process monitor does not survive its own host's failure and is not
 * an independent production watchdog or activation entry point.
 */
export function armGuardedCompanionLifecycleStopMonitor(
  input: GuardedCompanionLifecycleStopMonitorInput,
): GuardedCompanionLifecycleStopMonitor {
  let stop: () => Promise<GuardedCompanionEmergencyStopRehearsalResult>;
  try {
    stop = prepareGuardedCompanionEmergencyStopRehearsal({
      child: input.child,
      disableDatabase: input.disableDatabase,
    });
  } catch {
    throw new GuardedCompanionLifecycleStopUnavailableError();
  }

  let resolveDone!: (value: GuardedCompanionEmergencyStopRehearsalResult) => void;
  let rejectDone!: (reason: Error) => void;
  const done = new Promise<GuardedCompanionEmergencyStopRehearsalResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // A deadline or child exit can fire before a caller awaits the monitor.
  void done.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  let stopPromise: Promise<GuardedCompanionEmergencyStopRehearsalResult> | undefined;
  const stopNow = (): Promise<GuardedCompanionEmergencyStopRehearsalResult> => {
    if (stopPromise) return stopPromise;
    if (timer) clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
    let stopTimer: NodeJS.Timeout | undefined;
    stopPromise = Promise.race([
      Promise.resolve().then(stop),
      new Promise<never>((_, reject) => {
        stopTimer = setTimeout(() => reject(new Error()), STOP_WAIT_MS);
      }),
    ])
      .then((proof) => {
        if (!validStopProof(proof)) throw new Error();
        resolveDone(proof);
        return proof;
      })
      .catch(() => {
        const error = new GuardedCompanionLifecycleStopUnavailableError();
        rejectDone(error);
        throw error;
      })
      .finally(() => clearTimeout(stopTimer));
    void stopPromise.catch(() => undefined);
    return stopPromise;
  };
  const onAbort = () => {
    void stopNow();
  };
  input.signal?.addEventListener('abort', onAbort, { once: true });
  void input.child.stopped.then(onAbort, onAbort);

  const expiry = typeof input.validUntil === 'string' ? Date.parse(input.validUntil) : Number.NaN;
  const now = Date.now();
  const remainingMs = expiry - now;
  if (
    input.signal?.aborted ||
    typeof input.validUntil !== 'string' ||
    !UTC_TIMESTAMP.test(input.validUntil) ||
    !Number.isFinite(expiry) ||
    new Date(expiry).toISOString() !== input.validUntil ||
    remainingMs <= 2 * COMPANION_EXECUTION_LOCAL_EXPIRY_SAFETY_MARGIN_MS ||
    remainingMs >
      COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS +
        COMPANION_EXECUTION_LOCAL_EXPIRY_SAFETY_MARGIN_MS
  ) {
    void stopNow();
  } else if (!stopPromise) {
    timer = setTimeout(onAbort, remainingMs - COMPANION_EXECUTION_LOCAL_EXPIRY_SAFETY_MARGIN_MS);
  }
  return Object.freeze({ done, stopNow });
}
