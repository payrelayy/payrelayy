import { createHash } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import type {
  CbeBirrApprovedReceiverLookupRootProfile,
  CbeBirrReceiverLookupChildKey,
  CbeBirrReceiverLookupOpeningProfile,
} from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-opening';
import { deriveCbeBirrReceiverLookupChildKey } from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-provisioning';

import {
  checkCbeBirrReceiverKeyProvisioning,
  type CbeBirrReceiverKeyProvisioningWitness,
} from './receiver-lookup.js';

const REVISION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SNAPSHOT_KEYS = [
  'receiverRevisionId',
  'receiverVersion',
  'protectionProfileVersion',
  'encryptionKeyVersion',
  'fingerprintKeyVersion',
] as const;

/** The Owner adapter supplies this point-in-time metadata without receiver or key material. */
export interface CbeBirrReceiverProvisioningSnapshot {
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly protectionProfileVersion: 2;
  readonly encryptionKeyVersion: 2;
  readonly fingerprintKeyVersion: 2;
}

export interface CbeBirrReceiverProvisioningCandidateInput {
  readonly actorAuthUserId: string;
  /** Independently confirmed by the Owner, not copied from a proposed child key. */
  readonly approvedReceiverRevision: Readonly<{
    receiverRevisionId: string;
    receiverVersion: number;
  }>;
  readonly approvedRootProfile: CbeBirrApprovedReceiverLookupRootProfile;
  readonly ownerSecrets: Readonly<{
    encryptionMasterSecret: string;
    fingerprintMasterSecret: string;
  }>;
  readonly deploymentTarget: 'staging' | 'production';
  /** Inject only the trusted Owner adapter; this package has no database or HTTP access. */
  readonly readActiveSnapshot: (
    actorAuthUserId: string,
    approvedReceiverRevision: Readonly<{ receiverRevisionId: string; receiverVersion: number }>,
  ) => Promise<unknown>;
}

export interface CbeBirrReceiverProvisioningCandidate {
  readonly disposition: 'offline_candidate_only';
  /** Secret: only a trusted provisioner may handle this field. It is omitted from JSON output. */
  readonly workerKey: CbeBirrReceiverLookupChildKey;
  readonly workerProfile: CbeBirrReceiverLookupOpeningProfile;
  /** Exact nonsecret UTF-8 file contents; digests below include the final newline. */
  readonly rootProfileUtf8: string;
  readonly workerProfileUtf8: string;
  /** Proposed pins require separate release approval before a worker may use them. */
  readonly proposedPins: Readonly<{
    deploymentTarget: 'staging' | 'production';
    receiverRevisionId: string;
    receiverVersion: number;
    rootProfileSha256: string;
    workerProfileSha256: string;
    workerKeyId: string;
  }>;
  readonly witness: CbeBirrReceiverKeyProvisioningWitness;
}

export class CbeBirrReceiverProvisioningCandidateError extends Error {
  constructor() {
    super('CBE Birr receiver provisioning candidate is unavailable.');
    this.name = 'CbeBirrReceiverProvisioningCandidateError';
  }
}

function exactDataProperties(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    nodeUtilTypes.isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Object.prototype
  ) {
    return undefined;
  }
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function requireSnapshot(
  candidate: unknown,
  expected: Readonly<{ receiverRevisionId: string; receiverVersion: number }>,
): void {
  const snapshot = exactDataProperties(candidate, SNAPSHOT_KEYS);
  if (
    snapshot === undefined ||
    snapshot.receiverRevisionId !== expected.receiverRevisionId ||
    snapshot.receiverVersion !== expected.receiverVersion ||
    snapshot.protectionProfileVersion !== 2 ||
    snapshot.encryptionKeyVersion !== 2 ||
    snapshot.fingerprintKeyVersion !== 2
  ) {
    throw new CbeBirrReceiverProvisioningCandidateError();
  }
}

function digest(utf8: string): string {
  return `sha256:${createHash('sha256').update(utf8, 'utf8').digest('hex')}`;
}

/**
 * Prepare one secret child and proposed release pins in a trusted offline process. The snapshot
 * is checked on both sides of derivation. This function writes no file, approves no pin, and
 * cannot make the child active; delivery and worker use each need a fresh revision check.
 */
