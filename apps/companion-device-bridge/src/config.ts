import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
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

import type { CompanionBridgeSigner } from './pairing-handler.js';
import { createP256CompanionBridgeSigner } from './pairing-handler.js';

export const COMPANION_DEVICE_BRIDGE_DATABASE_ROLE =
  'fetanagent_companion_device_bridge_runtime' as const;
export const COMPANION_DEVICE_BRIDGE_GROUP_ROLE = 'fetanagent_companion_device_bridge' as const;
export const COMPANION_DEVICE_BRIDGE_EXECUTION_GROUP_ROLE =
  'fetanagent_companion_execution_bridge' as const;
export const COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_ROLE =
  'fetanagent_companion_execution_bridge_runtime' as const;
export const COMPANION_DEVICE_BRIDGE_STAGING_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl' as const;
export const COMPANION_DEVICE_BRIDGE_STAGING_DATABASE_HOST =
  'db.spzpiyxheappsfyswewl.supabase.co' as const;
export const COMPANION_DEVICE_BRIDGE_STAGING_SESSION_POOLER_HOST =
  'aws-1-eu-west-1.pooler.supabase.com' as const;
export const COMPANION_DEVICE_BRIDGE_STAGING_SESSION_POOLER_USER =
  `${COMPANION_DEVICE_BRIDGE_DATABASE_ROLE}.${COMPANION_DEVICE_BRIDGE_STAGING_PROJECT_REFERENCE}` as const;
export const COMPANION_DEVICE_BRIDGE_PRODUCTION_PROJECT_REFERENCE = 'xzztugbgtulptnbpoelr' as const;
export const COMPANION_DEVICE_BRIDGE_PRODUCTION_DATABASE_HOST =
  'db.xzztugbgtulptnbpoelr.supabase.co' as const;
export const COMPANION_DEVICE_BRIDGE_PRODUCTION_SESSION_POOLER_HOST =
  'aws-0-eu-west-1.pooler.supabase.com' as const;
export const COMPANION_DEVICE_BRIDGE_PRODUCTION_SESSION_POOLER_USER =
  `${COMPANION_DEVICE_BRIDGE_DATABASE_ROLE}.${COMPANION_DEVICE_BRIDGE_PRODUCTION_PROJECT_REFERENCE}` as const;
export const COMPANION_DEVICE_BRIDGE_EXECUTION_STAGING_SESSION_POOLER_USER =
  `${COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_ROLE}.${COMPANION_DEVICE_BRIDGE_STAGING_PROJECT_REFERENCE}` as const;
export const COMPANION_DEVICE_BRIDGE_EXECUTION_PRODUCTION_SESSION_POOLER_USER =
  `${COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_ROLE}.${COMPANION_DEVICE_BRIDGE_PRODUCTION_PROJECT_REFERENCE}` as const;
type DeploymentTarget = 'staging' | 'production';
const databaseTargets = {
  staging: {
    projectReference: COMPANION_DEVICE_BRIDGE_STAGING_PROJECT_REFERENCE,
    directHost: COMPANION_DEVICE_BRIDGE_STAGING_DATABASE_HOST,
    poolerHost: COMPANION_DEVICE_BRIDGE_STAGING_SESSION_POOLER_HOST,
    poolerUser: COMPANION_DEVICE_BRIDGE_STAGING_SESSION_POOLER_USER,
    executionPoolerUser: COMPANION_DEVICE_BRIDGE_EXECUTION_STAGING_SESSION_POOLER_USER,
  },
  production: {
    projectReference: COMPANION_DEVICE_BRIDGE_PRODUCTION_PROJECT_REFERENCE,
    directHost: COMPANION_DEVICE_BRIDGE_PRODUCTION_DATABASE_HOST,
    poolerHost: COMPANION_DEVICE_BRIDGE_PRODUCTION_SESSION_POOLER_HOST,
    poolerUser: COMPANION_DEVICE_BRIDGE_PRODUCTION_SESSION_POOLER_USER,
    executionPoolerUser: COMPANION_DEVICE_BRIDGE_EXECUTION_PRODUCTION_SESSION_POOLER_USER,
  },
} as const;
export const COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE =
  '/run/secrets/companion_device_bridge_database_url' as const;
export const COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_URL_FILE =
  '/run/secrets/companion_execution_database_url' as const;
export const COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE =
  '/run/secrets/companion_device_bridge_server_signer.pkcs8.der' as const;
