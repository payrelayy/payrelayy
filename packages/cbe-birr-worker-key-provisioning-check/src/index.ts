import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

export {
  CbeBirrReceiverProvisioningCandidateError,
  prepareCbeBirrReceiverProvisioningCandidate,
  type CbeBirrReceiverProvisioningCandidate,
  type CbeBirrReceiverProvisioningCandidateInput,
  type CbeBirrReceiverProvisioningSnapshot,
} from './receiver-lookup-candidate.js';

import {
  CBE_BIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION,
  CBE_BIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  CBE_BIRR_REFERENCE_OPENING_KEY_VERSION,
  CBE_BIRR_REFERENCE_OPENING_PROFILE_VERSION,
  CBE_BIRR_REFERENCE_OPENING_PROVIDER,
  CBE_BIRR_REFERENCE_OPENING_PURPOSE,
  CBE_BIRR_REFERENCE_OPENING_ROOT_PROFILE_VERSION,
  CBE_BIRR_REFERENCE_OPENING_SOURCE_PROFILE,
  type CbeBirrApprovedProofRootProfile,
  type CbeBirrReferenceOpeningProfile,
  type CbeBirrScopedReferenceOpeningKey,
} from '@fetanagent/cbe-birr-reference-opening';

export {
  CbeBirrReceiverKeyProvisioningCheckError,
  checkCbeBirrReceiverKeyProvisioning,
  type CbeBirrReceiverKeyProvisioningCheckInput,
  type CbeBirrReceiverKeyProvisioningWitness,
} from './receiver-lookup.js';

const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CBE_ENCRYPTION_CHILD_DOMAIN =
  'fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:cbe_birr' as const;

export interface CbeBirrWorkerKeyProvisioningCheckInput {
  readonly approvedRootProfile: CbeBirrApprovedProofRootProfile;
  readonly producerSecrets: Readonly<{
    encryptionMasterSecret: string;
    fingerprintMasterSecret: string;
  }>;
  readonly workerKey: CbeBirrScopedReferenceOpeningKey;
  readonly workerProfile: CbeBirrReferenceOpeningProfile;
}

export interface CbeBirrWorkerKeyProvisioningWitness {
  readonly disposition: 'offline_consistency_only';
  readonly keyId: string;
  readonly providerCode: typeof CBE_BIRR_REFERENCE_OPENING_PROVIDER;
  readonly rootEncryptionMasterFingerprint: string;
  readonly rootFingerprintMasterFingerprint: string;
  readonly sourceProfile: typeof CBE_BIRR_REFERENCE_OPENING_SOURCE_PROFILE;
  readonly workerProfileVersion: typeof CBE_BIRR_REFERENCE_OPENING_PROFILE_VERSION;
}

