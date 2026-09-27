import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
  COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE,
  COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
  signCompanionExecutionActivationHandoff,
  type CompanionActivationCertificateSnapshot,
  type CompanionActivationCurrentIdentity,
  type CompanionActivationReleaseAttestation,
  type CompanionActivationRequestSnapshot,
} from '@fetanagent/agent-platform-companion-execution-contracts';

const HANDOFF_FILE = 'activation-handoff.v1.json';
const MAX_HANDOFF_BYTES = 4_096;
const MAX_REQUEST_MS = 10 * 60_000;
const MAX_RELEASE_AGE_MS = 2 * 60_000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RELEASE = /^[0-9a-f]{40}$/u;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export interface GuardedCompanionHandoffPublicationInputs {
  /** Already-authenticated database snapshot, never an Owner form or companion claim. */
  readonly request: CompanionActivationRequestSnapshot;
  readonly currentIdentity: CompanionActivationCurrentIdentity;
  readonly certificate: CompanionActivationCertificateSnapshot;
  /** Independently measured published archive and installed tree. */
  readonly release: CompanionActivationReleaseAttestation;
  /** Existing, operator-protected Windows companion data root. */
  readonly dataRoot: string;
  /** Protected signer key object; never a string, path, environment variable, or process argument. */
  readonly signerPrivateKey: KeyObject;
  readonly trustedNow: () => Date;
}

interface TrustedSigner {
  readonly keyId: string;
  readonly publicKeySpkiSha256: string;
}

const PRODUCTION_SIGNER: TrustedSigner = {
  keyId: PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  publicKeySpkiSha256: PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
};

export class GuardedCompanionHandoffPublicationUnavailableError extends Error {
  constructor() {
    super('The guarded companion execution handoff could not be published.');
    this.name = 'GuardedCompanionHandoffPublicationUnavailableError';
  }
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) throw new Error();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error();
  return parsed;
}

function trustedTime(source: () => Date): number {
  const value = source();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error();
  return value.getTime();
}

function validPairedPublicKey(certificate: CompanionActivationCertificateSnapshot): boolean {
  try {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(certificate.deviceKeyId) ||
      !DIGEST.test(certificate.devicePublicKeySpkiSha256) ||
      typeof certificate.devicePublicKeySpki !== 'string' ||
      !/^[A-Za-z0-9_-]{122}$/u.test(certificate.devicePublicKeySpki)
    )
      return false;
    const bytes = Buffer.from(certificate.devicePublicKeySpki, 'base64url');
    if (bytes.length !== 91 || bytes.toString('base64url') !== certificate.devicePublicKeySpki)
      return false;
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    const canonical = key.export({ format: 'der', type: 'spki' });
    return (
      key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
      Buffer.isBuffer(canonical) &&
      canonical.equals(bytes) &&
      `sha256:${createHash('sha256').update(bytes).digest('hex')}` ===
        certificate.devicePublicKeySpkiSha256
    );
  } catch {
    return false;
  }
}

function validateBinding(input: GuardedCompanionHandoffPublicationInputs, now: number): number {
  const { request, currentIdentity, certificate, release } = input;
  const requestedAt = timestamp(request.requestedAt);
  const requestExpiresAt = timestamp(request.expiresAt);
  const certificateValidFrom = timestamp(certificate.validFrom);
  const certificateValidUntil = timestamp(certificate.validUntil);
  const releaseObservedAt = timestamp(release.observedAt);
  // The request is an issuance/consumption deadline, not the runtime lifetime.
  // The database can grant up to two hours when it consumes the request, so the
  // local handoff must not stop a legitimate session at the ten-minute deadline.
  const handoffExpiresAt = Math.min(
    requestExpiresAt + COMPANION_EXECUTION_MAX_DATABASE_ACTIVATION_LIFETIME_MS,
    certificateValidUntil,
  );
  if (
    !UUID_V4.test(request.requestKey) ||
    !UUID_V4.test(request.pilotRevisionId) ||
    !UUID_V4.test(request.certificateId) ||
    !UUID_V4.test(request.platformAgentAccountId) ||
    !/^[1-9][0-9]{0,18}$/u.test(request.activationEpoch) ||
    BigInt(request.activationEpoch) > POSTGRES_BIGINT_MAX ||
    !RELEASE.test(request.companionReleaseSha) ||
    !DIGEST.test(request.companionArchiveSha256) ||
    !DIGEST.test(request.companionInstallationTreeSha256) ||
    requestExpiresAt <= requestedAt ||
    requestExpiresAt - requestedAt > MAX_REQUEST_MS ||
    now < requestedAt ||
    now >= requestExpiresAt ||
    now >= handoffExpiresAt ||
    currentIdentity.pilotRevisionId !== request.pilotRevisionId ||
    currentIdentity.activationEpoch !== request.activationEpoch ||
    currentIdentity.certificateId !== request.certificateId ||
    currentIdentity.platformAgentAccountId !== request.platformAgentAccountId ||
    certificate.certificateId !== request.certificateId ||
    !DIGEST.test(certificate.certificateBodyDigest) ||
    !validPairedPublicKey(certificate) ||
    certificateValidFrom > requestedAt ||
    certificateValidUntil <= now ||
    release.releaseSha !== request.companionReleaseSha ||
    release.archiveSha256 !== request.companionArchiveSha256 ||
    release.installationTreeSha256 !== request.companionInstallationTreeSha256 ||
    releaseObservedAt < requestedAt ||
    releaseObservedAt > now ||
    now - releaseObservedAt > MAX_RELEASE_AGE_MS
  )
    throw new Error();
  return handoffExpiresAt;
}