export const COMPANION_DEVICE_BRIDGE_EXECUTION_SIGNER_PRIVATE_KEY_FILE =
  '/run/secrets/companion_execution_signer.pkcs8.der' as const;
export const COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE =
  '/run/configs/companion_device_bridge_runtime_manifest.v2.json' as const;
export const COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE =
  '/run/configs/supabase_ca_certificate' as const;

const MAX_GUARDED_FILE_BYTES = 16_384;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface CompanionDeviceBridgeConnectionConfig {
  readonly ca: string;
  readonly database: 'postgres';
  readonly host:
    | typeof COMPANION_DEVICE_BRIDGE_STAGING_DATABASE_HOST
    | typeof COMPANION_DEVICE_BRIDGE_STAGING_SESSION_POOLER_HOST
    | typeof COMPANION_DEVICE_BRIDGE_PRODUCTION_DATABASE_HOST
    | typeof COMPANION_DEVICE_BRIDGE_PRODUCTION_SESSION_POOLER_HOST;
  readonly password: string;
  readonly port: 5432;
  readonly user:
    | typeof COMPANION_DEVICE_BRIDGE_DATABASE_ROLE
    | typeof COMPANION_DEVICE_BRIDGE_STAGING_SESSION_POOLER_USER
    | typeof COMPANION_DEVICE_BRIDGE_PRODUCTION_SESSION_POOLER_USER;
}

export interface CompanionExecutionBridgeConnectionConfig {
  readonly ca: string;
  readonly database: 'postgres';
  readonly host:
    | typeof COMPANION_DEVICE_BRIDGE_STAGING_DATABASE_HOST
    | typeof COMPANION_DEVICE_BRIDGE_STAGING_SESSION_POOLER_HOST
    | typeof COMPANION_DEVICE_BRIDGE_PRODUCTION_DATABASE_HOST
    | typeof COMPANION_DEVICE_BRIDGE_PRODUCTION_SESSION_POOLER_HOST;
  readonly password: string;
  readonly port: 5432;
  readonly user:
    | typeof COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_ROLE
    | typeof COMPANION_DEVICE_BRIDGE_EXECUTION_STAGING_SESSION_POOLER_USER
    | typeof COMPANION_DEVICE_BRIDGE_EXECUTION_PRODUCTION_SESSION_POOLER_USER;
}

export type CompanionDeviceBridgeConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly deploymentTarget: DeploymentTarget;
      readonly projectReference:
        | typeof COMPANION_DEVICE_BRIDGE_STAGING_PROJECT_REFERENCE
        | typeof COMPANION_DEVICE_BRIDGE_PRODUCTION_PROJECT_REFERENCE;
      readonly connection: CompanionDeviceBridgeConnectionConfig;
      readonly serverSignerId: string;
      readonly signer: CompanionBridgeSigner;
      readonly execution:
        | { readonly enabled: false }
        | {
            readonly enabled: true;
            readonly connection: CompanionExecutionBridgeConnectionConfig;
            readonly signer: CompanionBridgeSigner;
          };
    };

export interface CompanionDeviceBridgeGuardedFileStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface CompanionDeviceBridgeGuardedFileHandle {
  close(): void;
  read(maximumBytes: number): Buffer;
  stat(): CompanionDeviceBridgeGuardedFileStat;
}

export interface CompanionDeviceBridgeGuardedFileSystem {
  lstat(path: string): CompanionDeviceBridgeGuardedFileStat;
  open(path: string, flags: number): CompanionDeviceBridgeGuardedFileHandle;
  realpath(path: string): string;
}

export interface CompanionDeviceBridgeConfigDependencies {
  readonly effectiveUserId?: number;
  readonly fileSystem?: CompanionDeviceBridgeGuardedFileSystem;
  readonly platform?: NodeJS.Platform;
}

export class CompanionDeviceBridgeConfigError extends Error {
  constructor() {
    super('The companion device bridge configuration is unavailable.');
    this.name = 'CompanionDeviceBridgeConfigError';
  }
}

const nodeGuardedFileSystem: CompanionDeviceBridgeGuardedFileSystem = {
  lstat: lstatSync,
  open(path, flags) {
    const descriptor = openSync(path, flags);
    return {
      close: () => closeSync(descriptor),
      read(maximumBytes) {
        const bytes = Buffer.alloc(maximumBytes + 1);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
          if (count === 0) break;
          offset += count;
        }
        return bytes.subarray(0, offset);
      },
      stat: () => fstatSync(descriptor),
    };
  },
  realpath: (path) => realpathSync(path),
};

