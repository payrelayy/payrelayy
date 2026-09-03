import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signSignature,
  type KeyObject,
} from 'node:crypto';
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
import { TextDecoder } from 'node:util';
import { isProxy } from 'node:util/types';

import {
  TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  TELEBIRR_REFERENCE_OPENING_PROVIDER,
  TELEBIRR_REFERENCE_OPENING_PURPOSE,
  type TelebirrScopedReferenceOpeningKey,
} from '@fetanagent/telebirr-reference-opening';
import {
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  digestTelebirrLivePilotReceiverName,
  normalizeTelebirrCreditedPartyFullName,
} from '@fetanagent/telebirr-verification-foundation';

import type { TelebirrAssignmentBrokerConnectionConfig } from './postgres-telebirr-assignment-broker.js';
import type {
  TelebirrAssignmentReceiverManifest,
  TelebirrAssignmentSigner,
} from './telebirr-assignment-broker.js';

export const TELEBIRR_ASSIGNMENT_BROKER_DATABASE_ROLE =
  'fetanagent_telebirr_assignment_broker_runtime' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_STAGING_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_STAGING_DATABASE_HOST =
  'db.spzpiyxheappsfyswewl.supabase.co' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE =
  '/run/secrets/telebirr_assignment_broker_database_url' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE =
  '/run/secrets/telebirr_assignment_broker_reference_opening_key.v1.json' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE =
  '/run/secrets/telebirr_assignment_broker_runtime_manifest.v1.json' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE =
  '/run/secrets/telebirr_assignment_broker_signer.pkcs8.der' as const;
export const TELEBIRR_ASSIGNMENT_BROKER_SUPABASE_CA_FILE =
  '/run/configs/supabase_ca_certificate' as const;

const MAX_GUARDED_FILE_BYTES = 16_384;
const MAX_SIGNING_TRANSCRIPT_BYTES = 16_384;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type TelebirrAssignmentBrokerConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly deploymentTarget: 'staging';
      readonly projectReference: typeof TELEBIRR_ASSIGNMENT_BROKER_STAGING_PROJECT_REFERENCE;
      readonly connection: TelebirrAssignmentBrokerConnectionConfig;
      readonly openingKey: TelebirrScopedReferenceOpeningKey;
      readonly receiverManifest: TelebirrAssignmentReceiverManifest;
      readonly signer: TelebirrAssignmentSigner;
    };

export interface TelebirrAssignmentBrokerGuardedFileStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface TelebirrAssignmentBrokerGuardedFileHandle {
  close(): void;
  read(maximumBytes: number): Buffer;
  stat(): TelebirrAssignmentBrokerGuardedFileStat;
}

export interface TelebirrAssignmentBrokerGuardedFileSystem {
  lstat(path: string): TelebirrAssignmentBrokerGuardedFileStat;
  open(path: string, flags: number): TelebirrAssignmentBrokerGuardedFileHandle;
  realpath(path: string): string;
}

export interface TelebirrAssignmentBrokerConfigDependencies {
  readonly effectiveUserId?: number;
  readonly fileSystem?: TelebirrAssignmentBrokerGuardedFileSystem;
  readonly platform?: NodeJS.Platform;
}

export class TelebirrAssignmentBrokerConfigError extends Error {
  constructor() {
    super('The private TeleBirr assignment broker configuration is unavailable.');
    this.name = 'TelebirrAssignmentBrokerConfigError';
  }
}

const nodeGuardedFileSystem: TelebirrAssignmentBrokerGuardedFileSystem = {
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
  realpath: (path) => realpathSync(path),
};

function unavailable(): never {
  throw new TelebirrAssignmentBrokerConfigError();
}

function exactBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return unavailable();
}