async function canonicalPublicationDirectory(dataRoot: string): Promise<string> {
  if (!isAbsolute(dataRoot) || resolve(dataRoot) !== dataRoot) throw new Error();
  const directory = resolve(dataRoot, 'execution-v2');
  const [rootStat, directoryStat, realRoot, realDirectory] = await Promise.all([
    lstat(dataRoot),
    lstat(directory),
    realpath(dataRoot),
    realpath(directory),
  ]);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    realRoot !== dataRoot ||
    realDirectory !== directory
  )
    throw new Error();
  return directory;
}

/**
 * Test seam for a protected operator workflow. This publishes once and never overwrites an
 * existing handoff; a failed post-create write deliberately leaves a fail-closed file for review.
 * It does not consume the database request, enable execution, or launch the companion.
 */
export async function publishGuardedCompanionHandoffWithSigner(
  input: GuardedCompanionHandoffPublicationInputs,
  signer: TrustedSigner,
): Promise<Readonly<{ handoffSha256: string; expiresAt: string }>> {
  try {
    const now = trustedTime(input.trustedNow);
    const expiresAtMs = validateBinding(input, now);
    const directory = await canonicalPublicationDirectory(input.dataRoot);
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(expiresAtMs).toISOString();
    const signed = signCompanionExecutionActivationHandoff(
      {
        contractVersion: 1,
        purpose: COMPANION_EXECUTION_ACTIVATION_HANDOFF_PURPOSE,
        deploymentTarget: 'production',
        requestKey: input.request.requestKey,
        activationEpoch: input.request.activationEpoch,
        platformAgentAccountId: input.request.platformAgentAccountId,
        noMoneyCertificateBodyDigest: input.certificate.certificateBodyDigest,
        companionReleaseSha: input.release.releaseSha,
        companionArchiveSha256: input.release.archiveSha256,
        companionInstallationTreeSha256: input.release.installationTreeSha256,
        issuedAt,
        notBefore: issuedAt,
        expiresAt,
      },
      input.signerPrivateKey,
      signer.keyId,
      signer.publicKeySpkiSha256,
    );
    if (!signed) throw new Error();
    const raw = JSON.stringify(signed);
    if (Buffer.byteLength(raw, 'utf8') < 2 || Buffer.byteLength(raw, 'utf8') > MAX_HANDOFF_BYTES)
      throw new Error();
    const beforeWrite = trustedTime(input.trustedNow);
    if (
      beforeWrite < now ||
      beforeWrite >= timestamp(input.request.expiresAt) ||
      beforeWrite >= expiresAtMs
    )
      throw new Error();
    const file = resolve(directory, HANDOFF_FILE);
    const handle = await open(file, 'wx', 0o600);
    try {
      await handle.writeFile(raw, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const [fileStat, realFile, realDirectory, stored] = await Promise.all([
      lstat(file),
      realpath(file),
      realpath(directory),
      readFile(file, 'utf8'),
    ]);
    const afterWrite = trustedTime(input.trustedNow);
    if (
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      fileStat.size !== Buffer.byteLength(raw, 'utf8') ||
      realFile !== file ||
      realDirectory !== directory ||
      stored !== raw ||
      afterWrite < beforeWrite ||
      afterWrite >= timestamp(input.request.expiresAt) ||
      afterWrite >= expiresAtMs
    )
      throw new Error();
    return Object.freeze({
      handoffSha256: `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`,
      expiresAt,
    });
  } catch {
    throw new GuardedCompanionHandoffPublicationUnavailableError();
  }
}

/** Production wrapper; intentionally absent from the root SQL-only entry point. */
export async function publishGuardedCompanionHandoff(
  input: GuardedCompanionHandoffPublicationInputs,
): Promise<Readonly<{ handoffSha256: string; expiresAt: string }>> {
  if (process.platform !== 'win32') throw new GuardedCompanionHandoffPublicationUnavailableError();
  return publishGuardedCompanionHandoffWithSigner(input, PRODUCTION_SIGNER);
}
