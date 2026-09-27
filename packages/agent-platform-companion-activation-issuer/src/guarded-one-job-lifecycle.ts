import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';
import type { GuardedCompanionExecutionSupervisor } from './guarded-execution-supervisor.js';
import {
  GuardedLocalActivationUnavailableError,
  type GuardedLocalActivationChannel,
} from './guarded-local-activation-channel.js';
import {
  loadGuardedOneJobOutcome,
  watchGuardedApprovedJobId,
  watchGuardedOneJobOutcome,
  type GuardedOneJobOutcome,
} from './guarded-one-job-outcome.js';
import type { CompanionActivationSnapshotQuery } from './snapshot.js';

export interface GuardedOneJobLifecycleInput {
  /** Channel with one already-received, independently verified launch proof. */
  readonly channel: GuardedLocalActivationChannel;
  readonly child: GuardedCompanionOwnedChild;
  readonly supervisor: GuardedCompanionExecutionSupervisor;
  readonly actorAuthUserId: string;
  readonly requestKey: string;
  readonly verifiedProofDigest: string;
  readonly runtimePassword: string;
  readonly administrator: CompanionActivationSnapshotQuery;
  readonly trustedNow: () => Date;
  readonly signal?: AbortSignal;
}

export class GuardedOneJobLifecycleUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The guarded one-job lifecycle could not be confirmed.');
    this.name = 'GuardedOneJobLifecycleUnavailableError';
  }
}

/**
 * Internal post-attestation composition, not a production activation entry
 * point. It consumes the one-use transition while the queue is empty, waits
 * for exactly one later Owner approval, watches only that job, and always
 * disables credentials/financial authority and
 * stops the exact child before reporting a terminal result. A confirmed result
 * is re-read after that stop. No provider action is ever retried here.
 *
 * The protected operator must independently own the exclusive lifecycle lock,
 * signer, snapshot/release/process attestation, job approval, administrator
 * connection, and post-crash reconciliation. None is supplied by this module.
 */
export async function runGuardedOneJobLifecycle(
  input: GuardedOneJobLifecycleInput,
): Promise<Exclude<GuardedOneJobOutcome, 'pending'>> {
  let permitted = false;
  let prePermitFailure = false;
  let commitAttempted = false;
  try {
    if (
      !input ||
      !input.channel ||
      typeof input.channel.commitAndPermit !== 'function' ||
      typeof input.channel.close !== 'function' ||
      !input.child ||
      typeof input.child.stop !== 'function' ||
      typeof input.child.stopped?.then !== 'function' ||
      !input.supervisor ||
      typeof input.supervisor.confirmReady !== 'function' ||
      typeof input.supervisor.onActivated !== 'function' ||
      typeof input.supervisor.stopOnUncertainty !== 'function' ||
      typeof input.supervisor.lost?.then !== 'function' ||
      input.signal?.aborted
    )
      throw new Error();

    let activation;
    try {
      commitAttempted = true;
      activation = await input.channel.commitAndPermit({
        actorAuthUserId: input.actorAuthUserId,
        requestKey: input.requestKey,
        verifiedProofDigest: input.verifiedProofDigest,
        runtimePassword: input.runtimePassword,
        administrator: input.administrator,
        trustedNow: input.trustedNow,
        stopOnUncertainty: () => input.supervisor.stopOnUncertainty(),
        independentStop: input.supervisor,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      prePermitFailure = error instanceof GuardedLocalActivationUnavailableError;
      throw error;
    }
    permitted = true;
    if (activation.permitAcknowledged !== true || activation.runtimeConfirmationRequired !== true)
      throw new Error();

    const executionJobId = await watchGuardedApprovedJobId({
      requestKey: input.requestKey,
      administrator: input.administrator,
      validUntil: activation.validUntil,
      trustedNow: input.trustedNow,
      supervisorLost: activation.independentStopLoss,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const observed = await watchGuardedOneJobOutcome({
      requestKey: input.requestKey,
      executionJobId,
      administrator: input.administrator,
      validUntil: activation.validUntil,
      trustedNow: input.trustedNow,
      supervisorLost: activation.independentStopLoss,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    await input.supervisor.stopOnUncertainty();
    const afterStop = await loadGuardedOneJobOutcome(
      input.requestKey,
      executionJobId,
      input.administrator,
    );
    if (afterStop !== observed) throw new Error();
    return afterStop;
  } catch {
    try {
      if (prePermitFailure || !commitAttempted) {
        await input?.child?.stop();
        await input?.child?.stopped;
      } else if (input?.supervisor) {
        await input.supervisor.stopOnUncertainty();
      }
    } catch {
      // The failure is still unresolved; never conceal it behind a raw error.
    }
    throw new GuardedOneJobLifecycleUnavailableError();
  } finally {
    try {
      await input?.channel?.close();
    } catch {
      // A closed or broken local channel cannot establish a terminal outcome.
      if (permitted) throw new GuardedOneJobLifecycleUnavailableError();
    }
  }
}