function sameFile(
  left: TelebirrAssignmentBrokerGuardedFileStat,
  right: TelebirrAssignmentBrokerGuardedFileStat,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function assertGuardedFile(
  stat: TelebirrAssignmentBrokerGuardedFileStat,
  effectiveUserId: number,
  confidentiality: 'public_config' | 'secret',
): void {
  const permissions = stat.mode & 0o777;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !Number.isSafeInteger(stat.size) ||
    stat.size < 1 ||
    stat.size > MAX_GUARDED_FILE_BYTES ||
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
  dependencies: TelebirrAssignmentBrokerConfigDependencies,
  confidentiality: 'public_config' | 'secret',
): Buffer {
  const fileSystem = dependencies.fileSystem ?? nodeGuardedFileSystem;
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

  let handle: TelebirrAssignmentBrokerGuardedFileHandle | undefined;
  let bytes: Buffer | undefined;
  try {
    const before = fileSystem.lstat(path);
    assertGuardedFile(before, effectiveUserId, confidentiality);
    if (resolve(fileSystem.realpath(path)) !== resolve(path)) unavailable();

    handle = fileSystem.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = handle.stat();
    assertGuardedFile(opened, effectiveUserId, confidentiality);
    if (!sameFile(before, opened)) unavailable();

    bytes = handle.read(MAX_GUARDED_FILE_BYTES);
    const after = handle.stat();
    assertGuardedFile(after, effectiveUserId, confidentiality);
    if (!sameFile(opened, after) || bytes.byteLength !== opened.size) unavailable();
    const result = Buffer.from(bytes);
    bytes.fill(0);
    bytes = undefined;
    return result;
  } catch {
    bytes?.fill(0);
    return unavailable();
  } finally {
    if (handle !== undefined) {
      try {
        handle.close();
      } catch {
        // The fixed unavailable error deliberately hides every guarded-file detail.
      }
    }
  }
}

function readGuardedText(
  path: string,
  dependencies: TelebirrAssignmentBrokerConfigDependencies,
  confidentiality: 'public_config' | 'secret',
): string {
  const bytes = readGuardedBytes(path, dependencies, confidentiality);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) unavailable();
    return text;
  } catch {
    return unavailable();
  } finally {
    bytes.fill(0);
  }
}

function guardedSingleLine(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, 'utf8') > MAX_GUARDED_FILE_BYTES ||
    /[\0\r\n]/u.test(value)
  ) {
    return unavailable();
  }
  return value;
}

function guardedCanonicalJson(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_GUARDED_FILE_BYTES ||
    /[\0\r\n]/u.test(value)
  ) {
    return unavailable();
  }
  return value;
}

function parseRecord(value: string, keys: readonly string[]): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return unavailable();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype ||
    Object.keys(parsed).join(',') !== keys.join(',') ||
    JSON.stringify(parsed) !== value
  ) {
    return unavailable();
  }
  return parsed as Record<string, unknown>;
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return unavailable();
  }
}

function connectionFromUrl(value: string): Omit<TelebirrAssignmentBrokerConnectionConfig, 'ca'> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unavailable();
  }
  const entries = [...url.searchParams.entries()];
  const user = decodeUrlComponent(url.username);
  const password = decodeUrlComponent(url.password);
  const database = decodeUrlComponent(url.pathname.slice(1));
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname !== TELEBIRR_ASSIGNMENT_BROKER_STAGING_DATABASE_HOST ||
    (url.port !== '' && url.port !== '5432') ||
    user !== TELEBIRR_ASSIGNMENT_BROKER_DATABASE_ROLE ||
    password.length < 16 ||
    database !== 'postgres' ||
    url.hash !== '' ||
    entries.length !== 1 ||
    entries[0]?.[0] !== 'sslmode' ||
    entries[0]?.[1] !== 'verify-full'
  ) {
    return unavailable();
  }
  return Object.freeze({
    database: 'postgres' as const,
    host: TELEBIRR_ASSIGNMENT_BROKER_STAGING_DATABASE_HOST,
    password,
    port: 5432 as const,
    user: TELEBIRR_ASSIGNMENT_BROKER_DATABASE_ROLE,
  });
}

