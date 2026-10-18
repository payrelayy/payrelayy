import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import type {
  CbeBirrApprovedReceiverLookupRootProfile,
  CbeBirrReceiverLookupChildKey,
  CbeBirrReceiverLookupOpeningProfile,
} from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-opening';

const HEX_KEY = /^[0-9a-f]{64}$/u;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const REVISION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface CbeBirrReceiverKeyProvisioningCheckInput {
  /** Independently approved revision identity, not copied from the proposed key or profile. */
  readonly approvedReceiverRevision: Readonly<{
    receiverRevisionId: string;
    receiverVersion: number;
  }>;
  readonly approvedRootProfile: CbeBirrApprovedReceiverLookupRootProfile;
  readonly ownerSecrets: Readonly<{
    encryptionMasterSecret: string;
    fingerprintMasterSecret: string;
  }>;
  readonly workerKey: CbeBirrReceiverLookupChildKey;
  readonly workerProfile: CbeBirrReceiverLookupOpeningProfile;
}

export interface CbeBirrReceiverKeyProvisioningWitness {
  readonly disposition: 'offline_consistency_only';
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly keyId: string;
  readonly rootEncryptionMasterFingerprint: string;
  readonly rootFingerprintMasterFingerprint: string;
  readonly workerProfileVersion: 1;
}

