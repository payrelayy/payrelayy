import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { createHash, createPublicKey } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

import type { TrustedTelebirrVerifierConnectionConfig } from './postgres-trusted-telebirr-verifier.js';
import type {
  TrustedTelebirrPinnedKeys,
  TrustedTelebirrPinnedPublicKey,
} from './trusted-telebirr-verifier.js';

export const TRUSTED_TELEBIRR_VERIFIER_DATABASE_ROLE =
  'fetanagent_trusted_telebirr_verifier_runtime' as const;
export const TRUSTED_TELEBIRR_VERIFIER_STAGING_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl' as const;
export const TRUSTED_TELEBIRR_VERIFIER_STAGING_DATABASE_HOST =
  'db.spzpiyxheappsfyswewl.supabase.co' as const;
export const TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE =
  '/run/secrets/trusted_telebirr_verifier_database_url' as const;
export const TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE =
  '/run/configs/trusted_telebirr_verifier_pins.v1.json' as const;
export const TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE =
  '/run/configs/supabase_ca_certificate' as const;

const MAX_CONFIG_BYTES = 16_384;

export type TrustedTelebirrVerifierConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly deploymentTarget: 'staging';
      readonly projectReference: typeof TRUSTED_TELEBIRR_VERIFIER_STAGING_PROJECT_REFERENCE;
      readonly connection: TrustedTelebirrVerifierConnectionConfig;
      readonly pinnedKeys: TrustedTelebirrPinnedKeys;
    };

export interface TrustedTelebirrVerifierGuardedFileStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface TrustedTelebirrVerifierGuardedFileHandle {
  close(): void;
  read(maximumBytes: number): Buffer;
  stat(): TrustedTelebirrVerifierGuardedFileStat;
}

export interface TrustedTelebirrVerifierGuardedFileSystem {
  lstat(path: string): TrustedTelebirrVerifierGuardedFileStat;
  open(path: string, flags: number): TrustedTelebirrVerifierGuardedFileHandle;
  realpath(path: string): string;
}

export interface TrustedTelebirrVerifierConfigDependencies {
  readonly effectiveUserId?: number;
  readonly fileSystem?: TrustedTelebirrVerifierGuardedFileSystem;
  readonly platform?: NodeJS.Platform;
}

const nodeGuardedFileSystem: TrustedTelebirrVerifierGuardedFileSystem = {
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
  throw new Error('The trusted TeleBirr verifier configuration is unavailable.');
}