function unavailable(): never {
  throw new CompanionDeviceBridgeConfigError();
}

function exactBoolean(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return unavailable();
}

function sameFile(
  left: CompanionDeviceBridgeGuardedFileStat,
  right: CompanionDeviceBridgeGuardedFileStat,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function assertGuardedFile(
  stat: CompanionDeviceBridgeGuardedFileStat,
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
  dependencies: CompanionDeviceBridgeConfigDependencies,
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

  let handle: CompanionDeviceBridgeGuardedFileHandle | undefined;
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
    try {
      handle?.close();
    } catch {
      // Every guarded-file failure is deliberately projected as one fixed error.
    }
  }
}

function readGuardedText(
  path: string,
  dependencies: CompanionDeviceBridgeConfigDependencies,
  confidentiality: 'public_config' | 'secret',
): string {
  const bytes = readGuardedBytes(path, dependencies, confidentiality);
  try {
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (value.charCodeAt(0) === 0xfeff) unavailable();
    return value;
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

function plainCanonicalRecord(value: string, keys: readonly string[]): Record<string, unknown> {
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

function canonicalP256PublicKey(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('=') ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    return unavailable();
  }
  let bytes: Buffer | undefined;
  let canonical: Buffer | undefined;
  try {
    bytes = Buffer.from(value, 'base64url');
    if (bytes.byteLength !== 91 || bytes.toString('base64url') !== value) return unavailable();
    const publicKey = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    canonical = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }));
    if (
      publicKey.asymmetricKeyType !== 'ec' ||
      publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !canonical.equals(bytes)
    ) {
      return unavailable();
    }
    return Buffer.from(canonical);
  } catch {
    return unavailable();
  } finally {
    bytes?.fill(0);
    canonical?.fill(0);
  }
}

interface CompanionDeviceBridgeRuntimeManifestV2 {
  readonly contractVersion: 2;
  readonly serverSignerId: string;
  readonly serverSignerKeyId: string;
  readonly serverSignerPublicKeySpkiSha256: string;
}

interface CompanionDeviceBridgeRuntimeManifestV3 {
  readonly contractVersion: 3;
  readonly serverSignerId: string;
  readonly serverSignerKeyId: string;
  readonly serverSignerPublicKeySpkiSha256: string;
  readonly executionSignerKeyId: string;
  readonly executionSignerPublicKeySpki: string;
  readonly executionSignerPublicKeySpkiSha256: string;
}

type CompanionDeviceBridgeRuntimeManifest =
  CompanionDeviceBridgeRuntimeManifestV2 | CompanionDeviceBridgeRuntimeManifestV3;