export class CbeBirrReceiverKeyProvisioningCheckError extends Error {
  constructor() {
    super('CBE Birr receiver key provisioning check failed.');
    this.name = 'CbeBirrReceiverKeyProvisioningCheckError';
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

/**
 * Trusted offline consistency check for one proposed receiver-revision child key. It neither
 * provisions files nor decides whether the revision is active or an official lookup is allowed.
 */
export function checkCbeBirrReceiverKeyProvisioning(
  candidate: CbeBirrReceiverKeyProvisioningCheckInput,
): CbeBirrReceiverKeyProvisioningWitness {
  let encryptionMaster: Buffer | undefined;
  let fingerprintMaster: Buffer | undefined;
  let derivedChild: Buffer | undefined;
  let proposedChild: Buffer | undefined;
  let encryptionRootId: Buffer | undefined;
  let fingerprintRootId: Buffer | undefined;
  let expectedEncryptionRootId: Buffer | undefined;
  let expectedFingerprintRootId: Buffer | undefined;
  let childId: Buffer | undefined;
  let expectedChildId: Buffer | undefined;
  try {
    const input = exactDataProperties(candidate, [
      'approvedReceiverRevision',
      'approvedRootProfile',
      'ownerSecrets',
      'workerKey',
      'workerProfile',
    ]);
    if (input === undefined) throw new Error();
    const approvedRevision = exactDataProperties(input.approvedReceiverRevision, [
      'receiverRevisionId',
      'receiverVersion',
    ]);
    const root = exactDataProperties(input.approvedRootProfile, [
      'encryptionMasterFingerprint',
      'fingerprintMasterFingerprint',
      'purpose',
      'version',
    ]);
    const secrets = exactDataProperties(input.ownerSecrets, [
      'encryptionMasterSecret',
      'fingerprintMasterSecret',
    ]);
    const key = exactDataProperties(input.workerKey, [
      'contractVersion',
      'providerCode',
      'purpose',
      'receiverRevisionId',
      'receiverVersion',
      'keyId',
      'keyHex',
    ]);
    const profile = exactDataProperties(input.workerProfile, [
      'version',
      'providerCode',
      'purpose',
      'receiverRevisionId',
      'receiverVersion',
      'keyId',
      'rootEncryptionMasterFingerprint',
      'rootFingerprintMasterFingerprint',
    ]);
    if (
      approvedRevision === undefined ||
      root === undefined ||
      secrets === undefined ||
      key === undefined ||
      profile === undefined ||
      root.version !== 2 ||
      root.purpose !== 'cbe_birr_receiver_lookup' ||
      typeof root.encryptionMasterFingerprint !== 'string' ||
      !SHA256_ID.test(root.encryptionMasterFingerprint) ||
      typeof root.fingerprintMasterFingerprint !== 'string' ||
      !SHA256_ID.test(root.fingerprintMasterFingerprint) ||
      root.encryptionMasterFingerprint === root.fingerprintMasterFingerprint ||
      typeof secrets.encryptionMasterSecret !== 'string' ||
      !HEX_KEY.test(secrets.encryptionMasterSecret) ||
      typeof secrets.fingerprintMasterSecret !== 'string' ||
      !HEX_KEY.test(secrets.fingerprintMasterSecret) ||
      secrets.encryptionMasterSecret === secrets.fingerprintMasterSecret ||
      typeof approvedRevision.receiverRevisionId !== 'string' ||
      !REVISION_ID.test(approvedRevision.receiverRevisionId) ||
      typeof approvedRevision.receiverVersion !== 'number' ||
      !Number.isSafeInteger(approvedRevision.receiverVersion) ||
      approvedRevision.receiverVersion < 1 ||
      approvedRevision.receiverVersion > 2_147_483_647 ||
      key.contractVersion !== 1 ||
      key.providerCode !== 'cbe_birr' ||
      key.purpose !== 'receiver-lookup-opening' ||
      typeof key.receiverRevisionId !== 'string' ||
      !REVISION_ID.test(key.receiverRevisionId) ||
      typeof key.receiverVersion !== 'number' ||
      !Number.isSafeInteger(key.receiverVersion) ||
      key.receiverVersion < 1 ||
      key.receiverVersion > 2_147_483_647 ||
      key.receiverRevisionId !== approvedRevision.receiverRevisionId ||
      key.receiverVersion !== approvedRevision.receiverVersion ||
      typeof key.keyId !== 'string' ||
      !SHA256_ID.test(key.keyId) ||
      typeof key.keyHex !== 'string' ||
      !HEX_KEY.test(key.keyHex) ||
      profile.version !== 1 ||
      profile.providerCode !== 'cbe_birr' ||
      profile.purpose !== 'receiver-lookup-opening' ||
      profile.receiverRevisionId !== key.receiverRevisionId ||
      profile.receiverVersion !== key.receiverVersion ||
      profile.keyId !== key.keyId ||
      profile.rootEncryptionMasterFingerprint !== root.encryptionMasterFingerprint ||
      profile.rootFingerprintMasterFingerprint !== root.fingerprintMasterFingerprint
    ) {
      throw new Error();
    }

    encryptionMaster = Buffer.from(secrets.encryptionMasterSecret, 'hex');
    fingerprintMaster = Buffer.from(secrets.fingerprintMasterSecret, 'hex');
    encryptionRootId = createHash('sha256').update(encryptionMaster).digest();
    fingerprintRootId = createHash('sha256').update(fingerprintMaster).digest();
    expectedEncryptionRootId = Buffer.from(root.encryptionMasterFingerprint.slice(7), 'hex');
    expectedFingerprintRootId = Buffer.from(root.fingerprintMasterFingerprint.slice(7), 'hex');
    if (
      !timingSafeEqual(encryptionRootId, expectedEncryptionRootId) ||
      !timingSafeEqual(fingerprintRootId, expectedFingerprintRootId)
    ) {
      throw new Error();
    }

    derivedChild = createHmac('sha256', encryptionMaster)
      .update(
        `fetanagent:cbe-birr:receiver-lookup:encryption-key:v2\nrevision:${key.receiverRevisionId}\nversion:${key.receiverVersion}`,
        'utf8',
      )
      .digest();
    proposedChild = Buffer.from(key.keyHex, 'hex');
    childId = createHash('sha256').update(derivedChild).digest();
    expectedChildId = Buffer.from(key.keyId.slice(7), 'hex');
    if (
      !timingSafeEqual(derivedChild, proposedChild) ||
      !timingSafeEqual(childId, expectedChildId)
    ) {
      throw new Error();
    }

    return Object.freeze({
      disposition: 'offline_consistency_only',
      receiverRevisionId: key.receiverRevisionId,
      receiverVersion: key.receiverVersion,
      keyId: key.keyId,
      rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
      rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
      workerProfileVersion: 1,
    });
  } catch {
    throw new CbeBirrReceiverKeyProvisioningCheckError();
  } finally {
    encryptionMaster?.fill(0);
    fingerprintMaster?.fill(0);
    derivedChild?.fill(0);
    proposedChild?.fill(0);
    encryptionRootId?.fill(0);
    fingerprintRootId?.fill(0);
    expectedEncryptionRootId?.fill(0);
    expectedFingerprintRootId?.fill(0);
    childId?.fill(0);
    expectedChildId?.fill(0);
  }
}