function guardedCa(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_GUARDED_FILE_BYTES ||
    value.includes('\0') ||
    !/^(?:-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/]{1,76}\n)+-----END CERTIFICATE-----\n?)+$/u.test(
      value,
    )
  ) {
    return unavailable();
  }
  return value;
}

function openingKeyFrom(value: string): TelebirrScopedReferenceOpeningKey {
  const record = parseRecord(value, [
    'contractVersion',
    'providerCode',
    'purpose',
    'keyVersion',
    'keyId',
    'keyHex',
  ]);
  if (
    record.contractVersion !== TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION ||
    record.providerCode !== TELEBIRR_REFERENCE_OPENING_PROVIDER ||
    record.purpose !== TELEBIRR_REFERENCE_OPENING_PURPOSE ||
    record.keyVersion !== TELEBIRR_REFERENCE_OPENING_KEY_VERSION ||
    typeof record.keyId !== 'string' ||
    !SHA256_PATTERN.test(record.keyId) ||
    typeof record.keyHex !== 'string' ||
    !KEY_HEX_PATTERN.test(record.keyHex)
  ) {
    return unavailable();
  }
  const keyBytes = Buffer.from(record.keyHex, 'hex');
  try {
    if (`sha256:${createHash('sha256').update(keyBytes).digest('hex')}` !== record.keyId) {
      return unavailable();
    }
  } finally {
    keyBytes.fill(0);
  }
  return Object.freeze({
    contractVersion: TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
    providerCode: TELEBIRR_REFERENCE_OPENING_PROVIDER,
    purpose: TELEBIRR_REFERENCE_OPENING_PURPOSE,
    keyVersion: TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
    keyId: record.keyId,
    keyHex: record.keyHex,
  });
}

interface TelebirrAssignmentBrokerRuntimeManifest {
  readonly assignmentSignerId: string;
  readonly assignmentSignerKeyId: string;
  readonly assignmentSignerPublicKeySpkiSha256: string;
  readonly referenceOpeningKeyId: string;
  readonly receiverManifest: TelebirrAssignmentReceiverManifest;
}

function receiverManifestFrom(value: unknown): TelebirrAssignmentReceiverManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return unavailable();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).join(',') !==
      [
        'contractVersion',
        'providerCode',
        'pilotRevisionId',
        'receiverRevisionId',
        'receiverProfileId',
        'receiverProfileDigest',
        'receiverConfigurationDigest',
        'receiverNameNormalizerVersion',
        'expectedReceiverNameNormalized',
        'expectedReceiverNameDigest',
      ].join(',') ||
    record.contractVersion !== 1 ||
    record.providerCode !== 'telebirr' ||
    typeof record.pilotRevisionId !== 'string' ||
    !UUID_V4_PATTERN.test(record.pilotRevisionId) ||
    typeof record.receiverRevisionId !== 'string' ||
    !UUID_V4_PATTERN.test(record.receiverRevisionId) ||
    typeof record.receiverProfileId !== 'string' ||
    !UUID_V4_PATTERN.test(record.receiverProfileId) ||
    typeof record.receiverProfileDigest !== 'string' ||
    !SHA256_PATTERN.test(record.receiverProfileDigest) ||
    typeof record.receiverConfigurationDigest !== 'string' ||
    !SHA256_PATTERN.test(record.receiverConfigurationDigest) ||
    record.receiverNameNormalizerVersion !== TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION ||
    typeof record.expectedReceiverNameNormalized !== 'string' ||
    normalizeTelebirrCreditedPartyFullName(record.expectedReceiverNameNormalized) !==
      record.expectedReceiverNameNormalized ||
    typeof record.expectedReceiverNameDigest !== 'string' ||
    digestTelebirrLivePilotReceiverName(record.expectedReceiverNameNormalized) !==
      record.expectedReceiverNameDigest
  ) {
    return unavailable();
  }
  return Object.freeze({
    contractVersion: 1,
    providerCode: 'telebirr',
    pilotRevisionId: record.pilotRevisionId,
    receiverRevisionId: record.receiverRevisionId,
    receiverProfileId: record.receiverProfileId,
    receiverProfileDigest: record.receiverProfileDigest,
    receiverConfigurationDigest: record.receiverConfigurationDigest,
    receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized: record.expectedReceiverNameNormalized,
    expectedReceiverNameDigest: record.expectedReceiverNameDigest,
  });
}

