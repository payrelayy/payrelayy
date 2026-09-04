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

import type { TelebirrDeviceBridgeServerSigner } from './telebirr-device-bridge.js';
import {
  TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
  TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
} from './telebirr-device-bridge-server.js';

export const TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE =
  '/run/secrets/telebirr_device_bridge_server_signer.pkcs8.der' as const;
export const TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE =
  '/run/configs/telebirr_device_bridge_assignment_signer.spki.der' as const;
export const TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE =
  '/run/configs/telebirr_device_bridge_runtime_manifest.v1.json' as const;

const MAX_GUARDED_FILE_BYTES = 16_384;
const MAX_SIGNING_TRANSCRIPT_BYTES = 65_536;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type TelebirrDeviceBridgeConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly deploymentTarget: 'staging';
      readonly host: typeof TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST;
      readonly port: typeof TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT;
      readonly serverSigningPublicKeySpkiDer: Uint8Array;
      readonly assignmentSigningPublicKeySpkiDer: Uint8Array;
      readonly serverSigner: TelebirrDeviceBridgeServerSigner;
    };

export interface TelebirrDeviceBridgeGuardedFileStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface TelebirrDeviceBridgeGuardedFileHandle {
  close(): void;
  read(maximumBytes: number): Buffer;
  stat(): TelebirrDeviceBridgeGuardedFileStat;
}

export interface TelebirrDeviceBridgeGuardedFileSystem {
  lstat(path: string): TelebirrDeviceBridgeGuardedFileStat;
  open(path: string, flags: number): TelebirrDeviceBridgeGuardedFileHandle;
  realpath(path: string): string;
}

export interface TelebirrDeviceBridgeConfigDependencies {
  readonly effectiveUserId?: number;
  readonly fileSystem?: TelebirrDeviceBridgeGuardedFileSystem;
  readonly platform?: NodeJS.Platform;
}

export class TelebirrDeviceBridgeConfigError extends Error {
  constructor() {
    super('The TeleBirr device bridge configuration is unavailable.');
    this.name = 'TelebirrDeviceBridgeConfigError';
  }
}

const nodeGuardedFileSystem: TelebirrDeviceBridgeGuardedFileSystem = {
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
  throw new TelebirrDeviceBridgeConfigError();
}

function exactBoolean(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return unavailable();
}

function sameFile(
  left: TelebirrDeviceBridgeGuardedFileStat,
  right: TelebirrDeviceBridgeGuardedFileStat,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function assertGuardedFile(
  stat: TelebirrDeviceBridgeGuardedFileStat,
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
  dependencies: TelebirrDeviceBridgeConfigDependencies,
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

  let handle: TelebirrDeviceBridgeGuardedFileHandle | undefined;
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
  dependencies: TelebirrDeviceBridgeConfigDependencies,
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

function parseCanonicalManifest(value: string): Readonly<{
  serverSignerKeyId: string;
  serverSigningPublicKeySpkiSha256: string;
  assignmentSigningPublicKeySpkiSha256: string;
}> {
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
    Object.keys(parsed).join(',') !==
      [
        'contractVersion',
        'providerCode',
        'serverSignerKeyId',
        'serverSigningPublicKeySpkiSha256',
        'assignmentSigningPublicKeySpkiSha256',
      ].join(',') ||
    JSON.stringify(parsed) !== value
  ) {
    return unavailable();
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.contractVersion !== 1 ||
    record.providerCode !== 'telebirr' ||
    typeof record.serverSignerKeyId !== 'string' ||
    !KEY_ID_PATTERN.test(record.serverSignerKeyId) ||
    typeof record.serverSigningPublicKeySpkiSha256 !== 'string' ||
    !SHA256_PATTERN.test(record.serverSigningPublicKeySpkiSha256) ||
    typeof record.assignmentSigningPublicKeySpkiSha256 !== 'string' ||
    !SHA256_PATTERN.test(record.assignmentSigningPublicKeySpkiSha256)
  ) {
    return unavailable();
  }
  return Object.freeze({
    serverSignerKeyId: record.serverSignerKeyId,
    serverSigningPublicKeySpkiSha256: record.serverSigningPublicKeySpkiSha256,
    assignmentSigningPublicKeySpkiSha256: record.assignmentSigningPublicKeySpkiSha256,
  });
}

function publicKeyFromSpki(bytes: Buffer, expectedDigest: string): Uint8Array {
  let publicKey: KeyObject;
  let canonical: Buffer | undefined;
  try {
    publicKey = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    canonical = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }));
    if (
      publicKey.type !== 'public' ||
      publicKey.asymmetricKeyType !== 'ec' ||
      publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      canonical.byteLength !== 91 ||
      !canonical.equals(bytes) ||
      `sha256:${createHash('sha256').update(canonical).digest('hex')}` !== expectedDigest
    ) {
      return unavailable();
    }
    return Uint8Array.from(canonical);
  } catch {
    return unavailable();
  } finally {
    canonical?.fill(0);
  }
}