export async function prepareCbeBirrReceiverProvisioningCandidate(
  input: CbeBirrReceiverProvisioningCandidateInput,
): Promise<CbeBirrReceiverProvisioningCandidate> {
  try {
    const values = exactDataProperties(input, [
      'actorAuthUserId',
      'approvedReceiverRevision',
      'approvedRootProfile',
      'ownerSecrets',
      'deploymentTarget',
      'readActiveSnapshot',
    ]);
    const revision = exactDataProperties(values?.approvedReceiverRevision, [
      'receiverRevisionId',
      'receiverVersion',
    ]);
    const root = exactDataProperties(values?.approvedRootProfile, [
      'encryptionMasterFingerprint',
      'fingerprintMasterFingerprint',
      'purpose',
      'version',
    ]);
    const secrets = exactDataProperties(values?.ownerSecrets, [
      'encryptionMasterSecret',
      'fingerprintMasterSecret',
    ]);
    if (
      values === undefined ||
      revision === undefined ||
      root === undefined ||
      secrets === undefined ||
      typeof values.actorAuthUserId !== 'string' ||
      !ACTOR_ID.test(values.actorAuthUserId) ||
      typeof revision.receiverRevisionId !== 'string' ||
      !REVISION_ID.test(revision.receiverRevisionId) ||
      typeof revision.receiverVersion !== 'number' ||
      !Number.isSafeInteger(revision.receiverVersion) ||
      revision.receiverVersion < 1 ||
      revision.receiverVersion > 2_147_483_647 ||
      (values.deploymentTarget !== 'staging' && values.deploymentTarget !== 'production') ||
      typeof values.readActiveSnapshot !== 'function' ||
      typeof secrets.encryptionMasterSecret !== 'string' ||
      typeof secrets.fingerprintMasterSecret !== 'string' ||
      root.version !== 2 ||
      root.purpose !== 'cbe_birr_receiver_lookup' ||
      typeof root.encryptionMasterFingerprint !== 'string' ||
      typeof root.fingerprintMasterFingerprint !== 'string'
    ) {
      throw new CbeBirrReceiverProvisioningCandidateError();
    }
    const actorAuthUserId = values.actorAuthUserId;
    const approvedReceiverRevision = Object.freeze({
      receiverRevisionId: revision.receiverRevisionId,
      receiverVersion: revision.receiverVersion,
    });
    const readActiveSnapshot =
      values.readActiveSnapshot as CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot'];
    requireSnapshot(
      await readActiveSnapshot(actorAuthUserId, approvedReceiverRevision),
      approvedReceiverRevision,
    );

    const approvedRootProfile: CbeBirrApprovedReceiverLookupRootProfile = {
      version: 2,
      purpose: 'cbe_birr_receiver_lookup',
      encryptionMasterFingerprint: root.encryptionMasterFingerprint,
      fingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
    };
    const ownerSecrets = {
      encryptionMasterSecret: secrets.encryptionMasterSecret,
      fingerprintMasterSecret: secrets.fingerprintMasterSecret,
    };
    const workerKey = deriveCbeBirrReceiverLookupChildKey({
      receiverRevisionId: approvedReceiverRevision.receiverRevisionId,
      receiverVersion: approvedReceiverRevision.receiverVersion,
      encryptionSecret: ownerSecrets.encryptionMasterSecret,
    });
    const workerProfile: CbeBirrReceiverLookupOpeningProfile = Object.freeze({
      version: 1,
      providerCode: 'cbe_birr',
      purpose: 'receiver-lookup-opening',
      receiverRevisionId: approvedReceiverRevision.receiverRevisionId,
      receiverVersion: approvedReceiverRevision.receiverVersion,
      keyId: workerKey.keyId,
      rootEncryptionMasterFingerprint: approvedRootProfile.encryptionMasterFingerprint,
      rootFingerprintMasterFingerprint: approvedRootProfile.fingerprintMasterFingerprint,
    });
    const witness = checkCbeBirrReceiverKeyProvisioning({
      approvedReceiverRevision,
      approvedRootProfile,
      ownerSecrets,
      workerKey,
      workerProfile,
    });
    requireSnapshot(
      await readActiveSnapshot(actorAuthUserId, approvedReceiverRevision),
      approvedReceiverRevision,
    );

    const rootProfileUtf8 = `${JSON.stringify(approvedRootProfile)}\n`;
    const workerProfileUtf8 = `${JSON.stringify(workerProfile)}\n`;
    const output = {
      disposition: 'offline_candidate_only' as const,
      workerKey,
      workerProfile,
      rootProfileUtf8,
      workerProfileUtf8,
      proposedPins: Object.freeze({
        deploymentTarget: values.deploymentTarget,
        receiverRevisionId: approvedReceiverRevision.receiverRevisionId,
        receiverVersion: approvedReceiverRevision.receiverVersion,
        rootProfileSha256: digest(rootProfileUtf8),
        workerProfileSha256: digest(workerProfileUtf8),
        workerKeyId: workerKey.keyId,
      }),
      witness,
    };
    Object.defineProperty(output, 'workerKey', { enumerable: false });
    return Object.freeze(output);
  } catch {
    throw new CbeBirrReceiverProvisioningCandidateError();
  }
}