function runtimeManifestFrom(value: string): TelebirrAssignmentBrokerRuntimeManifest {
  const record = parseRecord(value, [
    'contractVersion',
    'providerCode',
    'assignmentSignerId',
    'assignmentSignerKeyId',
    'assignmentSignerPublicKeySpkiSha256',
    'referenceOpeningKeyId',
    'receiverManifest',
  ]);
  const receiverManifest = receiverManifestFrom(record.receiverManifest);
  if (
    record.contractVersion !== 1 ||
    record.providerCode !== 'telebirr' ||
    typeof record.assignmentSignerId !== 'string' ||
    !UUID_V4_PATTERN.test(record.assignmentSignerId) ||
    typeof record.assignmentSignerKeyId !== 'string' ||
    !KEY_ID_PATTERN.test(record.assignmentSignerKeyId) ||
    typeof record.assignmentSignerPublicKeySpkiSha256 !== 'string' ||
    !SHA256_PATTERN.test(record.assignmentSignerPublicKeySpkiSha256) ||
    typeof record.referenceOpeningKeyId !== 'string' ||
    !SHA256_PATTERN.test(record.referenceOpeningKeyId)
  ) {
    return unavailable();
  }
  return Object.freeze({
    assignmentSignerId: record.assignmentSignerId,
    assignmentSignerKeyId: record.assignmentSignerKeyId,
    assignmentSignerPublicKeySpkiSha256: record.assignmentSignerPublicKeySpkiSha256,
    referenceOpeningKeyId: record.referenceOpeningKeyId,
    receiverManifest,
  });
}

function signerFromPkcs8(
  privateKeyBytes: Buffer,
  manifest: TelebirrAssignmentBrokerRuntimeManifest,
): TelebirrAssignmentSigner {
  let privateKey: KeyObject;
  let canonicalPrivateKey: Buffer | undefined;
  let publicKeySpki: Buffer | undefined;
  try {
    privateKey = createPrivateKey({ key: privateKeyBytes, format: 'der', type: 'pkcs8' });
    canonicalPrivateKey = Buffer.from(privateKey.export({ format: 'der', type: 'pkcs8' }));
    if (
      privateKey.type !== 'private' ||
      privateKey.asymmetricKeyType !== 'ec' ||
      privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !canonicalPrivateKey.equals(privateKeyBytes)
    ) {
      return unavailable();
    }
    const publicKey = createPublicKey(privateKey);
    publicKeySpki = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }));
    if (
      publicKeySpki.byteLength !== 91 ||
      `sha256:${createHash('sha256').update(publicKeySpki).digest('hex')}` !==
        manifest.assignmentSignerPublicKeySpkiSha256
    ) {
      return unavailable();
    }
  } catch {
    return unavailable();
  } finally {
    canonicalPrivateKey?.fill(0);
  }

  const retainedPublicKey = Uint8Array.from(publicKeySpki);
  publicKeySpki.fill(0);
  return Object.freeze({
    assignmentSignerId: manifest.assignmentSignerId,
    keyId: manifest.assignmentSignerKeyId,
    publicKeySpkiDer: retainedPublicKey,
    async signP1363(transcript: Uint8Array): Promise<string> {
      let signature: Buffer | undefined;
      try {
        if (
          !(transcript instanceof Uint8Array) ||
          isProxy(transcript) ||
          transcript.byteLength === 0 ||
          transcript.byteLength > MAX_SIGNING_TRANSCRIPT_BYTES
        ) {
          return unavailable();
        }
        signature = signSignature('sha256', Buffer.from(transcript), {
          key: privateKey,
          dsaEncoding: 'ieee-p1363',
        });
        if (signature.byteLength !== 64) return unavailable();
        return signature.toString('base64url');
      } catch {
        return unavailable();
      } finally {
        signature?.fill(0);
      }
    },
  });
}

