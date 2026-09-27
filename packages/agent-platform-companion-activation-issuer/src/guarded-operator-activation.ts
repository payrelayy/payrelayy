import { randomBytes } from 'node:crypto';

import {
  retainCompanionActivationAttestation,
  type CompanionActivationAttestationSources,
  type CompanionActivationDatabaseSnapshot,
  type CompanionActivationObservedProcess,
  type CompanionActivationReleaseAttestation,
  type CompanionExecutionActivationHandoffBody,
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
  readonly signHandoff: (
    body: CompanionExecutionActivationHandoffBody,
  ) => Promise<SignedCompanionExecutionActivationHandoff>;
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

  constructor() {
    super('The guarded one-job operator activation could not be confirmed.');
    this.name = 'GuardedOperatorActivationUnavailableError';
  }
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
  try {
    if (!input || input.signal?.aborted || typeof input.disableDatabase !== 'function')
      throw new Error();
    const lockLoss = new AbortController();
    const signal = input.signal
      ? AbortSignal.any([input.signal, lockLoss.signal])
      : lockLoss.signal;
    lock = await adapters.acquireLock(input.administrator);
    void lock.lost.catch(() => lockLoss.abort());
    if (signal.aborted) throw new Error();

    const sources: CompanionActivationAttestationSources = {
      loadDatabaseSnapshot: async (requestKey) => {
        if (signal.aborted) throw new Error();
        const snapshot = await adapters.loadSnapshot(requestKey, input.administrator);
        if (signal.aborted) throw new Error();
        first ??= snapshot;
        return snapshot;
      },
      verifyPublishedReleaseAndInstalledTree: async (request) => {
        if (signal.aborted) throw new Error();
        release = await adapters.verifyRelease(request, {
          ...input.releaseInputs,
          trustedNow: input.trustedNow,
        });
        if (signal.aborted) throw new Error();
        return release;
      },
      observePairedProcess: async ({ request, certificate, challenge, challengeIssuedAt }) => {
        if (!first || !release || signal.aborted) throw new Error();
        const handoff = await adapters.publishHandoff({
          ...first,
          release,
          dataRoot: input.dataRoot,
          signHandoff: input.signHandoff,
          trustedNow: input.trustedNow,
        } satisfies GuardedCompanionHandoffPublicationInputs);
        if (!SHA256.test(handoff.handoffSha256) || signal.aborted) throw new Error();
        channel = await adapters.openChannel(challenge);
        if (signal.aborted) throw new Error();
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
        const proof = await Promise.race([
          channel.receiveProof(signal),
          ownedChild.stopped.then(() => {
            throw new Error();
          }),
        ]);
        if (signal.aborted) throw new Error();
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
        if (!channel || !child || attestation.requestKey !== input.requestKey || signal.aborted)
          throw new Error();
        await adapters.retainRow(attestation, input.administrator);
        if (signal.aborted) throw new Error();
        proofDigest = attestation.launchProofDigest;
      },
      trustedNow: input.trustedNow,
    };
    await adapters.attest(input.requestKey, sources);
    if (!first || !channel || !child || !proofDigest || signal.aborted) throw new Error();
    const supervisor = adapters.prepareSupervisor({
      child,
      administrator: input.administrator,
      activationEpoch: first.request.activationEpoch,
      disableDatabase: input.disableDatabase,
      trustedNow: input.trustedNow,
      signal,
    });
    lifecycleStarted = true;
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
  } catch {
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
        }
      }
      if (channel) {
        try {
          await channel.close();
        } catch {
          cleanupFailed = true;
        }
      }
    }
    if (lock) {
      try {
        await lock.release();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (!result || cleanupFailed) throw new GuardedOperatorActivationUnavailableError();
  return result;
}

/** Still not a production entry point: no administrator or signer is provisioned here. */
export async function runGuardedOperatorActivation(
  input: GuardedOperatorActivationInput,
): Promise<'confirmed' | 'review_required'> {
  if (process.platform !== 'win32') throw new GuardedOperatorActivationUnavailableError();
  return runGuardedOperatorActivationWithAdapters(input, productionAdapters);
}