export class CbeBirrWorkerKeyProvisioningCheckError extends Error {
  constructor() {
    super('CBE Birr worker key provisioning check failed.');
    this.name = 'CbeBirrWorkerKeyProvisioningCheckError';
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
 * Checks a proposed child key in a trusted offline process. The worker must receive only the
 * separately provisioned child and a deployment-pinned nonsecret profile, never these masters.
 * A successful result proves local derivation consistency, not custody or lookup eligibility.
 */
export function checkCbeBirrWorkerKeyProvisioning(
  candidate: CbeBirrWorkerKeyProvisioningCheckInput,
): CbeBirrWorkerKeyProvisioningWitness {
  let encryptionMaster: Buffer | undefined;
  let fingerprintMaster: Buffer | undefined;
  let child: Buffer | undefined;
  let proposedChild: Buffer | undefined;
  let actualEncryptionRootId: Buffer | undefined;
  let actualFingerprintRootId: Buffer | undefined;
  let expectedEncryptionRootId: Buffer | undefined;
  let expectedFingerprintRootId: Buffer | undefined;
  let actualChildId: Buffer | undefined;
  let expectedChildId: Buffer | undefined;
  try {
    const input = exactDataProperties(candidate, [
      'approvedRootProfile',
      'producerSecrets',
      'workerKey',
      'workerProfile',
    ]);
    if (input === undefined) throw new Error();
    const root = exactDataProperties(input.approvedRootProfile, [
      'encryptionMasterFingerprint',
      'fingerprintMasterFingerprint',
      'version',
    ]);
    const secrets = exactDataProperties(input.producerSecrets, [
      'encryptionMasterSecret',
      'fingerprintMasterSecret',
    ]);
    const key = exactDataProperties(input.workerKey, [
      'contractVersion',
      'providerCode',
      'purpose',
      'keyVersion',
      'keyId',
      'keyHex',
    ]);
    const profile = exactDataProperties(input.workerProfile, [
      'version',
      'providerCode',
      'purpose',
      'sourceProfile',
      'ciphertextProfileVersion',
      'encryptionKeyVersion',
      'keyId',
      'rootEncryptionMasterFingerprint',
      'rootFingerprintMasterFingerprint',
    ]);
    if (
      root === undefined ||
      secrets === undefined ||
      key === undefined ||
      profile === undefined ||
      root.version !== CBE_BIRR_REFERENCE_OPENING_ROOT_PROFILE_VERSION ||
      typeof root.encryptionMasterFingerprint !== 'string' ||
      !KEY_ID_PATTERN.test(root.encryptionMasterFingerprint) ||
      typeof root.fingerprintMasterFingerprint !== 'string' ||
      !KEY_ID_PATTERN.test(root.fingerprintMasterFingerprint) ||
      root.encryptionMasterFingerprint === root.fingerprintMasterFingerprint ||
      typeof secrets.encryptionMasterSecret !== 'string' ||
      !HEX_KEY_PATTERN.test(secrets.encryptionMasterSecret) ||
      typeof secrets.fingerprintMasterSecret !== 'string' ||
      !HEX_KEY_PATTERN.test(secrets.fingerprintMasterSecret) ||
      secrets.encryptionMasterSecret === secrets.fingerprintMasterSecret ||
      key.contractVersion !== CBE_BIRR_REFERENCE_OPENING_CONTRACT_VERSION ||
      key.providerCode !== CBE_BIRR_REFERENCE_OPENING_PROVIDER ||
      key.purpose !== CBE_BIRR_REFERENCE_OPENING_PURPOSE ||
      key.keyVersion !== CBE_BIRR_REFERENCE_OPENING_KEY_VERSION ||
      typeof key.keyId !== 'string' ||
      !KEY_ID_PATTERN.test(key.keyId) ||
      typeof key.keyHex !== 'string' ||
      !HEX_KEY_PATTERN.test(key.keyHex) ||
      profile.version !== CBE_BIRR_REFERENCE_OPENING_PROFILE_VERSION ||
      profile.providerCode !== CBE_BIRR_REFERENCE_OPENING_PROVIDER ||
      profile.purpose !== CBE_BIRR_REFERENCE_OPENING_PURPOSE ||
      profile.sourceProfile !== CBE_BIRR_REFERENCE_OPENING_SOURCE_PROFILE ||
      profile.ciphertextProfileVersion !== CBE_BIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION ||
      profile.encryptionKeyVersion !== CBE_BIRR_REFERENCE_OPENING_KEY_VERSION ||
      typeof profile.keyId !== 'string' ||
      !KEY_ID_PATTERN.test(profile.keyId) ||
      profile.keyId !== key.keyId ||
      profile.rootEncryptionMasterFingerprint !== root.encryptionMasterFingerprint ||
      profile.rootFingerprintMasterFingerprint !== root.fingerprintMasterFingerprint
    ) {
      throw new Error();
    }

    encryptionMaster = Buffer.from(secrets.encryptionMasterSecret, 'hex');
    fingerprintMaster = Buffer.from(secrets.fingerprintMasterSecret, 'hex');
    actualEncryptionRootId = createHash('sha256').update(encryptionMaster).digest();
    actualFingerprintRootId = createHash('sha256').update(fingerprintMaster).digest();
    expectedEncryptionRootId = Buffer.from(root.encryptionMasterFingerprint.slice(7), 'hex');
    expectedFingerprintRootId = Buffer.from(root.fingerprintMasterFingerprint.slice(7), 'hex');
    if (
      !timingSafeEqual(actualEncryptionRootId, expectedEncryptionRootId) ||
      !timingSafeEqual(actualFingerprintRootId, expectedFingerprintRootId)
    ) {
      throw new Error();
    }

    child = createHmac('sha256', encryptionMaster).update(CBE_ENCRYPTION_CHILD_DOMAIN).digest();
    proposedChild = Buffer.from(key.keyHex, 'hex');
    actualChildId = createHash('sha256').update(child).digest();
    expectedChildId = Buffer.from(key.keyId.slice(7), 'hex');
    if (
      !timingSafeEqual(child, proposedChild) ||
      !timingSafeEqual(actualChildId, expectedChildId)
    ) {
      throw new Error();
    }

    return Object.freeze({
      disposition: 'offline_consistency_only',
      keyId: key.keyId,
      providerCode: CBE_BIRR_REFERENCE_OPENING_PROVIDER,
      rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
      rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
      sourceProfile: CBE_BIRR_REFERENCE_OPENING_SOURCE_PROFILE,
      workerProfileVersion: CBE_BIRR_REFERENCE_OPENING_PROFILE_VERSION,
    });
  } catch {
    throw new CbeBirrWorkerKeyProvisioningCheckError();
  } finally {
    encryptionMaster?.fill(0);
    fingerprintMaster?.fill(0);
    child?.fill(0);
    proposedChild?.fill(0);
    actualEncryptionRootId?.fill(0);
    actualFingerprintRootId?.fill(0);
    expectedEncryptionRootId?.fill(0);
    expectedFingerprintRootId?.fill(0);
    actualChildId?.fill(0);
    expectedChildId?.fill(0);
  }
}
