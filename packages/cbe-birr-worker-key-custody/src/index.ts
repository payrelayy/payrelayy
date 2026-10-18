import { createHash, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { TextDecoder, types as nodeUtilTypes } from 'node:util';

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

export const CBE_BIRR_WORKER_OPENING_KEY_FILE =
  '/run/secrets/cbe_birr_worker_reference_opening_key.v1.json' as const;
export const CBE_BIRR_WORKER_OPENING_PROFILE_FILE =
  '/etc/fetanagent/cbe-birr-worker-opening-profile.v1.json' as const;
export const CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE =
  '/etc/fetanagent/deposit-proof-reference-profile.v2.json' as const;

const MAX_FILE_BYTES = 4096;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const KEY_HEX = /^[0-9a-f]{64}$/u;

export type CbeBirrWorkerDeploymentTarget = 'staging' | 'production';

/** These pins must come from a separately approved release, not from the three loaded files. */
export interface CbeBirrApprovedReleasePins {
  readonly deploymentTarget: CbeBirrWorkerDeploymentTarget;
  readonly rootProfileSha256: string;
  readonly workerProfileSha256: string;
  readonly workerKeyId: string;
}

export type CbeBirrWorkerKeyCustodyConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly deploymentTarget: CbeBirrWorkerDeploymentTarget;
      readonly key: CbeBirrScopedReferenceOpeningKey;
      readonly workerProfile: CbeBirrReferenceOpeningProfile;
      readonly approvedRootProfile: CbeBirrApprovedProofRootProfile;
    };

export interface CbeBirrGuardedFileStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface CbeBirrGuardedFileHandle {
  close(): void;
  read(maximumBytes: number): Buffer;
  stat(): CbeBirrGuardedFileStat;
}

export interface CbeBirrGuardedFileSystem {
  /** The Linux O_NOFOLLOW value; injected file systems supply it for synthetic tests. */
  readonly noFollowFlag: number | undefined;
  lstat(path: string): CbeBirrGuardedFileStat;
  open(path: string, flags: number): CbeBirrGuardedFileHandle;
  realpath(path: string): string;
}

export interface CbeBirrWorkerKeyCustodyDependencies {
  readonly effectiveUserId?: number;
  readonly fileSystem?: CbeBirrGuardedFileSystem;
  readonly platform?: NodeJS.Platform;
}

export class CbeBirrWorkerKeyCustodyError extends Error {
  constructor() {
    super('CBE Birr worker key custody is unavailable.');
    this.name = 'CbeBirrWorkerKeyCustodyError';
  }
}

const nodeFileSystem: CbeBirrGuardedFileSystem = {
  noFollowFlag: constants.O_NOFOLLOW,
  lstat: lstatSync,
  open(path, flags) {
    const descriptor = openSync(path, flags);
    return {
      close: () => closeSync(descriptor),
      read(maximumBytes) {
        const bytes = Buffer.alloc(maximumBytes + 1);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const readBytes = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
          if (readBytes === 0) break;
          offset += readBytes;
        }
        return bytes.subarray(0, offset);
      },
      stat: () => fstatSync(descriptor),
    };
  },
  realpath: realpathSync,
};

function unavailable(): never {
  throw new CbeBirrWorkerKeyCustodyError();
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

function sameFile(left: CbeBirrGuardedFileStat, right: CbeBirrGuardedFileStat): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid
  );
}

function assertFile(
  stat: CbeBirrGuardedFileStat,
  effectiveUserId: number,
  confidentiality: 'secret' | 'profile',
): void {
  const permissions = stat.mode & 0o777;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    !Number.isSafeInteger(stat.size) ||
    stat.size < 1 ||
    stat.size > MAX_FILE_BYTES ||
    !Number.isSafeInteger(stat.mode) ||
    !Number.isFinite(stat.mtimeMs) ||
    !Number.isSafeInteger(stat.uid) ||
    (stat.uid !== 0 && stat.uid !== effectiveUserId) ||
    (confidentiality === 'secret'
      ? permissions !== 0o400
      : permissions !== 0o400 && permissions !== 0o440 && permissions !== 0o444)
  ) {
    unavailable();
  }
}

