import { randomBytes } from 'node:crypto';

import {
  retainCompanionActivationAttestation,
  type CompanionActivationAttestationSources,
  type CompanionActivationDatabaseSnapshot,
  type CompanionActivationObservedProcess,
  type CompanionActivationReleaseAttestation,
  type SignedCompanionExecutionActivationHandoff,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import { retainCompanionActivationAttestationRow } from './attestation-retention.js';
import { prepareGuardedCompanionExecutionSupervisor } from './guarded-execution-supervisor.js';
import {
  publishGuardedCompanionHandoff,
  type GuardedCompanionHandoffPublicationInputs,
} from './guarded-handoff-publication.js';
import {
  openGuardedLocalActivationChannel,
  type GuardedLocalActivationChannel,
} from './guarded-local-activation-channel.js';
import {
  createGuardedOperatorQueryClient,
  type GuardedOperatorRemoteSession,
} from './guarded-operator-query-client.js';
import {
  runGuardedOneJobLifecycle,
  type GuardedOneJobLifecycleInput,
} from './guarded-one-job-lifecycle.js';
import {
  acquireGuardedOperatorLifecycleLock,
  type GuardedOperatorAdministrator,
  type GuardedOperatorLifecycleLock,
} from './guarded-operator-lifecycle-lock.js';
import {
  observeGuardedWindowsCompanionProcess,
  type GuardedCompanionProcessObservationInputs,
} from './guarded-process-observation.js';
import {
  prepareGuardedWindowsCompanionProcessStarter,
  type GuardedCompanionProcessStarterInputs,
} from './guarded-process-starter.js';
import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';
import {
  verifyPublishedCompanionReleaseAndInstalledTree,
  type CompanionActivationReleaseInputs,
} from './release-measurement.js';
import { loadCompanionActivationDatabaseSnapshot } from './snapshot.js';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PRE_PERMIT_STOP_MS = 12_000;

const ACTIVATION_FAILURE_STAGES = [
  'unconfirmed',
  'input_validation',
  'handoff_signing',
  'handoff_local_preflight',
  'handoff_ssh_transport',
  'handoff_http_response',
  'handoff_binding',
  'remote_session_open',
  'remote_session_close',
  'lifecycle_lock',
  'attestation',
  'database_snapshot',
  'release_verification',
  'handoff_publication',
  'local_channel',
  'child_start',
  'launch_proof',
  'process_observation',
  'attestation_retention',
  'supervisor',
  'one_job_lifecycle',
  'pre_permit_child_cleanup',
  'local_channel_cleanup',
  'lifecycle_lock_cleanup',
] as const;

export type GuardedOperatorActivationFailureStage = (typeof ACTIVATION_FAILURE_STAGES)[number];

/** Only source-defined categories may cross an error or logging boundary. */
export function isGuardedOperatorActivationFailureStage(
  value: unknown,
): value is GuardedOperatorActivationFailureStage {
  return ACTIVATION_FAILURE_STAGES.some((stage) => stage === value);
}

export interface GuardedOperatorActivationInput {
  readonly requestKey: string;
  readonly actorAuthUserId: string;
  /** One protected, dedicated pg Client retained for the entire operation. */
  readonly administrator: GuardedOperatorAdministrator;
  readonly releaseInputs: Omit<CompanionActivationReleaseInputs, 'trustedNow'>;
  readonly dataRoot: string;
  readonly processVerifierScriptPath: string;
  readonly windowsEnvironment: NodeJS.ProcessEnv;
  /** Authenticated server operation; the production signing key never enters this process. */
  readonly signHandoff: (requestKey: string) => Promise<SignedCompanionExecutionActivationHandoff>;
  /** Captured by the SSH coordinator before its one-use signing request, not by an Owner form. */
  readonly handoffSigningStartedAt?: string;
  /** Runs the reviewed database emergency-disable operation on its own connection. */
  readonly disableDatabase: () => Promise<unknown>;
  readonly trustedNow: () => Date;
  readonly signal?: AbortSignal;
}

interface GuardedOperatorActivationAdapters {
  readonly acquireLock: typeof acquireGuardedOperatorLifecycleLock;
  readonly attest: typeof retainCompanionActivationAttestation;
  readonly loadSnapshot: typeof loadCompanionActivationDatabaseSnapshot;
  readonly verifyRelease: typeof verifyPublishedCompanionReleaseAndInstalledTree;
  readonly publishHandoff: typeof publishGuardedCompanionHandoff;
  readonly openChannel: typeof openGuardedLocalActivationChannel;
  readonly start: (
    input: GuardedCompanionProcessStarterInputs,
    launch: Readonly<{ challenge: string; pipePath: string }>,
  ) => GuardedCompanionOwnedChild;
  readonly observe: typeof observeGuardedWindowsCompanionProcess;
  readonly retainRow: typeof retainCompanionActivationAttestationRow;
  readonly prepareSupervisor: typeof prepareGuardedCompanionExecutionSupervisor;
  readonly runLifecycle: typeof runGuardedOneJobLifecycle;
}

const productionAdapters: GuardedOperatorActivationAdapters = {
  acquireLock: acquireGuardedOperatorLifecycleLock,
  attest: retainCompanionActivationAttestation,
  loadSnapshot: loadCompanionActivationDatabaseSnapshot,
  verifyRelease: verifyPublishedCompanionReleaseAndInstalledTree,
  publishHandoff: publishGuardedCompanionHandoff,
  openChannel: openGuardedLocalActivationChannel,
  start: (input, launch) => prepareGuardedWindowsCompanionProcessStarter(input)(launch),
  observe: observeGuardedWindowsCompanionProcess,
  retainRow: retainCompanionActivationAttestationRow,
  prepareSupervisor: prepareGuardedCompanionExecutionSupervisor,
  runLifecycle: runGuardedOneJobLifecycle,
};

export class GuardedOperatorActivationUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;
  readonly activationStage: GuardedOperatorActivationFailureStage;
  readonly cleanupStage: GuardedOperatorActivationFailureStage | undefined;

  constructor(
    stage: GuardedOperatorActivationFailureStage = 'unconfirmed',
    cleanupStage?: GuardedOperatorActivationFailureStage,
  ) {
    super('The guarded one-job operator activation could not be confirmed.');
    this.name = 'GuardedOperatorActivationUnavailableError';
    this.activationStage = isGuardedOperatorActivationFailureStage(stage) ? stage : 'unconfirmed';
    this.cleanupStage = isGuardedOperatorActivationFailureStage(cleanupStage)
      ? cleanupStage
      : undefined;
  }
}