function runtimeManifestFrom(
  value: string,
  deploymentTarget: DeploymentTarget,
  executionEnabled: boolean,
): CompanionDeviceBridgeRuntimeManifest {
  const v2Keys = [
    'contractVersion',
    'deploymentTarget',
    'pairingAllowed',
    'exactFiveReadOnlyLookupAllowed',
    'financialActionAllowed',
    'moneyMovementAllowed',
    'serverSignerId',
    'serverSignerKeyId',
    'serverSignerPublicKeySpkiSha256',
  ] as const;
  const v3Keys = [
    'contractVersion',
    'deploymentTarget',
    'pairingAllowed',
    'exactFiveReadOnlyLookupAllowed',
    'executionTransportAllowed',
    'serverProviderActionAllowed',
    'serverMoneyMovementAllowed',
    'serverSignerId',
    'serverSignerKeyId',
    'serverSignerPublicKeySpkiSha256',
    'executionSignerKeyId',
    'executionSignerPublicKeySpki',
    'executionSignerPublicKeySpkiSha256',
  ] as const;
  const record = plainCanonicalRecord(value, executionEnabled ? v3Keys : v2Keys);
  if (
    record.contractVersion !== (executionEnabled ? 3 : 2) ||
    record.deploymentTarget !== deploymentTarget ||
    record.pairingAllowed !== true ||
    record.exactFiveReadOnlyLookupAllowed !== true ||
    typeof record.serverSignerId !== 'string' ||
    !UUID_V4_PATTERN.test(record.serverSignerId) ||
    typeof record.serverSignerKeyId !== 'string' ||
    !KEY_ID_PATTERN.test(record.serverSignerKeyId) ||
    (deploymentTarget === 'production' &&
      record.serverSignerKeyId !== 'companion-server-production-v1') ||
    typeof record.serverSignerPublicKeySpkiSha256 !== 'string' ||
    !SHA256_PATTERN.test(record.serverSignerPublicKeySpkiSha256)
  ) {
    return unavailable();
  }
  if (!executionEnabled) {
    if (record.financialActionAllowed !== false || record.moneyMovementAllowed !== false) {
      return unavailable();
    }
    return Object.freeze({
      contractVersion: 2,
      serverSignerId: record.serverSignerId,
      serverSignerKeyId: record.serverSignerKeyId,
      serverSignerPublicKeySpkiSha256: record.serverSignerPublicKeySpkiSha256,
    });
  }
  const executionSignerPublicKeySpki = canonicalP256PublicKey(record.executionSignerPublicKeySpki);
  if (
    record.executionTransportAllowed !== true ||
    record.serverProviderActionAllowed !== false ||
    record.serverMoneyMovementAllowed !== false ||
    typeof record.executionSignerKeyId !== 'string' ||
    !KEY_ID_PATTERN.test(record.executionSignerKeyId) ||
    record.executionSignerKeyId === record.serverSignerKeyId ||
    (deploymentTarget === 'production' &&
      record.executionSignerKeyId !== 'companion-execution-production-v1') ||
    typeof record.executionSignerPublicKeySpkiSha256 !== 'string' ||
    !SHA256_PATTERN.test(record.executionSignerPublicKeySpkiSha256) ||
    `sha256:${createHash('sha256').update(executionSignerPublicKeySpki).digest('hex')}` !==
      record.executionSignerPublicKeySpkiSha256
  ) {
    executionSignerPublicKeySpki.fill(0);
    return unavailable();
  }
  const encodedExecutionPublicKey = executionSignerPublicKeySpki.toString('base64url');
  executionSignerPublicKeySpki.fill(0);
  return Object.freeze({
    contractVersion: 3,
    serverSignerId: record.serverSignerId,
    serverSignerKeyId: record.serverSignerKeyId,
    serverSignerPublicKeySpkiSha256: record.serverSignerPublicKeySpkiSha256,
    executionSignerKeyId: record.executionSignerKeyId,
    executionSignerPublicKeySpki: encodedExecutionPublicKey,
    executionSignerPublicKeySpkiSha256: record.executionSignerPublicKeySpkiSha256,
  });
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return unavailable();
  }
}

function connectionFromUrl(
  value: string,
  deploymentTarget: DeploymentTarget,
): Omit<CompanionDeviceBridgeConnectionConfig, 'ca'> {
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
  const target = databaseTargets[deploymentTarget];
  const directRoute =
    url.hostname === target.directHost && user === COMPANION_DEVICE_BRIDGE_DATABASE_ROLE;
  const sessionPoolerRoute = url.hostname === target.poolerHost && user === target.poolerUser;
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    (!directRoute && !sessionPoolerRoute) ||
    (url.port !== '' && url.port !== '5432') ||
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
    host: directRoute ? target.directHost : target.poolerHost,
    password,
    port: 5432 as const,
    user: directRoute ? COMPANION_DEVICE_BRIDGE_DATABASE_ROLE : target.poolerUser,
  });
}

function executionConnectionFromUrl(
  value: string,
  deploymentTarget: DeploymentTarget,
): Omit<CompanionExecutionBridgeConnectionConfig, 'ca'> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unavailable();
  }
  const entries = [...url.searchParams.entries()];
  const user = decodeUrlComponent(url.username);
  const password = decodeUrlComponent(url.password);
  const target = databaseTargets[deploymentTarget];
  const directRoute =
    url.hostname === target.directHost && user === COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_ROLE;
  const sessionPoolerRoute =
    url.hostname === target.poolerHost && user === target.executionPoolerUser;
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    (!directRoute && !sessionPoolerRoute) ||
    (url.port !== '' && url.port !== '5432') ||
    password.length < 16 ||
    decodeUrlComponent(url.pathname.slice(1)) !== 'postgres' ||
    url.hash !== '' ||
    entries.length !== 1 ||
    entries[0]?.[0] !== 'sslmode' ||
    entries[0]?.[1] !== 'verify-full'
  ) {
    return unavailable();
  }
  return Object.freeze({
    database: 'postgres' as const,
    host: directRoute ? target.directHost : target.poolerHost,
    password,
    port: 5432 as const,
    user: directRoute
      ? COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_ROLE
      : target.executionPoolerUser,
  });
}

