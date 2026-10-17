import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export const OWNER_CBE_BIRR_LOOKUP_PROFILE_VERSION = 2 as const;
export const OWNER_CBE_BIRR_LOOKUP_PRODUCTION_PROFILE_FILE =
  '/etc/fetanagent/owner-cbe-birr-receiver-lookup-profile.v2.json' as const;

const HEX_SECRET = /^[0-9a-f]{64}$/u;
const MASTER_FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;

export interface OwnerCbeBirrLookupProfile {
  readonly encryptionMasterFingerprint: string;
  readonly fingerprintMasterFingerprint: string;
  readonly purpose: 'cbe_birr_receiver_lookup';
  readonly version: typeof OWNER_CBE_BIRR_LOOKUP_PROFILE_VERSION;
}

export interface OwnerCbeBirrLookupProfileDependencies {
  readonly readFile?: (path: string) => string;
}

function masterFingerprint(secret: string): Buffer {
  const master = Buffer.from(secret, 'hex');
  try {
    return createHash('sha256').update(master).digest();
  } finally {
    master.fill(0);
  }
}

/**
 * Verifies an Owner-only lookup-key profile. The profile binds two distinct keys to one
 * versioned purpose; it does not prove independent generation, storage, or worker custody.
 */
export function loadAndVerifyOwnerCbeBirrLookupProfile(
  environment: NodeJS.ProcessEnv,
  nodeEnv: string | undefined,
  secrets: Readonly<{ encryptionSecret: string; fingerprintSecret: string }>,
  dependencies: OwnerCbeBirrLookupProfileDependencies = {},
): OwnerCbeBirrLookupProfile {
  if (
    !HEX_SECRET.test(secrets.encryptionSecret) ||
    !HEX_SECRET.test(secrets.fingerprintSecret) ||
    secrets.encryptionSecret === secrets.fingerprintSecret
  ) {
    throw new Error('Owner CBE Birr lookup masters are missing or malformed.');
  }

  const inlineProfile = environment.OWNER_CBE_BIRR_LOOKUP_PROFILE;
  const profileFile = environment.OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE;
  if (nodeEnv === 'production') {
    if (inlineProfile !== undefined) {
      throw new Error('OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE is required in production.');
    }
    if (profileFile !== OWNER_CBE_BIRR_LOOKUP_PRODUCTION_PROFILE_FILE) {
      throw new Error('OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE must use the approved private path.');
    }
  }
  if (inlineProfile !== undefined && profileFile !== undefined) {
    throw new Error('Owner CBE Birr lookup profile settings are mutually exclusive.');
  }

  let encoded = inlineProfile;
  if (encoded === undefined && profileFile !== undefined) {
    if (!posix.isAbsolute(profileFile) && !win32.isAbsolute(profileFile)) {
      throw new Error('OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE must be an absolute path.');
    }
    try {
      encoded = (dependencies.readFile ?? ((path) => readFileSync(path, 'utf8')))(profileFile);
    } catch {
      throw new Error('OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE could not be read.');
    }
  }
  if (encoded === undefined) {
    throw new Error('Owner CBE Birr lookup profile is required when key loading is enabled.');
  }

  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('Owner CBE Birr lookup profile must be valid JSON.');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'encryptionMasterFingerprint,fingerprintMasterFingerprint,purpose,version'
  ) {
    throw new Error('Owner CBE Birr lookup profile has an invalid shape.');
  }
  const profile = value as Record<string, unknown>;
  if (
    profile.version !== OWNER_CBE_BIRR_LOOKUP_PROFILE_VERSION ||
    profile.purpose !== 'cbe_birr_receiver_lookup' ||
    typeof profile.encryptionMasterFingerprint !== 'string' ||
    typeof profile.fingerprintMasterFingerprint !== 'string' ||
    !MASTER_FINGERPRINT.test(profile.encryptionMasterFingerprint) ||
    !MASTER_FINGERPRINT.test(profile.fingerprintMasterFingerprint) ||
    profile.encryptionMasterFingerprint === profile.fingerprintMasterFingerprint
  ) {
    throw new Error('Owner CBE Birr lookup profile is invalid.');
  }

  const actualEncryption = masterFingerprint(secrets.encryptionSecret);
  const actualFingerprint = masterFingerprint(secrets.fingerprintSecret);
  const expectedEncryption = Buffer.from(profile.encryptionMasterFingerprint.slice(7), 'hex');
  const expectedFingerprint = Buffer.from(profile.fingerprintMasterFingerprint.slice(7), 'hex');
  try {
    if (
      !timingSafeEqual(actualEncryption, expectedEncryption) ||
      !timingSafeEqual(actualFingerprint, expectedFingerprint)
    ) {
      throw new Error('Owner CBE Birr lookup masters do not match the approved profile.');
    }
  } finally {
    actualEncryption.fill(0);
    actualFingerprint.fill(0);
    expectedEncryption.fill(0);
    expectedFingerprint.fill(0);
  }

  return Object.freeze({
    encryptionMasterFingerprint: profile.encryptionMasterFingerprint,
    fingerprintMasterFingerprint: profile.fingerprintMasterFingerprint,
    purpose: 'cbe_birr_receiver_lookup',
    version: OWNER_CBE_BIRR_LOOKUP_PROFILE_VERSION,
  });
}
