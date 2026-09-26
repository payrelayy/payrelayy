import { createHash } from 'node:crypto';

import {
  verifyCompanionExecutionLaunchProof,
  type SignedCompanionExecutionLaunchProof,
} from './launch-proof.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RELEASE = /^[0-9a-f]{40}$/u;
const DEVICE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_REQUEST_MS = 10 * 60_000;
const MAX_EVIDENCE_AGE_MS = 2 * 60_000;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

/** Immutable request fields loaded from the database, not from the companion or Owner form. */
export interface CompanionActivationRequestSnapshot {
  readonly requestKey: string;
  readonly pilotRevisionId: string;
  readonly activationEpoch: string;
  readonly certificateId: string;
  readonly platformAgentAccountId: string;
  readonly companionReleaseSha: string;
  readonly companionArchiveSha256: string;
  readonly companionInstallationTreeSha256: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

/** Current independently read database identities; this is not a state/permission preflight. */
export interface CompanionActivationCurrentIdentity {
  readonly pilotRevisionId: string;
  readonly activationEpoch: string;
  readonly certificateId: string;
  readonly platformAgentAccountId: string;
}

/** Certificate body and digest read from the trusted database, never from local pairing storage. */
export interface CompanionActivationCertificateSnapshot {
  readonly certificateId: string;
  readonly certificateBodyDigest: string;
  readonly deviceKeyId: string;
  readonly devicePublicKeySpki: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

/** Result of an independent archive and installed-tree measurement. */
export interface CompanionActivationReleaseAttestation {
  readonly releaseSha: string;
  readonly archiveSha256: string;
  readonly installationTreeSha256: string;
  readonly observedAt: string;
}

/** A challenge issued for this request, with a signed observation of the launched OS process. */
export interface CompanionActivationProcessObservation {
  readonly requestKey: string;
  readonly challenge: string;
  readonly challengeIssuedAt: string;
  readonly processId: number;
  readonly startedAt: string;
  readonly observedAt: string;
  readonly executionHandoffSha256: string;
  readonly proof: SignedCompanionExecutionLaunchProof;
}

export interface CompanionActivationEvidenceContext {
  readonly request: CompanionActivationRequestSnapshot;
  readonly currentIdentity: CompanionActivationCurrentIdentity;
  readonly certificate: CompanionActivationCertificateSnapshot;
  readonly release: CompanionActivationReleaseAttestation;
  readonly process: CompanionActivationProcessObservation;
  /** Trusted server time, not a clock supplied by the Windows companion. */
  readonly assessedAt: string;
}

function timestamp(value: string): number | undefined {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

function epoch(value: string): boolean {
  try {
    return (
      typeof value === 'string' &&
      /^[1-9][0-9]*$/u.test(value) &&
      BigInt(value) <= POSTGRES_BIGINT_MAX
    );
  } catch {
    return false;
  }
}

function publicKeyMatchesDigest(encoded: string, expectedDigest: string): boolean {
  if (typeof encoded !== 'string' || !SHA256.test(expectedDigest)) return false;
  const bytes = Buffer.from(encoded, 'base64url');
  return (
    bytes.length === 91 &&
    bytes.toString('base64url') === encoded &&
    `sha256:${createHash('sha256').update(bytes).digest('hex')}` === expectedDigest
  );
}

/**
 * Checks identity, time, attestation, and signed launch-proof consistency only.
 * The caller must independently authenticate the database snapshots, challenge issuer,
 * release measurement, signed handoff, OS process observation, and trusted clock.
 * The v2 execution-mode field alone is a signed claim, not OS or handoff proof. This does not check
 * pilot/switch/role/queue state, consume the request, create a credential, or arm execution.
 */
export function matchesCompanionActivationEvidence(
  context: CompanionActivationEvidenceContext,
): boolean {
  try {
    const { request, currentIdentity, certificate, release, process } = context;
    const requestedAt = timestamp(request.requestedAt);
    const expiresAt = timestamp(request.expiresAt);
    const assessedAt = timestamp(context.assessedAt);
    const certificateValidFrom = timestamp(certificate.validFrom);
    const certificateValidUntil = timestamp(certificate.validUntil);
    const releaseObservedAt = timestamp(release.observedAt);
    const challengeIssuedAt = timestamp(process.challengeIssuedAt);
    const processStartedAt = timestamp(process.startedAt);
    const processObservedAt = timestamp(process.observedAt);
    if (
      !UUID_V4.test(request.requestKey) ||
      !UUID_V4.test(request.pilotRevisionId) ||
      !epoch(request.activationEpoch) ||
      !UUID_V4.test(request.certificateId) ||
      !UUID_V4.test(request.platformAgentAccountId) ||
      !RELEASE.test(request.companionReleaseSha) ||
      !SHA256.test(request.companionArchiveSha256) ||
      !SHA256.test(request.companionInstallationTreeSha256) ||
      requestedAt === undefined ||
      expiresAt === undefined ||
      assessedAt === undefined ||
      expiresAt <= requestedAt ||
      expiresAt - requestedAt > MAX_REQUEST_MS ||
      assessedAt < requestedAt ||
      assessedAt >= expiresAt ||
      currentIdentity.pilotRevisionId !== request.pilotRevisionId ||
      currentIdentity.activationEpoch !== request.activationEpoch ||
      currentIdentity.certificateId !== request.certificateId ||
      currentIdentity.platformAgentAccountId !== request.platformAgentAccountId ||
      certificate.certificateId !== request.certificateId ||
      !SHA256.test(certificate.certificateBodyDigest) ||
      !DEVICE_KEY_ID.test(certificate.deviceKeyId) ||
      !publicKeyMatchesDigest(
        certificate.devicePublicKeySpki,
        certificate.devicePublicKeySpkiSha256,
      ) ||
      certificateValidFrom === undefined ||
      certificateValidUntil === undefined ||
      certificateValidFrom > requestedAt ||
      certificateValidUntil <= assessedAt ||
      release.releaseSha !== request.companionReleaseSha ||
      release.archiveSha256 !== request.companionArchiveSha256 ||
      release.installationTreeSha256 !== request.companionInstallationTreeSha256 ||
      releaseObservedAt === undefined ||
      releaseObservedAt < requestedAt ||
      releaseObservedAt > assessedAt ||
      assessedAt - releaseObservedAt > MAX_EVIDENCE_AGE_MS ||
      process.requestKey !== request.requestKey ||
      challengeIssuedAt === undefined ||
      challengeIssuedAt < requestedAt ||
      challengeIssuedAt > assessedAt ||
      assessedAt - challengeIssuedAt > MAX_EVIDENCE_AGE_MS ||
      processObservedAt === undefined ||
      processStartedAt === undefined ||
      processStartedAt < requestedAt ||
      processStartedAt < challengeIssuedAt - 5_000 ||
      processStartedAt > processObservedAt ||
      processObservedAt < challengeIssuedAt ||
      processObservedAt > assessedAt ||
      assessedAt - processObservedAt > MAX_EVIDENCE_AGE_MS ||
      !SHA256.test(process.executionHandoffSha256)
    ) {
      return false;
    }
    return verifyCompanionExecutionLaunchProof(process.proof, {
      challenge: process.challenge,
      certificateBodyDigest: certificate.certificateBodyDigest,
      deviceKeyId: certificate.deviceKeyId,
      devicePublicKeySpki: certificate.devicePublicKeySpki,
      releaseSha: release.releaseSha,
      installationTreeSha256: release.installationTreeSha256,
      requestKey: request.requestKey,
      activationEpoch: request.activationEpoch,
      platformAgentAccountId: request.platformAgentAccountId,
      executionHandoffSha256: process.executionHandoffSha256,
      processId: process.processId,
      startedAt: process.startedAt,
      observedAt: process.observedAt,
    });
  } catch {
    return false;
  }
}
