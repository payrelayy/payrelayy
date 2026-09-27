import { randomBytes } from 'node:crypto';

import {
  matchesCompanionActivationEvidence,
  type CompanionActivationDatabaseSnapshot,
  type CompanionActivationObservedProcess,
  type SignedCompanionExecutionActivationHandoff,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  publishGuardedCompanionHandoff,
  type GuardedCompanionHandoffPublicationInputs,
} from './guarded-handoff-publication.js';
import {
  openGuardedLocalLaunchProofChannel,
  type GuardedLocalLaunchProofChannel,
} from './guarded-local-launch-channel.js';
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
import {
  loadCompanionActivationDatabaseSnapshot,
  type CompanionActivationSnapshotQuery,
} from './snapshot.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const STOP_WAIT_MS = 12_000;

export interface GuardedCompanionActivationPreflightInputs {
  readonly requestKey: string;
  /** Already-authenticated, short-lived read-only administrator query connection. */
  readonly administrator: CompanionActivationSnapshotQuery;
  readonly releaseInputs: Omit<CompanionActivationReleaseInputs, 'trustedNow'>;
  readonly dataRoot: string;
  readonly processVerifierScriptPath: string;
  readonly windowsEnvironment: NodeJS.ProcessEnv;
  /** Authenticated server operation; no production signing key is placed on Windows. */
  readonly signHandoff: (requestKey: string) => Promise<SignedCompanionExecutionActivationHandoff>;
  readonly trustedNow: () => Date;
  readonly signal?: AbortSignal;
}

interface GuardedCompanionActivationPreflightAdapters {
  readonly loadSnapshot: typeof loadCompanionActivationDatabaseSnapshot;
  readonly verifyRelease: typeof verifyPublishedCompanionReleaseAndInstalledTree;
  readonly publishHandoff: typeof publishGuardedCompanionHandoff;
  readonly openChannel: typeof openGuardedLocalLaunchProofChannel;
  readonly start: (
    input: GuardedCompanionProcessStarterInputs,
    launch: Readonly<{ challenge: string; pipePath: string }>,
  ) => GuardedCompanionOwnedChild;
  readonly observe: typeof observeGuardedWindowsCompanionProcess;
}

const productionAdapters: GuardedCompanionActivationPreflightAdapters = {
  loadSnapshot: loadCompanionActivationDatabaseSnapshot,
  verifyRelease: verifyPublishedCompanionReleaseAndInstalledTree,
  publishHandoff: publishGuardedCompanionHandoff,
  openChannel: openGuardedLocalLaunchProofChannel,
  start: (input, launch) => prepareGuardedWindowsCompanionProcessStarter(input)(launch),
  observe: observeGuardedWindowsCompanionProcess,
};

export class GuardedCompanionActivationPreflightUnavailableError extends Error {
  constructor() {
    super('The guarded companion activation preflight could not be confirmed.');
    this.name = 'GuardedCompanionActivationPreflightUnavailableError';
  }
}

export interface GuardedCompanionActivationPreflightResult {
  readonly releaseVerified: true;
  readonly signedHandoffPublished: true;
  readonly pairedProcessObserved: true;
  readonly exactHostStopped: true;
  readonly permitSent: false;
  readonly databaseTransitionInvoked: false;
  readonly attestationRetained: false;
}

function trustedTimestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error();
  return value.toISOString();
}

function sameSnapshot(
  first: CompanionActivationDatabaseSnapshot,
  second: CompanionActivationDatabaseSnapshot,
): boolean {
  return (
    JSON.stringify(first.request) === JSON.stringify(second.request) &&
    JSON.stringify(first.currentIdentity) === JSON.stringify(second.currentIdentity) &&
    JSON.stringify(first.certificate) === JSON.stringify(second.certificate)
  );
}

async function bounded(task: () => Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(task),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), STOP_WAIT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Test seam for one source-only, no-permit rehearsal. The production wrapper below
 * fixes every adapter to its reviewed implementation. Publication is create-once;
 * an unsuccessful run must be inspected, never retried with the same request.
 */