function requireFixedFiles(environment: NodeJS.ProcessEnv): void {
  const expected = {
    TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE,
    TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE,
    TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE,
    TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE,
  } as const;
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) unavailable();
  }
}

function rejectInlineOrRootSecrets(environment: NodeJS.ProcessEnv): void {
  const forbidden = [
    'DATABASE_URL',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL',
    'TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY',
    'TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
    'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
    'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE',
  ] as const;
  if (forbidden.some((name) => environment[name] !== undefined)) unavailable();
}

export function loadTelebirrAssignmentBrokerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: TelebirrAssignmentBrokerConfigDependencies = {},
): TelebirrAssignmentBrokerConfig {
  const enabled = exactBoolean(environment.INTERNAL_TELEBIRR_ASSIGNMENT_BROKER_ENABLED);
  if (!enabled) return Object.freeze({ enabled: false });
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    !exactBoolean(environment.TELEBIRR_ASSIGNMENT_BROKER_NO_MONEY_PILOT_ENABLED) ||
    environment.TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET !== 'staging' ||
    environment.NODE_EXTRA_CA_CERTS !== TELEBIRR_ASSIGNMENT_BROKER_SUPABASE_CA_FILE
  ) {
    return unavailable();
  }
  rejectInlineOrRootSecrets(environment);
  requireFixedFiles(environment);

  const manifest = runtimeManifestFrom(
    guardedCanonicalJson(
      readGuardedText(TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE, dependencies, 'secret'),
    ),
  );
  const openingKey = openingKeyFrom(
    guardedCanonicalJson(
      readGuardedText(
        TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE,
        dependencies,
        'secret',
      ),
    ),
  );
  if (openingKey.keyId !== manifest.referenceOpeningKeyId) unavailable();

  const privateKeyBytes = readGuardedBytes(
    TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE,
    dependencies,
    'secret',
  );
  let signer: TelebirrAssignmentSigner;
  try {
    signer = signerFromPkcs8(privateKeyBytes, manifest);
  } finally {
    privateKeyBytes.fill(0);
  }

  const connectionWithoutCa = connectionFromUrl(
    guardedSingleLine(
      readGuardedText(TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE, dependencies, 'secret'),
    ),
  );
  const ca = guardedCa(
    readGuardedText(TELEBIRR_ASSIGNMENT_BROKER_SUPABASE_CA_FILE, dependencies, 'public_config'),
  );
  return Object.freeze({
    enabled: true,
    deploymentTarget: 'staging' as const,
    projectReference: TELEBIRR_ASSIGNMENT_BROKER_STAGING_PROJECT_REFERENCE,
    connection: Object.freeze({ ...connectionWithoutCa, ca }),
    openingKey,
    receiverManifest: manifest.receiverManifest,
    signer,
  });
}

/** Fixed-key, zero-secret diagnostic projection. */
export function redactedTelebirrAssignmentBrokerConfigForLog(
  config: TelebirrAssignmentBrokerConfig,
): Readonly<{
  enabled: boolean;
  deploymentTarget: 'staging' | undefined;
  connectionConfigured: boolean;
  openingKeyConfigured: boolean;
  receiverManifestConfigured: boolean;
  signerConfigured: boolean;
}> {
  return Object.freeze({
    enabled: config.enabled,
    deploymentTarget: config.enabled ? config.deploymentTarget : undefined,
    connectionConfigured: config.enabled,
    openingKeyConfigured: config.enabled,
    receiverManifestConfigured: config.enabled,
    signerConfigured: config.enabled,
  });
}