function signerFromPkcs8(
  privateKeyBytes: Buffer,
  keyId: string,
  expectedPublicKeyDigest: string,
): Readonly<{
  signer: TelebirrDeviceBridgeServerSigner;
  publicKeySpkiDer: Uint8Array;
}> {
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
      `sha256:${createHash('sha256').update(publicKeySpki).digest('hex')}` !==
        expectedPublicKeyDigest
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
    publicKeySpkiDer: retainedPublicKey,
    signer: Object.freeze({
      keyId,
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
    }),
  });
}

function requireFixedEnvironment(environment: NodeJS.ProcessEnv): void {
  const expected = {
    TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
    TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE,
    TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE,
    TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE,
  } as const;
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== String(value)) unavailable();
  }
  if (
    environment.TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT !== String(TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT)
  ) {
    unavailable();
  }
}

function rejectBroaderAuthority(environment: NodeJS.ProcessEnv): void {
  const forbidden = [
    'DATABASE_URL',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY',
    'TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL',
    'TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE',
    'TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL',
    'TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE',
    'TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY',
    'TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE',
    'TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY',
    'TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
    'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
    'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE',
    'TELEGRAM_BOT_TOKEN',
  ] as const;
  if (forbidden.some((name) => environment[name] !== undefined)) unavailable();
  for (const name of [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'FTP_PROXY',
    'ftp_proxy',
    'ALL_PROXY',
    'all_proxy',
  ]) {
    if (environment[name] !== undefined && environment[name] !== '') unavailable();
  }
}

export function loadTelebirrDeviceBridgeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: TelebirrDeviceBridgeConfigDependencies = {},
): TelebirrDeviceBridgeConfig {
  const enabled = exactBoolean(environment.INTERNAL_TELEBIRR_DEVICE_BRIDGE_ENABLED);
  if (!enabled) return Object.freeze({ enabled: false });
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    !exactBoolean(environment.TELEBIRR_DEVICE_BRIDGE_NO_MONEY_PILOT_ENABLED) ||
    environment.TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET !== 'staging'
  ) {
    return unavailable();
  }
  rejectBroaderAuthority(environment);
  requireFixedEnvironment(environment);

  const manifest = parseCanonicalManifest(
    readGuardedText(TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE, dependencies, 'public_config'),
  );
  const serverPrivateKey = readGuardedBytes(
    TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE,
    dependencies,
    'secret',
  );
  let server: ReturnType<typeof signerFromPkcs8>;
  try {
    server = signerFromPkcs8(
      serverPrivateKey,
      manifest.serverSignerKeyId,
      manifest.serverSigningPublicKeySpkiSha256,
    );
  } finally {
    serverPrivateKey.fill(0);
  }
  const assignmentPublicKey = readGuardedBytes(
    TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE,
    dependencies,
    'public_config',
  );
  let assignmentSigningPublicKeySpkiDer: Uint8Array;
  try {
    assignmentSigningPublicKeySpkiDer = publicKeyFromSpki(
      assignmentPublicKey,
      manifest.assignmentSigningPublicKeySpkiSha256,
    );
  } finally {
    assignmentPublicKey.fill(0);
  }
  return Object.freeze({
    enabled: true,
    deploymentTarget: 'staging' as const,
    host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
    port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
    serverSigningPublicKeySpkiDer: server.publicKeySpkiDer,
    assignmentSigningPublicKeySpkiDer,
    serverSigner: server.signer,
  });
}

/** Fixed-key, zero-secret diagnostic projection. */
export function redactedTelebirrDeviceBridgeConfigForLog(
  config: TelebirrDeviceBridgeConfig,
): Readonly<{
  enabled: boolean;
  deploymentTarget: 'staging' | undefined;
  serverSignerConfigured: boolean;
  assignmentSignerPublicKeyConfigured: boolean;
}> {
  return Object.freeze({
    enabled: config.enabled,
    deploymentTarget: config.enabled ? config.deploymentTarget : undefined,
    serverSignerConfigured: config.enabled,
    assignmentSignerPublicKeyConfigured: config.enabled,
  });
}