function readGuardedBytes(
  path: string,
  confidentiality: 'secret' | 'profile',
  dependencies: CbeBirrWorkerKeyCustodyDependencies,
): Buffer {
  const fileSystem = dependencies.fileSystem ?? nodeFileSystem;
  const platform = dependencies.platform ?? process.platform;
  const effectiveUserId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (
    platform !== 'linux' ||
    !Number.isSafeInteger(effectiveUserId) ||
    effectiveUserId < 1 ||
    !isAbsolute(path)
  ) {
    return unavailable();
  }

  let handle: CbeBirrGuardedFileHandle | undefined;
  let bytes: Buffer | undefined;
  let result: Buffer | undefined;
  try {
    const before = fileSystem.lstat(path);
    assertFile(before, effectiveUserId, confidentiality);
    if (resolve(fileSystem.realpath(path)) !== resolve(path)) unavailable();
    const noFollowFlag = fileSystem.noFollowFlag;
    if (
      typeof noFollowFlag !== 'number' ||
      !Number.isSafeInteger(noFollowFlag) ||
      noFollowFlag <= 0
    ) {
      unavailable();
    }

    handle = fileSystem.open(path, constants.O_RDONLY | noFollowFlag);
    const opened = handle.stat();
    assertFile(opened, effectiveUserId, confidentiality);
    if (!sameFile(before, opened)) unavailable();

    bytes = handle.read(MAX_FILE_BYTES);
    const after = handle.stat();
    assertFile(after, effectiveUserId, confidentiality);
    if (!sameFile(opened, after) || bytes.byteLength !== opened.size) unavailable();
    result = Buffer.from(bytes);
    bytes.fill(0);
    bytes = undefined;
    return result;
  } catch {
    bytes?.fill(0);
    result?.fill(0);
    return unavailable();
  } finally {
    if (handle !== undefined) {
      try {
        handle.close();
      } catch {
        result?.fill(0);
        unavailable();
      }
    }
  }
}

