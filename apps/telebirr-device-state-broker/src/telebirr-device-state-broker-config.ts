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

import type { TelebirrDeviceStateConnectionConfig } from './postgres-telebirr-device-state.js';

export const TELEBIRR_DEVICE_STATE_BROKER_DATABASE_ROLE =
  'fetanagent_telebirr_device_state_runtime' as const;
export const TELEBIRR_DEVICE_STATE_BROKER_STAGING_PROJECT_REFERENCE =
  'spzpiyxheappsfyswewl' as const;
export const TELEBIRR_DEVICE_STATE_BROKER_STAGING_DATABASE_HOST =
  'db.spzpiyxheappsfyswewl.supabase.co' as const;
export const TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE =
  '/run/secrets/telebirr_device_state_broker_database_url' as const;
export const TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE =
  '/run/configs/supabase_ca_certificate' as const;

const MAX_GUARDED_FILE_BYTES = 16_384;

export type TelebirrDeviceStateBrokerConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly deploymentTarget: 'staging';
      readonly projectReference: typeof TELEBIRR_DEVICE_STATE_BROKER_STAGING_PROJECT_REFERENCE;
      readonly connection: TelebirrDeviceStateConnectionConfig;
    };

export interface TelebirrDeviceStateBrokerGuardedFileStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface TelebirrDeviceStateBrokerGuardedFileHandle {
  close(): void;
  read(maximumBytes: number): Buffer;
  stat(): TelebirrDeviceStateBrokerGuardedFileStat;
}

export interface TelebirrDeviceStateBrokerGuardedFileSystem {
  lstat(path: string): TelebirrDeviceStateBrokerGuardedFileStat;
  open(path: string, flags: number): TelebirrDeviceStateBrokerGuardedFileHandle;
  realpath(path: string): string;
}

export interface TelebirrDeviceStateBrokerConfigDependencies {
  readonly effectiveUserId?: number;
  readonly fileSystem?: TelebirrDeviceStateBrokerGuardedFileSystem;
  readonly platform?: NodeJS.Platform;
}

export class TelebirrDeviceStateBrokerConfigError extends Error {
  constructor() {
    super('The private TeleBirr device-state broker configuration is unavailable.');
    this.name = 'TelebirrDeviceStateBrokerConfigError';
  }
}

const nodeGuardedFileSystem: TelebirrDeviceStateBrokerGuardedFileSystem = {
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
  throw new TelebirrDeviceStateBrokerConfigError();
}

function exactBoolean(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return unavailable();
}

function sameFile(
  left: TelebirrDeviceStateBrokerGuardedFileStat,
  right: TelebirrDeviceStateBrokerGuardedFileStat,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function assertGuardedFile(
  stat: TelebirrDeviceStateBrokerGuardedFileStat,
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
  dependencies: TelebirrDeviceStateBrokerConfigDependencies,
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

  let handle: TelebirrDeviceStateBrokerGuardedFileHandle | undefined;
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
  dependencies: TelebirrDeviceStateBrokerConfigDependencies,
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

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return unavailable();
  }
}

function connectionFromUrl(value: string): Omit<TelebirrDeviceStateConnectionConfig, 'ca'> {
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
    url.hostname !== TELEBIRR_DEVICE_STATE_BROKER_STAGING_DATABASE_HOST ||
    (url.port !== '' && url.port !== '5432') ||
    user !== TELEBIRR_DEVICE_STATE_BROKER_DATABASE_ROLE ||
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
    host: TELEBIRR_DEVICE_STATE_BROKER_STAGING_DATABASE_HOST,
    password,
    port: 5432 as const,
    user: TELEBIRR_DEVICE_STATE_BROKER_DATABASE_ROLE,
  });
}

function guardedCa(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_GUARDED_FILE_BYTES ||
    value.includes('\0') ||
    !/^(?:-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/]{1,76}\n)*[A-Za-z0-9+/]{1,76}={0,2}\n-----END CERTIFICATE-----\n?)+$/u.test(
      value,
    )
  ) {
    return unavailable();
  }
  return value;
}

function requireFixedFiles(environment: NodeJS.ProcessEnv): void {
  if (
    environment.TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE !==
    TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE
  ) {
    unavailable();
  }
}

function rejectInlineOrRootSecrets(environment: NodeJS.ProcessEnv): void {
  const forbidden = [
    'DATABASE_URL',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL',
    'TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY',
    'TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE',
    'TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY',
    'TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
    'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
    'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE',
  ] as const;
  if (forbidden.some((name) => environment[name] !== undefined)) unavailable();
}

export function loadTelebirrDeviceStateBrokerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: TelebirrDeviceStateBrokerConfigDependencies = {},
): TelebirrDeviceStateBrokerConfig {
  const enabled = exactBoolean(environment.INTERNAL_TELEBIRR_DEVICE_STATE_BROKER_ENABLED);
  if (!enabled) return Object.freeze({ enabled: false });
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    !exactBoolean(environment.TELEBIRR_DEVICE_STATE_BROKER_NO_MONEY_PILOT_ENABLED) ||
    environment.TELEBIRR_DEVICE_STATE_BROKER_DEPLOYMENT_TARGET !== 'staging' ||
    environment.NODE_EXTRA_CA_CERTS !== TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE
  ) {
    return unavailable();
  }
  rejectInlineOrRootSecrets(environment);
  requireFixedFiles(environment);

  const connectionWithoutCa = connectionFromUrl(
    guardedSingleLine(
      readGuardedText(TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE, dependencies, 'secret'),
    ),
  );
  const ca = guardedCa(
    readGuardedText(TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE, dependencies, 'public_config'),
  );
  return Object.freeze({
    enabled: true,
    deploymentTarget: 'staging' as const,
    projectReference: TELEBIRR_DEVICE_STATE_BROKER_STAGING_PROJECT_REFERENCE,
    connection: Object.freeze({ ...connectionWithoutCa, ca }),
  });
}

/** Fixed-key, zero-secret diagnostic projection. */
export function redactedTelebirrDeviceStateBrokerConfigForLog(
  config: TelebirrDeviceStateBrokerConfig,
): Readonly<{
  enabled: boolean;
  deploymentTarget: 'staging' | undefined;
  connectionConfigured: boolean;
}> {
  return Object.freeze({
    enabled: config.enabled,
    deploymentTarget: config.enabled ? config.deploymentTarget : undefined,
    connectionConfigured: config.enabled,
  });
}