function guardedCa(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_GUARDED_FILE_BYTES ||
    value.includes('\0') ||
    value.includes('\r')
  ) {
    return unavailable();
  }

  const withoutFinalNewline = value.endsWith('\n') ? value.slice(0, -1) : value;
  const blocks = withoutFinalNewline.match(
    /-----BEGIN CERTIFICATE-----\n[\s\S]*?\n-----END CERTIFICATE-----/gu,
  );
  if (blocks === null || blocks.length === 0 || blocks.join('\n') !== withoutFinalNewline) {
    return unavailable();
  }

  for (const block of blocks) {
    const lines = block.split('\n');
    if (
      lines[0] !== '-----BEGIN CERTIFICATE-----' ||
      lines.at(-1) !== '-----END CERTIFICATE-----'
    ) {
      return unavailable();
    }
    const payloadLines = lines.slice(1, -1);
    if (
      payloadLines.length === 0 ||
      payloadLines.some(
        (line, index) =>
          line.length < 1 ||
          line.length > 76 ||
          !/^[A-Za-z0-9+/]+={0,2}$/u.test(line) ||
          (index < payloadLines.length - 1 && line.includes('=')),
      )
    ) {
      return unavailable();
    }
    const encoded = payloadLines.join('');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
      return unavailable();
    }
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.byteLength === 0 || decoded.toString('base64') !== encoded) {
      decoded.fill(0);
      return unavailable();
    }
    decoded.fill(0);
  }
  return value;
}

function signerFromPkcs8(
  privateKeyBytes: Buffer,
  keyId: string,
  publicKeySpkiSha256: string,
): CompanionBridgeSigner {
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
    publicKeySpki = Buffer.from(
      createPublicKey(privateKey).export({ format: 'der', type: 'spki' }),
    );
    if (
      publicKeySpki.byteLength !== 91 ||
      `sha256:${createHash('sha256').update(publicKeySpki).digest('hex')}` !== publicKeySpkiSha256
    ) {
      return unavailable();
    }
    return createP256CompanionBridgeSigner(keyId, privateKey, Uint8Array.from(publicKeySpki));
  } catch {
    return unavailable();
  } finally {
    canonicalPrivateKey?.fill(0);
    publicKeySpki?.fill(0);
  }
}

function requireFixedFiles(environment: NodeJS.ProcessEnv, executionEnabled: boolean): void {
  const expected = {
    COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE,
    COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE,
    COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE,
    ...(executionEnabled
      ? {
          COMPANION_DEVICE_BRIDGE_EXECUTION_SIGNER_PRIVATE_KEY_FILE,
          COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_URL_FILE,
        }
      : {}),
  } as const;
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) unavailable();
  }
  if (
    !executionEnabled &&
    (environment.COMPANION_DEVICE_BRIDGE_EXECUTION_SIGNER_PRIVATE_KEY_FILE !== undefined ||
      environment.COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_URL_FILE !== undefined)
  ) {
    unavailable();
  }
}

function rejectInlineOrBroaderSecrets(environment: NodeJS.ProcessEnv): void {
  const forbidden = [
    'DATABASE_URL',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'COMPANION_DEVICE_BRIDGE_DATABASE_URL',
    'COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_URL',
    'COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY',
    'COMPANION_DEVICE_BRIDGE_EXECUTION_SIGNER_PRIVATE_KEY',
    'OWNER_CONTROL_DATABASE_URL',
    'OWNER_CONTROL_DATABASE_URL_FILE',
    'KEMERBET_EXECUTOR_DATABASE_URL',
    'KEMERBET_EXECUTOR_DATABASE_URL_FILE',
    'TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL',
    'TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE',
  ] as const;
  if (forbidden.some((name) => environment[name] !== undefined)) unavailable();
}

export function loadCompanionDeviceBridgeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: CompanionDeviceBridgeConfigDependencies = {},
): CompanionDeviceBridgeConfig {
  const enabled = exactBoolean(environment.INTERNAL_COMPANION_DEVICE_BRIDGE_ENABLED);
  if (!enabled) return Object.freeze({ enabled: false });
  const executionEnabled = exactBoolean(environment.INTERNAL_COMPANION_EXECUTION_V2_ENABLED);
  const deploymentTarget = environment.COMPANION_DEVICE_BRIDGE_DEPLOYMENT_TARGET;
  if (deploymentTarget !== 'staging' && deploymentTarget !== 'production') return unavailable();
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    !exactBoolean(environment.COMPANION_DEVICE_BRIDGE_NO_MONEY_READ_ONLY_LOOKUP_ENABLED) ||
    environment.NODE_EXTRA_CA_CERTS !== COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE
  ) {
    return unavailable();
  }
  rejectInlineOrBroaderSecrets(environment);
  requireFixedFiles(environment, executionEnabled);

  const manifest = runtimeManifestFrom(
    guardedCanonicalJson(
      readGuardedText(COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE, dependencies, 'public_config'),
    ),
    deploymentTarget,
    executionEnabled,
  );
  const privateKeyBytes = readGuardedBytes(
    COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE,
    dependencies,
    'secret',
  );
  let signer: CompanionBridgeSigner;
  try {
    signer = signerFromPkcs8(
      privateKeyBytes,
      manifest.serverSignerKeyId,
      manifest.serverSignerPublicKeySpkiSha256,
    );
  } finally {
    privateKeyBytes.fill(0);
  }
  const ca = guardedCa(
    readGuardedText(COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE, dependencies, 'public_config'),
  );
  let execution: Extract<CompanionDeviceBridgeConfig, { readonly enabled: true }>['execution'];
  if (manifest.contractVersion === 3) {
    const executionPrivateKeyBytes = readGuardedBytes(
      COMPANION_DEVICE_BRIDGE_EXECUTION_SIGNER_PRIVATE_KEY_FILE,
      dependencies,
      'secret',
    );
    let executionSigner: CompanionBridgeSigner;
    try {
      executionSigner = signerFromPkcs8(
        executionPrivateKeyBytes,
        manifest.executionSignerKeyId,
        manifest.executionSignerPublicKeySpkiSha256,
      );
    } finally {
      executionPrivateKeyBytes.fill(0);
    }
    if (
      signer.keyId === executionSigner.keyId ||
      Buffer.from(signer.publicKeySpkiDer).equals(Buffer.from(executionSigner.publicKeySpkiDer)) ||
      Buffer.from(executionSigner.publicKeySpkiDer).toString('base64url') !==
        manifest.executionSignerPublicKeySpki
    ) {
      return unavailable();
    }
    const executionConnection = executionConnectionFromUrl(
      guardedSingleLine(
        readGuardedText(
          COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_URL_FILE,
          dependencies,
          'secret',
        ),
      ),
      deploymentTarget,
    );
    execution = Object.freeze({
      enabled: true,
      signer: executionSigner,
      connection: Object.freeze({ ...executionConnection, ca }),
    });
  } else {
    execution = Object.freeze({ enabled: false });
  }
  const connectionWithoutCa = connectionFromUrl(
    guardedSingleLine(
      readGuardedText(COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE, dependencies, 'secret'),
    ),
    deploymentTarget,
  );
  if (execution.enabled && execution.connection.password === connectionWithoutCa.password) {
    return unavailable();
  }
  return Object.freeze({
    enabled: true,
    deploymentTarget,
    projectReference: databaseTargets[deploymentTarget].projectReference,
    connection: Object.freeze({ ...connectionWithoutCa, ca }),
    serverSignerId: manifest.serverSignerId,
    signer,
    execution,
  });
}

/** Fixed-key, zero-secret diagnostic projection. */
export function redactedCompanionDeviceBridgeConfigForLog(
  config: CompanionDeviceBridgeConfig,
): Readonly<{
  enabled: boolean;
  deploymentTarget: DeploymentTarget | undefined;
  connectionConfigured: boolean;
  signerConfigured: boolean;
  executionTransportConfigured: boolean;
  executionSignerConfigured: boolean;
  pairingAllowed: true;
  exactFiveReadOnlyLookupAllowed: true;
  financialActionAllowed: false;
  moneyMovementAllowed: false;
}> {
  return Object.freeze({
    enabled: config.enabled,
    deploymentTarget: config.enabled ? config.deploymentTarget : undefined,
    connectionConfigured: config.enabled,
    signerConfigured: config.enabled,
    executionTransportConfigured: config.enabled && config.execution.enabled,
    executionSignerConfigured: config.enabled && config.execution.enabled,
    pairingAllowed: true,
    exactFiveReadOnlyLookupAllowed: true,
    financialActionAllowed: false,
    moneyMovementAllowed: false,
  });
}