function parsedPinnedJson(
  path: string,
  confidentiality: 'secret' | 'profile',
  expectedDigest: string | undefined,
  dependencies: CbeBirrWorkerKeyCustodyDependencies,
): unknown {
  const bytes = readGuardedBytes(path, confidentiality, dependencies);
  try {
    if (
      expectedDigest !== undefined &&
      `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== expectedDigest
    ) {
      return unavailable();
    }
    if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) unavailable();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.includes('\0')) unavailable();
    return JSON.parse(text) as unknown;
  } catch {
    return unavailable();
  } finally {
    bytes.fill(0);
  }
}

function exactPins(candidate: CbeBirrApprovedReleasePins | undefined): CbeBirrApprovedReleasePins {
  const pins = exactDataProperties(candidate, [
    'deploymentTarget',
    'rootProfileSha256',
    'workerProfileSha256',
    'workerKeyId',
  ]);
  if (
    pins === undefined ||
    (pins.deploymentTarget !== 'staging' && pins.deploymentTarget !== 'production') ||
    typeof pins.rootProfileSha256 !== 'string' ||
    !SHA256_ID.test(pins.rootProfileSha256) ||
    typeof pins.workerProfileSha256 !== 'string' ||
    !SHA256_ID.test(pins.workerProfileSha256) ||
    typeof pins.workerKeyId !== 'string' ||
    !SHA256_ID.test(pins.workerKeyId)
  ) {
    return unavailable();
  }
  return Object.freeze({
    deploymentTarget: pins.deploymentTarget,
    rootProfileSha256: pins.rootProfileSha256,
    workerProfileSha256: pins.workerProfileSha256,
    workerKeyId: pins.workerKeyId,
  });
}

function exactRoot(candidate: unknown): CbeBirrApprovedProofRootProfile {
  const root = exactDataProperties(candidate, [
    'encryptionMasterFingerprint',
    'fingerprintMasterFingerprint',
    'version',
  ]);
  if (
    root === undefined ||
    root.version !== CBE_BIRR_REFERENCE_OPENING_ROOT_PROFILE_VERSION ||
    typeof root.encryptionMasterFingerprint !== 'string' ||
    !SHA256_ID.test(root.encryptionMasterFingerprint) ||
    typeof root.fingerprintMasterFingerprint !== 'string' ||
    !SHA256_ID.test(root.fingerprintMasterFingerprint) ||
    root.encryptionMasterFingerprint === root.fingerprintMasterFingerprint
  ) {
    return unavailable();
  }
  return Object.freeze({
    encryptionMasterFingerprint: root.encryptionMasterFingerprint,
    fingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
    version: CBE_BIRR_REFERENCE_OPENING_ROOT_PROFILE_VERSION,
  });
}

function exactKey(candidate: unknown): CbeBirrScopedReferenceOpeningKey {
  const key = exactDataProperties(candidate, [
    'contractVersion',
    'providerCode',
    'purpose',
    'keyVersion',
    'keyId',
    'keyHex',
  ]);
  if (
    key === undefined ||
    key.contractVersion !== CBE_BIRR_REFERENCE_OPENING_CONTRACT_VERSION ||
    key.providerCode !== CBE_BIRR_REFERENCE_OPENING_PROVIDER ||
    key.purpose !== CBE_BIRR_REFERENCE_OPENING_PURPOSE ||
    key.keyVersion !== CBE_BIRR_REFERENCE_OPENING_KEY_VERSION ||
    typeof key.keyId !== 'string' ||
    !SHA256_ID.test(key.keyId) ||
    typeof key.keyHex !== 'string' ||
    !KEY_HEX.test(key.keyHex)
  ) {
    return unavailable();
  }
  const bytes = Buffer.from(key.keyHex, 'hex');
  const actualId = createHash('sha256').update(bytes).digest();
  const expectedId = Buffer.from(key.keyId.slice(7), 'hex');
  try {
    if (!timingSafeEqual(actualId, expectedId)) unavailable();
  } finally {
    bytes.fill(0);
    actualId.fill(0);
    expectedId.fill(0);
  }
  return Object.freeze({
    contractVersion: CBE_BIRR_REFERENCE_OPENING_CONTRACT_VERSION,
    providerCode: CBE_BIRR_REFERENCE_OPENING_PROVIDER,
    purpose: CBE_BIRR_REFERENCE_OPENING_PURPOSE,
    keyVersion: CBE_BIRR_REFERENCE_OPENING_KEY_VERSION,
    keyId: key.keyId,
    keyHex: key.keyHex,
  });
}

function exactWorkerProfile(
  candidate: unknown,
  root: CbeBirrApprovedProofRootProfile,
  key: CbeBirrScopedReferenceOpeningKey,
): CbeBirrReferenceOpeningProfile {
  const profile = exactDataProperties(candidate, [
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
    profile === undefined ||
    profile.version !== CBE_BIRR_REFERENCE_OPENING_PROFILE_VERSION ||
    profile.providerCode !== CBE_BIRR_REFERENCE_OPENING_PROVIDER ||
    profile.purpose !== CBE_BIRR_REFERENCE_OPENING_PURPOSE ||
    profile.sourceProfile !== CBE_BIRR_REFERENCE_OPENING_SOURCE_PROFILE ||
    profile.ciphertextProfileVersion !== CBE_BIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION ||
    profile.encryptionKeyVersion !== CBE_BIRR_REFERENCE_OPENING_KEY_VERSION ||
    profile.keyId !== key.keyId ||
    profile.rootEncryptionMasterFingerprint !== root.encryptionMasterFingerprint ||
    profile.rootFingerprintMasterFingerprint !== root.fingerprintMasterFingerprint
  ) {
    return unavailable();
  }
  return Object.freeze({
    version: CBE_BIRR_REFERENCE_OPENING_PROFILE_VERSION,
    providerCode: CBE_BIRR_REFERENCE_OPENING_PROVIDER,
    purpose: CBE_BIRR_REFERENCE_OPENING_PURPOSE,
    sourceProfile: CBE_BIRR_REFERENCE_OPENING_SOURCE_PROFILE,
    ciphertextProfileVersion: CBE_BIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION,
    encryptionKeyVersion: CBE_BIRR_REFERENCE_OPENING_KEY_VERSION,
    keyId: key.keyId,
    rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
    rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
  });
}

/** No application imports this candidate; enabled reads require independently approved pins. */
export function loadCbeBirrWorkerKeyCustody(
  environment: NodeJS.ProcessEnv = process.env,
  approvedPins?: CbeBirrApprovedReleasePins,
  dependencies: CbeBirrWorkerKeyCustodyDependencies = {},
): CbeBirrWorkerKeyCustodyConfig {
  try {
    const enabled = environment.INTERNAL_CBE_BIRR_WORKER_KEY_CUSTODY_CANDIDATE_ENABLED;
    if (enabled === undefined || enabled === 'false') return Object.freeze({ enabled: false });
    if (
      enabled !== 'true' ||
      environment.NODE_ENV !== 'production' ||
      environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
      environment.CBE_BIRR_WORKER_OPENING_KEY_FILE !== CBE_BIRR_WORKER_OPENING_KEY_FILE ||
      environment.CBE_BIRR_WORKER_OPENING_PROFILE_FILE !== CBE_BIRR_WORKER_OPENING_PROFILE_FILE ||
      environment.CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE !==
        CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE
    ) {
      return unavailable();
    }
    const pins = exactPins(approvedPins);
    if (environment.CBE_BIRR_WORKER_DEPLOYMENT_TARGET !== pins.deploymentTarget) unavailable();
    const forbidden = [
      'CBE_BIRR_WORKER_OPENING_KEY',
      'CBE_BIRR_WORKER_OPENING_PROFILE',
      'DEPOSIT_PROOF_REFERENCE_PROFILE',
      'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
      'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
      'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
      'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE',
      'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET',
      'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE',
      'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET',
      'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE',
    ] as const;
    if (forbidden.some((name) => environment[name] !== undefined)) unavailable();

    const root = exactRoot(
      parsedPinnedJson(
        CBE_BIRR_WORKER_PRODUCER_ROOT_PROFILE_FILE,
        'profile',
        pins.rootProfileSha256,
        dependencies,
      ),
    );
    const key = exactKey(
      parsedPinnedJson(CBE_BIRR_WORKER_OPENING_KEY_FILE, 'secret', undefined, dependencies),
    );
    if (key.keyId !== pins.workerKeyId) unavailable();
    const workerProfile = exactWorkerProfile(
      parsedPinnedJson(
        CBE_BIRR_WORKER_OPENING_PROFILE_FILE,
        'profile',
        pins.workerProfileSha256,
        dependencies,
      ),
      root,
      key,
    );
    return Object.freeze({
      enabled: true,
      deploymentTarget: pins.deploymentTarget,
      key,
      workerProfile,
      approvedRootProfile: root,
    });
  } catch {
    return unavailable();
  }
}

export function redactedCbeBirrWorkerKeyCustodyForLog(config: CbeBirrWorkerKeyCustodyConfig) {
  if (!config.enabled) return Object.freeze({ enabled: false as const });
  return Object.freeze({
    enabled: true as const,
    deploymentTarget: config.deploymentTarget,
    keyId: config.key.keyId,
    rootProfileVersion: config.approvedRootProfile.version,
    workerProfileVersion: config.workerProfile.version,
  });
}
