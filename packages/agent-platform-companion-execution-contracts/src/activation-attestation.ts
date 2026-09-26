import { createHash, randomBytes } from 'node:crypto';

import {
  matchesCompanionActivationEvidence,
  type CompanionActivationCertificateSnapshot,
  type CompanionActivationCurrentIdentity,
  type CompanionActivationProcessObservation,
  type CompanionActivationReleaseAttestation,
  type CompanionActivationRequestSnapshot,
} from './activation-evidence.js';
import type { SignedCompanionLaunchProof } from './launch-proof.js';

export interface CompanionActivationDatabaseSnapshot {
  readonly request: CompanionActivationRequestSnapshot;
  readonly currentIdentity: CompanionActivationCurrentIdentity;
  readonly certificate: CompanionActivationCertificateSnapshot;
}

export interface CompanionActivationObservedProcess {
  readonly processId: number;
  readonly startedAt: string;
  readonly observedAt: string;
  readonly proof: SignedCompanionLaunchProof;
}

/** Exact digest-only witness accepted by the dormant Postgres activation transition. */
export interface CompanionActivationAttestation {
  readonly requestKey: string;
  readonly certificateBodyDigest: string;
  readonly companionReleaseSha: string;
  readonly companionArchiveSha256: string;
  readonly companionInstallationTreeSha256: string;
  readonly challengeDigest: string;
  readonly launchProofDigest: string;
  readonly processId: number;
  readonly processStartedAt: string;
  readonly challengeIssuedAt: string;
  readonly releaseObservedAt: string;
  readonly processObservedAt: string;
  readonly verifiedAt: string;
}

/**
 * These capabilities must be implemented by distinct trusted sources. In particular,
 * the release result may not be copied from an Owner claim, and the process result
 * must come from an OS-observed paired launch, not from the companion's own PID claim.
 */
export interface CompanionActivationAttestationSources {
  loadDatabaseSnapshot(requestKey: string): Promise<CompanionActivationDatabaseSnapshot>;
  verifyPublishedReleaseAndInstalledTree(
    request: CompanionActivationRequestSnapshot,
  ): Promise<CompanionActivationReleaseAttestation>;
  observePairedProcess(input: {
    readonly request: CompanionActivationRequestSnapshot;
    readonly certificate: CompanionActivationCertificateSnapshot;
    readonly challenge: string;
    readonly challengeIssuedAt: string;
  }): Promise<CompanionActivationObservedProcess>;
  /** The adapter must insert only this row through a trusted administrator session. */
  retainAttestation(attestation: CompanionActivationAttestation): Promise<void>;
  trustedNow(): Date;
}

export class CompanionActivationAttestationUnavailableError extends Error {
  constructor() {
    super('The companion activation attestation is unavailable.');
    this.name = 'CompanionActivationAttestationUnavailableError';
  }
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalNow(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new CompanionActivationAttestationUnavailableError();
  }
  return now.toISOString();
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

/**
 * Builds and retains a request-bound witness, without activating any role, switch,
 * execution control, queue item, or provider action. The caller must supply real
 * authenticated adapters; this package deliberately contains no production entry point.
 */
export async function retainCompanionActivationAttestation(
  requestKey: string,
  sources: CompanionActivationAttestationSources,
): Promise<void> {
  try {
    if (
      typeof requestKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestKey)
    ) {
      throw new Error();
    }
    const first = await sources.loadDatabaseSnapshot(requestKey);
    if (first.request.requestKey !== requestKey) throw new Error();

    const release = await sources.verifyPublishedReleaseAndInstalledTree(first.request);
    const challengeBytes = randomBytes(32);
    const challenge = challengeBytes.toString('base64url');
    const challengeDigest = sha256(challengeBytes);
    challengeBytes.fill(0);
    const challengeIssuedAt = canonicalNow(sources.trustedNow());
    const observed = await sources.observePairedProcess({
      request: first.request,
      certificate: first.certificate,
      challenge,
      challengeIssuedAt,
    });
    if (
      !Number.isInteger(observed.processId) ||
      observed.processId < 1 ||
      observed.processId > 2_147_483_647
    ) {
      throw new Error();
    }
    const process: CompanionActivationProcessObservation = {
      requestKey,
      challenge,
      challengeIssuedAt,
      processId: observed.processId,
      startedAt: observed.startedAt,
      observedAt: observed.observedAt,
      proof: observed.proof,
    };
    const second = await sources.loadDatabaseSnapshot(requestKey);
    const verifiedAt = canonicalNow(sources.trustedNow());
    if (
      !sameSnapshot(first, second) ||
      !matchesCompanionActivationEvidence({
        ...second,
        release,
        process,
        assessedAt: verifiedAt,
      })
    ) {
      throw new Error();
    }

    const attestation: CompanionActivationAttestation = Object.freeze({
      requestKey,
      certificateBodyDigest: second.certificate.certificateBodyDigest,
      companionReleaseSha: release.releaseSha,
      companionArchiveSha256: release.archiveSha256,
      companionInstallationTreeSha256: release.installationTreeSha256,
      challengeDigest,
      launchProofDigest: sha256(Buffer.from(JSON.stringify(observed.proof), 'utf8')),
      processId: observed.processId,
      processStartedAt: observed.startedAt,
      challengeIssuedAt,
      releaseObservedAt: release.observedAt,
      processObservedAt: observed.observedAt,
      verifiedAt,
    });
    await sources.retainAttestation(attestation);
  } catch {
    throw new CompanionActivationAttestationUnavailableError();
  }
}
