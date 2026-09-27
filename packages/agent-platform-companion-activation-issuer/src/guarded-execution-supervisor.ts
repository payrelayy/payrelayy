import type { CompanionActivationSnapshotQuery } from './snapshot.js';
import {
  prepareGuardedCompanionEmergencyStopRehearsal,
  type GuardedCompanionEmergencyStopRehearsalResult,
} from './guarded-emergency-stop-rehearsal.js';
import {
  prepareGuardedDatabaseWatchdogLease,
  type GuardedDatabaseWatchdogLease,
} from './guarded-database-watchdog-lease.js';
import {
  armGuardedCompanionLifecycleStopMonitorWithBoundStop,
  type GuardedCompanionLifecycleStopMonitor,
} from './guarded-lifecycle-stop-monitor.js';
import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';

export interface GuardedCompanionExecutionSupervisorInput {
  /** The exact child returned by the protected starter, never a discovered PID. */
  readonly child: GuardedCompanionOwnedChild;
  /** Short-lived protected administrator session; never the companion login. */
  readonly administrator: CompanionActivationSnapshotQuery;
  readonly activationEpoch: string;
  /** Runs the reviewed production emergency SQL with its own deadline. */
  readonly disableDatabase: () => Promise<unknown>;
  readonly trustedNow: () => Date;
  readonly signal?: AbortSignal;
}

export interface GuardedCompanionExecutionSupervisor {
  /** Require exact healthy database stop jobs before the one-use transition. */
  confirmReady(): Promise<void>;
  /** Arm exact-child expiry stop and renew the database lease before any permit. */
  onActivated(validUntil: string): Promise<void>;
  /** Any loss must be treated as an uncertain activation. */
  readonly lost: Promise<never>;
  /** The one shared, memoized database-and-exact-child emergency stop. */
  stopOnUncertainty(): Promise<GuardedCompanionEmergencyStopRehearsalResult>;
}

export class GuardedCompanionExecutionSupervisorUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The guarded companion execution supervisor is unavailable.');
    this.name = 'GuardedCompanionExecutionSupervisorUnavailableError';
  }
}

/**
 * Internal composition only. It has no production entry point and cannot
 * activate a request. A future protected operator must retain the attestation,
 * own the administrator connection and lifecycle lock, and bind this object to
 * the local activation channel before its one-use transition. All stops use
 * one exact-child/database operation; a confirmed stop still requires provider
 * outcome reconciliation.
 */
export function prepareGuardedCompanionExecutionSupervisor(
  input: GuardedCompanionExecutionSupervisorInput,
): GuardedCompanionExecutionSupervisor {
  let emergencyStop: () => Promise<GuardedCompanionEmergencyStopRehearsalResult>;
  let databaseLease: GuardedDatabaseWatchdogLease;
  const leaseAbort = new AbortController();
  try {
    if (!input || input.signal?.aborted) throw new Error();
    emergencyStop = prepareGuardedCompanionEmergencyStopRehearsal({
      child: input.child,
      disableDatabase: input.disableDatabase,
    });
    databaseLease = prepareGuardedDatabaseWatchdogLease({
      administrator: input.administrator,
      activationEpoch: input.activationEpoch,
      trustedNow: input.trustedNow,
      signal: leaseAbort.signal,
    });
  } catch {
    throw new GuardedCompanionExecutionSupervisorUnavailableError();
  }

  let confirmed = false;
  let activated = false;
  let failed = false;
  let monitor: GuardedCompanionLifecycleStopMonitor | undefined;
  let stopPromise: Promise<GuardedCompanionEmergencyStopRehearsalResult> | undefined;
  let rejectLost!: (error: GuardedCompanionExecutionSupervisorUnavailableError) => void;
  const lost = new Promise<never>((_, reject) => {
    rejectLost = reject;
  });
  void lost.catch(() => undefined);

  const fail = (): GuardedCompanionExecutionSupervisorUnavailableError => {
    if (!failed) {
      failed = true;
      rejectLost(new GuardedCompanionExecutionSupervisorUnavailableError());
    }
    return new GuardedCompanionExecutionSupervisorUnavailableError();
  };
  const stopOnUncertainty = (): Promise<GuardedCompanionEmergencyStopRehearsalResult> => {
    if (!stopPromise) {
      stopPromise = Promise.resolve().then(emergencyStop);
      leaseAbort.abort();
      if (monitor) void monitor.stopNow();
    }
    return stopPromise;
  };
  const stopAfterActivationLoss = (): void => {
    fail();
    if (activated) void stopOnUncertainty().catch(() => undefined);
  };
  void databaseLease.lost.then(stopAfterActivationLoss, stopAfterActivationLoss);
  void input.child.stopped.then(stopAfterActivationLoss, stopAfterActivationLoss);
  input.signal?.addEventListener('abort', stopAfterActivationLoss, { once: true });
  if (input.signal?.aborted) stopAfterActivationLoss();

  return Object.freeze({
    lost,
    stopOnUncertainty,
    async confirmReady(): Promise<void> {
      if (failed || confirmed || activated || input.signal?.aborted) throw fail();
      try {
        await databaseLease.confirmReady();
        if (failed || input.signal?.aborted) throw new Error();
        confirmed = true;
      } catch {
        throw fail();
      }
    },
    async onActivated(validUntil: string): Promise<void> {
      if (failed || !confirmed || activated || input.signal?.aborted) throw fail();
      activated = true;
      try {
        monitor = armGuardedCompanionLifecycleStopMonitorWithBoundStop({
          child: input.child,
          validUntil,
          stopOnUncertainty,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        void monitor.done.then(stopAfterActivationLoss, stopAfterActivationLoss);
        await databaseLease.onActivated(validUntil);
        if (failed || input.signal?.aborted) throw new Error();
      } catch {
        stopAfterActivationLoss();
        throw new GuardedCompanionExecutionSupervisorUnavailableError();
      }
    },
  });
}