function exactBoolean(value: string | undefined, name: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be exactly true or false.`);
}

function guardedText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, 'utf8') > MAX_CONFIG_BYTES ||
    /[\0\r\n]/u.test(value)
  ) {
    return unavailable();
  }
  return value;
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function sameFile(
  left: TrustedTelebirrVerifierGuardedFileStat,
  right: TrustedTelebirrVerifierGuardedFileStat,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function assertGuardedFileStat(
  stat: TrustedTelebirrVerifierGuardedFileStat,
  effectiveUserId: number,
  confidentiality: 'public_config' | 'secret',
): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !Number.isSafeInteger(stat.size) ||
    stat.size < 1 ||
    stat.size > MAX_CONFIG_BYTES ||
    !Number.isFinite(stat.mtimeMs) ||
    !Number.isSafeInteger(stat.uid) ||
    (stat.uid !== 0 && stat.uid !== effectiveUserId) ||
    (stat.mode & 0o022) !== 0 ||
    (confidentiality === 'secret' && ((stat.mode & 0o400) === 0 || (stat.mode & 0o077) !== 0))
  ) {
    unavailable();
  }
}

function readGuarded(
  path: string,
  dependencies: TrustedTelebirrVerifierConfigDependencies,
  confidentiality: 'public_config' | 'secret',
): string {
  const fileSystem = dependencies.fileSystem ?? nodeGuardedFileSystem;
  const platform = dependencies.platform ?? process.platform;
  const effectiveUserId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (platform !== 'linux' || !Number.isSafeInteger(effectiveUserId) || effectiveUserId < 0) {
    return unavailable();
  }

  let handle: TrustedTelebirrVerifierGuardedFileHandle | null = null;
  let bytes: Buffer | null = null;
  try {
    const before = fileSystem.lstat(path);
    assertGuardedFileStat(before, effectiveUserId, confidentiality);
    if (!samePath(fileSystem.realpath(path), path)) unavailable();

    handle = fileSystem.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = handle.stat();
    assertGuardedFileStat(opened, effectiveUserId, confidentiality);
    if (!sameFile(before, opened)) unavailable();

    bytes = handle.read(MAX_CONFIG_BYTES);
    const after = handle.stat();
    assertGuardedFileStat(after, effectiveUserId, confidentiality);
    if (!sameFile(opened, after) || bytes.byteLength !== opened.size) unavailable();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return unavailable();
  } finally {
    bytes?.fill(0);
    if (handle !== null) {
      try {
        handle.close();
      } catch {
        // Every filesystem failure is deliberately reduced to the fixed unavailable error.
      }
    }
  }
}

function guardedCa(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_CONFIG_BYTES ||
    value.includes('\0') ||
    !/^(?:-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/]{1,76}\n)+-----END CERTIFICATE-----\n?)+$/u.test(
      value,
    )
  ) {
    unavailable();
  }
  return value;
}

function decodedComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return unavailable();
  }
}

function connectionFromUrl(value: string): Omit<TrustedTelebirrVerifierConnectionConfig, 'ca'> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unavailable();
  }
  const entries = [...url.searchParams.entries()];
  const user = decodedComponent(url.username);
  const password = decodedComponent(url.password);
  const database = decodedComponent(url.pathname.slice(1));
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname !== TRUSTED_TELEBIRR_VERIFIER_STAGING_DATABASE_HOST ||
    (url.port !== '' && url.port !== '5432') ||
    user !== TRUSTED_TELEBIRR_VERIFIER_DATABASE_ROLE ||
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
    host: TRUSTED_TELEBIRR_VERIFIER_STAGING_DATABASE_HOST,
    password,
    port: 5432 as const,
    user: TRUSTED_TELEBIRR_VERIFIER_DATABASE_ROLE,
  });
}

function pinFrom(value: unknown): TrustedTelebirrPinnedPublicKey | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).join(',') !== 'keyId,publicKeySpkiDerBase64' ||
    typeof record.keyId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(record.keyId) ||
    typeof record.publicKeySpkiDerBase64 !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(record.publicKeySpkiDerBase64)
  ) {
    return undefined;
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(record.publicKeySpkiDerBase64, 'base64');
  } catch {
    return undefined;
  }
  if (bytes.toString('base64') !== record.publicKeySpkiDerBase64) {
    bytes.fill(0);
    return undefined;
  }
  let canonical: Buffer | null = null;
  try {
    const publicKey = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    canonical = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }));
    if (
      publicKey.type !== 'public' ||
      publicKey.asymmetricKeyType !== 'ec' ||
      publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      canonical.byteLength !== 91 ||
      !canonical.equals(bytes)
    ) {
      return undefined;
    }
    return Object.freeze({
      keyId: record.keyId,
      publicKeySpkiDer: Uint8Array.from(canonical),
    });
  } catch {
    return undefined;
  } finally {
    canonical?.fill(0);
    bytes.fill(0);
  }
}

function pinArray(value: unknown): readonly TrustedTelebirrPinnedPublicKey[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return undefined;
  const pins = value.map(pinFrom);
  if (pins.some((pin) => pin === undefined)) return undefined;
  const definedPins = pins as TrustedTelebirrPinnedPublicKey[];
  if (new Set(definedPins.map((pin) => pin.keyId)).size !== definedPins.length) return undefined;
  return Object.freeze(definedPins);
}

function pinsFromManifest(value: string): TrustedTelebirrPinnedKeys {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return unavailable();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return unavailable();
  const record = parsed as Record<string, unknown>;
  const assignmentSigners = pinArray(record.assignmentSigners);
  const devices = pinArray(record.devices);
  if (
    Object.keys(record).join(',') !== 'contractVersion,assignmentSigners,devices' ||
    record.contractVersion !== 1 ||
    !assignmentSigners ||
    !devices ||
    JSON.stringify(record) !== value
  ) {
    return unavailable();
  }
  const allKeyIds = [...assignmentSigners, ...devices].map((pin) => pin.keyId);
  const allFingerprints = [...assignmentSigners, ...devices].map((pin) =>
    createHash('sha256').update(pin.publicKeySpkiDer).digest('hex'),
  );
  if (
    new Set(allKeyIds).size !== allKeyIds.length ||
    new Set(allFingerprints).size !== allFingerprints.length
  ) {
    return unavailable();
  }
  return Object.freeze({ assignmentSigners, devices });
}

export function loadTrustedTelebirrVerifierConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: TrustedTelebirrVerifierConfigDependencies = {},
): TrustedTelebirrVerifierConfig {
  const enabled = exactBoolean(
    environment.INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED,
    'INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED',
  );
  if (!enabled) return Object.freeze({ enabled: false });
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'live' ||
    !exactBoolean(
      environment.TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED,
      'TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED',
    ) ||
    environment.TRUSTED_TELEBIRR_VERIFIER_DEPLOYMENT_TARGET !== 'staging' ||
    environment.NODE_EXTRA_CA_CERTS !== TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE
  ) {
    return unavailable();
  }
  const databaseFile = environment.TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE;
  const pinFile = environment.TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE;
  if (
    !databaseFile ||
    !pinFile ||
    !isAbsolute(databaseFile) ||
    !isAbsolute(pinFile) ||
    databaseFile !== TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE ||
    pinFile !== TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE
  ) {
    return unavailable();
  }
  const connectionWithoutCa = connectionFromUrl(
    guardedText(readGuarded(databaseFile, dependencies, 'secret')),
  );
  const pinnedKeys = pinsFromManifest(
    guardedText(readGuarded(pinFile, dependencies, 'public_config')),
  );
  const ca = guardedCa(
    readGuarded(TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE, dependencies, 'public_config'),
  );
  const connection = Object.freeze({ ...connectionWithoutCa, ca });
  return Object.freeze({
    enabled: true,
    deploymentTarget: 'staging' as const,
    projectReference: TRUSTED_TELEBIRR_VERIFIER_STAGING_PROJECT_REFERENCE,
    connection,
    pinnedKeys,
  });
}
