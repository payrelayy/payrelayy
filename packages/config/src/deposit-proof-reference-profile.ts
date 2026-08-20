import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export const DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION = 2 as const;
export const DEPOSIT_PROOF_REFERENCE_PRODUCTION_PROFILE_FILE =
  '/etc/fetanagent/deposit-proof-reference-profile.v2.json' as const;
export const DEPOSIT_PROOF_REFERENCE_PRODUCTION_ENCRYPTION_MASTER_SECRET_FILE =
  '/run/secrets/deposit_proof_reference_encryption_master' as const;
export const DEPOSIT_PROOF_REFERENCE_PRODUCTION_FINGERPRINT_MASTER_SECRET_FILE =
  '/run/secrets/deposit_proof_reference_fingerprint_master' as const;

const HEX_SECRET = /^[0-9a-f]{64}$/u;
const MASTER_FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;

export interface DepositProofReferenceMasterSecrets {
  readonly encryptionMasterSecret: string;
  readonly fingerprintMasterSecret: string;
}

export interface DepositProofReferenceProfile {
  readonly encryptionMasterFingerprint: string;
  readonly fingerprintMasterFingerprint: string;
  readonly version: typeof DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION;
}

export interface DepositProofReferenceProfileDependencies {
  readonly readFile?: (path: string) => string;
}

function exactObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function masterFingerprint(secret: string): Buffer {
  const key = Buffer.from(secret, 'hex');
  try {
    return createHash('sha256').update(key).digest();
  } finally {
    key.fill(0);
  }
}

export function loadAndVerifyDepositProofReferenceProfile(
  environment: NodeJS.ProcessEnv,
  nodeEnv: string | undefined,
  secrets: DepositProofReferenceMasterSecrets,
  dependencies: DepositProofReferenceProfileDependencies = {},
): DepositProofReferenceProfile {
  if (
    !HEX_SECRET.test(secrets.encryptionMasterSecret) ||
    !HEX_SECRET.test(secrets.fingerprintMasterSecret) ||
    secrets.encryptionMasterSecret === secrets.fingerprintMasterSecret
  ) {
    throw new Error(
      'Deposit proof-reference encryption and fingerprint masters must be valid and distinct.',
    );
  }

  const inlineProfile = environment.DEPOSIT_PROOF_REFERENCE_PROFILE;
  const profileFile = environment.DEPOSIT_PROOF_REFERENCE_PROFILE_FILE;
  if (nodeEnv === 'production') {
    if (inlineProfile !== undefined) {
      throw new Error('DEPOSIT_PROOF_REFERENCE_PROFILE_FILE is required in production.');
    }
    if (profileFile !== DEPOSIT_PROOF_REFERENCE_PRODUCTION_PROFILE_FILE) {
      throw new Error(
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE must use the approved immutable v2 path.',
      );
    }
  }
  if (inlineProfile !== undefined && profileFile !== undefined) {
    throw new Error('Deposit proof-reference profile settings are mutually exclusive.');
  }

  let encoded = inlineProfile;
  if (encoded === undefined && profileFile !== undefined) {
    if (!posix.isAbsolute(profileFile) && !win32.isAbsolute(profileFile)) {
      throw new Error('DEPOSIT_PROOF_REFERENCE_PROFILE_FILE must be an absolute path.');
    }
    try {
      encoded = (dependencies.readFile ?? ((path) => readFileSync(path, 'utf8')))(profileFile);
    } catch {
      throw new Error('DEPOSIT_PROOF_REFERENCE_PROFILE_FILE could not be read.');
    }
  }
  if (encoded === undefined) {
    throw new Error(
      'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE is required when deposit proof intake is enabled.',
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('Deposit proof-reference profile must be valid JSON.');
  }
  if (
    !exactObject(value) ||
    Object.keys(value).sort().join(',') !==
      'encryptionMasterFingerprint,fingerprintMasterFingerprint,version'
  ) {
    throw new Error('Deposit proof-reference profile has an invalid shape.');
  }
  const version = value.version;
  const encryptionMasterFingerprint = value.encryptionMasterFingerprint;
  const fingerprintMasterFingerprint = value.fingerprintMasterFingerprint;
  if (
    version !== DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION ||
    typeof encryptionMasterFingerprint !== 'string' ||
    typeof fingerprintMasterFingerprint !== 'string' ||
    !MASTER_FINGERPRINT.test(encryptionMasterFingerprint) ||
    !MASTER_FINGERPRINT.test(fingerprintMasterFingerprint) ||
    encryptionMasterFingerprint === fingerprintMasterFingerprint
  ) {
    throw new Error('Deposit proof-reference profile is invalid.');
  }

  const actualEncryption = masterFingerprint(secrets.encryptionMasterSecret);
  const actualFingerprint = masterFingerprint(secrets.fingerprintMasterSecret);
  const expectedEncryption = Buffer.from(encryptionMasterFingerprint.slice(7), 'hex');
  const expectedFingerprint = Buffer.from(fingerprintMasterFingerprint.slice(7), 'hex');
  try {
    if (
      !timingSafeEqual(actualEncryption, expectedEncryption) ||
      !timingSafeEqual(actualFingerprint, expectedFingerprint)
    ) {
      throw new Error(
        'Deposit proof-reference masters do not match the approved version 2 profile.',
      );
    }
  } finally {
    actualEncryption.fill(0);
    actualFingerprint.fill(0);
    expectedEncryption.fill(0);
    expectedFingerprint.fill(0);
  }

  return Object.freeze({
    encryptionMasterFingerprint,
    fingerprintMasterFingerprint,
    version,
  });
}