export async function rehearseGuardedCompanionActivationWithAdapters(
  input: GuardedCompanionActivationPreflightInputs,
  adapters: GuardedCompanionActivationPreflightAdapters,
): Promise<GuardedCompanionActivationPreflightResult> {
  let channel: GuardedLocalLaunchProofChannel | undefined;
  let child: GuardedCompanionOwnedChild | undefined;
  let verified = false;
  let cleanupFailed = false;
  try {
    if (
      !input ||
      !UUID_V4.test(input.requestKey) ||
      !input.administrator ||
      typeof input.administrator.query !== 'function' ||
      input.signal?.aborted
    )
      throw new Error();
    const first = await adapters.loadSnapshot(input.requestKey, input.administrator);
    if (first.request.requestKey !== input.requestKey || input.signal?.aborted) throw new Error();
    const release = await adapters.verifyRelease(first.request, {
      ...input.releaseInputs,
      trustedNow: input.trustedNow,
    });
    if (input.signal?.aborted) throw new Error();
    const publication: GuardedCompanionHandoffPublicationInputs = {
      ...first,
      release,
      dataRoot: input.dataRoot,
      signHandoff: input.signHandoff,
      trustedNow: input.trustedNow,
    };
    const handoff = await adapters.publishHandoff(publication);
    if (!DIGEST.test(handoff.handoffSha256) || input.signal?.aborted) throw new Error();

    const challenge = randomBytes(32).toString('base64url');
    const challengeIssuedAt = trustedTimestamp(input.trustedNow);
    channel = await adapters.openChannel(challenge);
    if (input.signal?.aborted) throw new Error();
    child = adapters.start(
      {
        request: first.request,
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
      typeof child.stopped?.then !== 'function'
    )
      throw new Error();
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
    const observed: CompanionActivationObservedProcess = await adapters.observe({
      request: first.request,
      certificate: first.certificate,
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
      observed.processId !== child.processId ||
      observed.executionHandoffSha256 !== handoff.handoffSha256 ||
      input.signal?.aborted
    )
      throw new Error();
    const second = await adapters.loadSnapshot(input.requestKey, input.administrator);
    if (
      input.signal?.aborted ||
      !sameSnapshot(first, second) ||
      !matchesCompanionActivationEvidence({
        ...second,
        release,
        process: {
          requestKey: input.requestKey,
          challenge,
          challengeIssuedAt,
          processId: observed.processId,
          startedAt: observed.startedAt,
          observedAt: observed.observedAt,
          executionHandoffSha256: observed.executionHandoffSha256,
          proof: observed.proof,
        },
        assessedAt: trustedTimestamp(input.trustedNow),
      })
    )
      throw new Error();
    verified = true;
  } catch {
    verified = false;
  } finally {
    if (child) {
      const ownedChild = child;
      try {
        await bounded(() => ownedChild.stop());
        await bounded(() => ownedChild.stopped);
      } catch {
        cleanupFailed = true;
      }
    }
    // This receiver cannot issue an execution permit, even after proof validation.
    if (channel) {
      const ownedChannel = channel;
      try {
        await bounded(() => ownedChannel.close());
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (!verified || cleanupFailed) throw new GuardedCompanionActivationPreflightUnavailableError();
  return Object.freeze({
    releaseVerified: true,
    signedHandoffPublished: true,
    pairedProcessObserved: true,
    exactHostStopped: true,
    permitSent: false,
    databaseTransitionInvoked: false,
    attestationRetained: false,
  });
}

/** No database mutation, permit, production entry point, or money-capable action. */
export async function rehearseGuardedCompanionActivation(
  input: GuardedCompanionActivationPreflightInputs,
): Promise<GuardedCompanionActivationPreflightResult> {
  if (process.platform !== 'win32') throw new GuardedCompanionActivationPreflightUnavailableError();
  return rehearseGuardedCompanionActivationWithAdapters(input, productionAdapters);
}
