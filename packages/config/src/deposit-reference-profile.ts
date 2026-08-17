import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export const CBE_DEPOSIT_REFERENCE_KEY_VERSION = 1 as const;
export const CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE =
  '/etc/fetanagent/cbe-deposit-reference-key-profile.v1.json' as const;
export const CBE_DEPOSIT_REFERENCE_PRODUCTION_ENCRYPTION_SECRET_FILE =
  '/run/secrets/cbe_deposit_reference_encryption_key' as const;
export const CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE =
  '/run/secrets/cbe_deposit_reference_fingerprint_key' as const;

const HEX_SECRET = /^[0-9a-f]{64}$/u;
const KEY_FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;

export interface CbeDepositReferenceSecrets {
  readonly encryptionSecret: string;
  readonly fingerprintSecret: string;
}

export interface CbeDepositReferenceKeyProfile {
  readonly encryptionKeyFingerprint: string;
  readonly fingerprintKeyFingerprint: string;
  readonly version: typeof CBE_DEPOSIT_REFERENCE_KEY_VERSION;
}

export interface CbeDepositReferenceKeyProfileDependencies {
  readonly readFile?: (path: string) => string;
}

function exactObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keyFingerprint(secret: string): Buffer {
  const key = Buffer.from(secret, 'hex');
  try {
    return createHash('sha256').update(key).digest();
  } finally {
    key.fill(0);
  }
}

export function loadAndVerifyCbeDepositReferenceKeyProfile(
  environment: NodeJS.ProcessEnv,
  nodeEnv: string | undefined,
  secrets: CbeDepositReferenceSecrets,
  dependencies: CbeDepositReferenceKeyProfileDependencies = {},
): CbeDepositReferenceKeyProfile {
  if (
    !HEX_SECRET.test(secrets.encryptionSecret) ||
    !HEX_SECRET.test(secrets.fingerprintSecret) ||
    secrets.encryptionSecret === secrets.fingerprintSecret
  ) {
    throw new Error(
      'CBE deposit-reference encryption and fingerprint keys must be valid and distinct.',
    );
  }

  const inlineProfile = environment.CBE_DEPOSIT_REFERENCE_KEY_PROFILE;
  const profileFile = environment.CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE;
  if (nodeEnv === 'production') {
    if (inlineProfile !== undefined) {
      throw new Error('CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE is required in production.');
    }
    if (profileFile !== CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE) {
      throw new Error(
        'CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE must use the approved immutable path.',
      );
    }
  }
  if (inlineProfile !== undefined && profileFile !== undefined) {
    throw new Error('CBE deposit-reference key profile settings are mutually exclusive.');
  }

  let encoded = inlineProfile;
  if (encoded === undefined && profileFile !== undefined) {
    if (!posix.isAbsolute(profileFile) && !win32.isAbsolute(profileFile)) {
      throw new Error('CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE must be an absolute path.');
    }
    try {
      encoded = (dependencies.readFile ?? ((path) => readFileSync(path, 'utf8')))(profileFile);
    } catch {
      throw new Error('CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE could not be read.');
    }
  }
  if (encoded === undefined) {
    throw new Error(
      'CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE is required when deposits are enabled.',
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('CBE deposit-reference key profile must be valid JSON.');
  }
  if (
    !exactObject(value) ||
    Object.keys(value).sort().join(',') !==
      'encryptionKeyFingerprint,fingerprintKeyFingerprint,version'
  ) {
    throw new Error('CBE deposit-reference key profile has an invalid shape.');
  }
  const version = value.version;
  const encryptionKeyFingerprint = value.encryptionKeyFingerprint;
  const fingerprintKeyFingerprint = value.fingerprintKeyFingerprint;
  if (
    version !== CBE_DEPOSIT_REFERENCE_KEY_VERSION ||
    typeof encryptionKeyFingerprint !== 'string' ||
    typeof fingerprintKeyFingerprint !== 'string' ||
    !KEY_FINGERPRINT.test(encryptionKeyFingerprint) ||
    !KEY_FINGERPRINT.test(fingerprintKeyFingerprint) ||
    encryptionKeyFingerprint === fingerprintKeyFingerprint
  ) {
    throw new Error('CBE deposit-reference key profile is invalid.');
  }

  const actualEncryption = keyFingerprint(secrets.encryptionSecret);
  const actualFingerprint = keyFingerprint(secrets.fingerprintSecret);
  const expectedEncryption = Buffer.from(encryptionKeyFingerprint.slice(7), 'hex');
  const expectedFingerprint = Buffer.from(fingerprintKeyFingerprint.slice(7), 'hex');
  try {
    if (
      !timingSafeEqual(actualEncryption, expectedEncryption) ||
      !timingSafeEqual(actualFingerprint, expectedFingerprint)
    ) {
      throw new Error('CBE deposit-reference keys do not match the approved version 1 profile.');
    }
  } finally {
    actualEncryption.fill(0);
    actualFingerprint.fill(0);
    expectedEncryption.fill(0);
    expectedFingerprint.fill(0);
  }

  return Object.freeze({
    encryptionKeyFingerprint,
    fingerprintKeyFingerprint,
    version,
  });
}