export function guardedOperatorActivationFailureStage(
  error: unknown,
  fallback: GuardedOperatorActivationFailureStage,
): GuardedOperatorActivationFailureStage {
  return error instanceof GuardedOperatorActivationUnavailableError &&
    isGuardedOperatorActivationFailureStage(error.activationStage)
    ? error.activationStage
    : fallback;
}

/** Cleanup uncertainty is reported separately, never substituted for the first failure. */
export function guardedOperatorActivationCleanupStage(
  error: unknown,
): GuardedOperatorActivationFailureStage | undefined {
  return error instanceof GuardedOperatorActivationUnavailableError &&
    isGuardedOperatorActivationFailureStage(error.cleanupStage)
    ? error.cleanupStage
    : undefined;
}

function boundedStop(child: GuardedCompanionOwnedChild): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    Promise.resolve().then(async () => {
      await child.stop();
      await child.stopped;
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error()), PRE_PERMIT_STOP_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Internal, source-only composition of the reviewed issuer and one-job
 * lifecycle. It has no production CLI, export subpath, credential source,
 * signer source, emergency SQL launcher, or Owner approval operation. The
 * protected caller must supply these and independently verify its machine,
 * installation, and administrator session before invoking it.
 */
export async function runGuardedOperatorActivationWithAdapters(
  input: GuardedOperatorActivationInput,
  adapters: GuardedOperatorActivationAdapters,
): Promise<'confirmed' | 'review_required'> {
  let lock: GuardedOperatorLifecycleLock | undefined;
  let channel: GuardedLocalActivationChannel | undefined;
  let child: GuardedCompanionOwnedChild | undefined;
  let first: CompanionActivationDatabaseSnapshot | undefined;
  let release: CompanionActivationReleaseAttestation | undefined;
  let proofDigest: string | undefined;
  let lifecycleStarted = false;
  let result: 'confirmed' | 'review_required' | undefined;
  let cleanupFailed = false;
  let stage: GuardedOperatorActivationFailureStage = 'input_validation';
  let failureStage: GuardedOperatorActivationFailureStage = 'unconfirmed';
  let cleanupStage: GuardedOperatorActivationFailureStage | undefined;
  try {
    if (!input || input.signal?.aborted || typeof input.disableDatabase !== 'function')
      throw new Error();
    const lockLoss = new AbortController();
    const signal = input.signal
      ? AbortSignal.any([input.signal, lockLoss.signal])
      : lockLoss.signal;
    stage = 'lifecycle_lock';
    lock = await adapters.acquireLock(input.administrator);
    void lock.lost.catch(() => lockLoss.abort());
    if (signal.aborted) throw new Error();

    const sources: CompanionActivationAttestationSources = {
      loadDatabaseSnapshot: async (requestKey) => {
        stage = 'database_snapshot';
        if (signal.aborted) throw new Error();
        const snapshot = await adapters.loadSnapshot(requestKey, input.administrator);
        if (signal.aborted) throw new Error();
        first ??= snapshot;
        return snapshot;
      },
      verifyPublishedReleaseAndInstalledTree: async (request) => {
        stage = 'release_verification';
        if (signal.aborted) throw new Error();
        release = await adapters.verifyRelease(request, {
          ...input.releaseInputs,
          trustedNow: input.trustedNow,
        });
        if (signal.aborted) throw new Error();
        return release;
      },
      observePairedProcess: async ({ request, certificate, challenge, challengeIssuedAt }) => {
        stage = 'handoff_publication';
        if (!first || !release || signal.aborted) throw new Error();
        const handoff = await adapters.publishHandoff({
          ...first,
          release,
          dataRoot: input.dataRoot,
          signHandoff: input.signHandoff,
          ...(input.handoffSigningStartedAt
            ? { handoffSigningStartedAt: input.handoffSigningStartedAt }
            : {}),
          trustedNow: input.trustedNow,
        } satisfies GuardedCompanionHandoffPublicationInputs);
        if (!SHA256.test(handoff.handoffSha256) || signal.aborted) throw new Error();
        stage = 'local_channel';
        channel = await adapters.openChannel(challenge);
        if (signal.aborted) throw new Error();
        stage = 'child_start';
        child = adapters.start(
          {
            request,
            release,
            installationRoot: input.releaseInputs.installationRoot,
            dataRoot: input.dataRoot,
            windowsEnvironment: input.windowsEnvironment,
            trustedNow: input.trustedNow,
          },
          { challenge, pipePath: channel.pipePath },
        );
        if (
          !Number.isInteger(child?.processId) ||
          child.processId < 1 ||
          child.processId > 2_147_483_647 ||
          typeof child.stop !== 'function' ||
          typeof child.stopAfterPermit !== 'function' ||
          typeof child.stopped?.then !== 'function'
        )
          throw new Error();
        const ownedChild = child;
        stage = 'launch_proof';
        const proof = await Promise.race([
          channel.receiveProof(signal),
          ownedChild.stopped.then(() => {
            throw new Error();
          }),
        ]);
        if (signal.aborted) throw new Error();
        stage = 'process_observation';
        const observed = await adapters.observe({
          request,
          certificate,
          release,
          dataRoot: input.dataRoot,
          installationRoot: input.releaseInputs.installationRoot,
          proof,
          challenge,
          challengeIssuedAt,
          powershellExecutable: input.releaseInputs.powershellExecutable,
          verifierScriptPath: input.processVerifierScriptPath,
          trustedNow: input.trustedNow,
        } satisfies GuardedCompanionProcessObservationInputs);
        if (
          signal.aborted ||
          observed.processId !== ownedChild.processId ||
          observed.executionHandoffSha256 !== handoff.handoffSha256
        )
          throw new Error();
        return observed satisfies CompanionActivationObservedProcess;
      },
      retainAttestation: async (attestation) => {
        stage = 'attestation_retention';
        if (!channel || !child || attestation.requestKey !== input.requestKey || signal.aborted)
          throw new Error();
        await adapters.retainRow(attestation, input.administrator);
        if (signal.aborted) throw new Error();
        proofDigest = attestation.launchProofDigest;
      },
      trustedNow: input.trustedNow,
    };
    stage = 'attestation';
    await adapters.attest(input.requestKey, sources);
    if (!first || !channel || !child || !proofDigest || signal.aborted) throw new Error();
    stage = 'supervisor';
    const supervisor = adapters.prepareSupervisor({
      child,
      administrator: input.administrator,
      activationEpoch: first.request.activationEpoch,
      disableDatabase: input.disableDatabase,
      trustedNow: input.trustedNow,
      signal,
    });
    lifecycleStarted = true;
    stage = 'one_job_lifecycle';
    result = await adapters.runLifecycle({
      channel,
      child,
      supervisor,
      actorAuthUserId: input.actorAuthUserId,
      requestKey: input.requestKey,
      verifiedProofDigest: proofDigest,
      runtimePassword: randomBytes(32).toString('hex'),
      administrator: input.administrator,
      trustedNow: input.trustedNow,
      signal,
    } satisfies GuardedOneJobLifecycleInput);
  } catch (error) {
    failureStage = guardedOperatorActivationFailureStage(error, stage);
    result = undefined;
  } finally {
    // Before lifecycle ownership transfers, there is no permit and only the
    // exact pre-permit child stop is valid. The lifecycle owns all later stops.
    if (!lifecycleStarted) {
      if (child) {
        try {
          await boundedStop(child);
        } catch {
          cleanupFailed = true;
          cleanupStage ??= 'pre_permit_child_cleanup';
        }
      }
      if (channel) {
        try {
          await channel.close();
        } catch {
          cleanupFailed = true;
          cleanupStage ??= 'local_channel_cleanup';
        }
      }
    }
    if (lock) {
      try {
        await lock.release();
      } catch {
        cleanupFailed = true;
        cleanupStage ??= 'lifecycle_lock_cleanup';
      }
    }
  }
  if (!result || cleanupFailed)
    throw new GuardedOperatorActivationUnavailableError(
      result ? (cleanupStage ?? failureStage) : failureStage,
      cleanupStage,
    );
  return result;
}

/** Still not a production entry point: no administrator or signer is provisioned here. */
export async function runGuardedOperatorActivation(
  input: GuardedOperatorActivationInput,
): Promise<'confirmed' | 'review_required'> {
  if (process.platform !== 'win32') throw new GuardedOperatorActivationUnavailableError();
  return runGuardedOperatorActivationWithAdapters(input, productionAdapters);
}

/** Test seam for a caller-owned, signed and authenticated remote session. */
export async function runGuardedOperatorActivationWithProtectedRemoteSessionAndAdapters(
  input: Omit<GuardedOperatorActivationInput, 'administrator'>,
  remote: GuardedOperatorRemoteSession,
  adapters: GuardedOperatorActivationAdapters,
): Promise<'confirmed' | 'review_required'> {
  let client: ReturnType<typeof createGuardedOperatorQueryClient> | undefined;
  let result: 'confirmed' | 'review_required' | undefined;
  let cleanupFailed = false;
  let failureStage: GuardedOperatorActivationFailureStage = 'remote_session_open';
  let cleanupStage: GuardedOperatorActivationFailureStage | undefined;
  try {
    client = createGuardedOperatorQueryClient(remote);
    result = await runGuardedOperatorActivationWithAdapters(
      { ...input, administrator: client.administrator },
      adapters,
    );
  } catch (error) {
    failureStage = guardedOperatorActivationFailureStage(error, failureStage);
    cleanupStage = guardedOperatorActivationCleanupStage(error);
    result = undefined;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        cleanupFailed = true;
        cleanupStage ??= 'remote_session_close';
      }
    }
  }
  if (!result || cleanupFailed)
    throw new GuardedOperatorActivationUnavailableError(
      result ? 'remote_session_close' : failureStage,
      cleanupStage,
    );
  return result;
}

/** Windows never receives a database URL or a local administrator connection. */
export function runGuardedOperatorActivationWithProtectedRemoteSession(
  input: Omit<GuardedOperatorActivationInput, 'administrator'>,
  remote: GuardedOperatorRemoteSession,
): Promise<'confirmed' | 'review_required'> {
  if (process.platform !== 'win32') throw new GuardedOperatorActivationUnavailableError();
  return runGuardedOperatorActivationWithProtectedRemoteSessionAndAdapters(
    input,
    remote,
    productionAdapters,
  );
}
