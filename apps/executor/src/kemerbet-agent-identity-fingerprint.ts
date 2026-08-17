import { createHash, createHmac, createSecretKey, type KeyObject } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export const KEMERBET_AGENT_IDENTITY_FINGERPRINT_VERSION = 'hmac-sha256-agent-identity-v1' as const;
export const KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN =
  'fetanagent\0kemerbet-agent-signed-in-identity\0v1\0' as const;

const SECRET_FILE_BYTES = 64;
const MAXIMUM_IDENTITY_BYTES = 256;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface SecretFileStat {
  readonly size: number;
  readonly mode: number;
  readonly uid: number;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mtimeMs: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetAgentIdentitySecretFileHandle {
  stat(): Promise<SecretFileStat>;
  readFile(): Promise<Buffer>;
  close(): Promise<void>;
}

export interface KemerBetAgentIdentitySecretFileSystem {
  lstat(path: string): Promise<SecretFileStat>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number): Promise<KemerBetAgentIdentitySecretFileHandle>;
}

export interface KemerBetAgentIdentityFingerprinterOptions {
  readonly secretFilePath: string;
  readonly fileSystem?: KemerBetAgentIdentitySecretFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}

export interface KemerBetAgentIdentityFingerprinter {
  (platformAgentAccountId: string, rawIdentity: string): string;
  readonly keyFingerprint: string;
}

export class KemerBetAgentIdentityFingerprintUnavailableError extends Error {
  constructor() {
    super('The KemerBet agent-identity fingerprint boundary is unavailable.');
    this.name = 'KemerBetAgentIdentityFingerprintUnavailableError';
  }
}

const nodeFileSystem: KemerBetAgentIdentitySecretFileSystem = { lstat, realpath, open };

function unavailable(): never {
  throw new KemerBetAgentIdentityFingerprintUnavailableError();
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

function validateSecretStat(
  stat: SecretFileStat,
  platform: NodeJS.Platform,
  effectiveUserId: number | null,
): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !Number.isSafeInteger(stat.size) ||
    !Number.isFinite(stat.mtimeMs) ||
    stat.size !== SECRET_FILE_BYTES ||
    (platform !== 'win32' &&
      ((stat.uid !== 0 && stat.uid !== effectiveUserId) || (stat.mode & 0o022) !== 0))
  ) {
    unavailable();
  }
}

function sameOpenedFile(before: SecretFileStat, after: SecretFileStat): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.uid === after.uid &&
    before.mode === after.mode &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs
  );
}

function decodeLowercaseHexSecret(secret: Buffer): Buffer {
  if (secret.length !== SECRET_FILE_BYTES) unavailable();
  const decoded = Buffer.alloc(SECRET_FILE_BYTES / 2);
  const nibble = (byte: number): number => {
    if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
    if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
    return unavailable();
  };
  try {
    for (let index = 0; index < decoded.length; index += 1) {
      decoded[index] = (nibble(secret[index * 2]!) << 4) | nibble(secret[index * 2 + 1]!);
    }
    return decoded;
  } catch (error) {
    decoded.fill(0);
    throw error;
  }
}

function encodeIdentity(rawIdentity: string): Buffer {
  if (
    typeof rawIdentity !== 'string' ||
    rawIdentity.length < 1 ||
    rawIdentity !== rawIdentity.trim() ||
    /\r|\n|\0/u.test(rawIdentity)
  ) {
    return unavailable();
  }
  const encoded = Buffer.from(rawIdentity, 'utf8');
  if (encoded.length < 1 || encoded.length > MAXIMUM_IDENTITY_BYTES) {
    encoded.fill(0);
    return unavailable();
  }
  return encoded;
}

function canonicalAccountId(value: string): string {
  if (!UUID_PATTERN.test(value) || value === '00000000-0000-0000-0000-000000000000') {
    return unavailable();
  }
  return value;
}

function fingerprint(key: KeyObject, platformAgentAccountId: string, rawIdentity: string): string {
  const accountId = canonicalAccountId(platformAgentAccountId);
  const encodedIdentity = encodeIdentity(rawIdentity);
  try {
    const digest = createHmac('sha256', key)
      .update(KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN, 'utf8')
      .update(accountId, 'utf8')
      .update('\0', 'utf8')
      .update(encodedIdentity)
      .digest('hex');
    return `${KEMERBET_AGENT_IDENTITY_FINGERPRINT_VERSION}:${digest}`;
  } finally {
    encodedIdentity.fill(0);
  }
}

export async function createKemerBetAgentIdentityFingerprinter(
  options: KemerBetAgentIdentityFingerprinterOptions,
): Promise<KemerBetAgentIdentityFingerprinter> {
  if (!isAbsolute(options.secretFilePath) || /\0/u.test(options.secretFilePath)) unavailable();
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const platform = options.platform ?? process.platform;
  const effectiveUserId =
    platform === 'win32'
      ? null
      : (options.effectiveUserId ??
        (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN));
  if (
    platform !== 'win32' &&
    (!Number.isSafeInteger(effectiveUserId) || effectiveUserId === null || effectiveUserId < 0)
  ) {
    unavailable();
  }
  let handle: KemerBetAgentIdentitySecretFileHandle | null = null;
  let secret: Buffer | null = null;
  let decodedSecret: Buffer | null = null;
  try {
    const before = await fileSystem.lstat(options.secretFilePath);
    validateSecretStat(before, platform, effectiveUserId);
    if (
      !samePath(await fileSystem.realpath(options.secretFilePath), options.secretFilePath, platform)
    ) {
      unavailable();
    }
    handle = await fileSystem.open(
      options.secretFilePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const after = await handle.stat();
    validateSecretStat(after, platform, effectiveUserId);
    if (!sameOpenedFile(before, after)) unavailable();
    secret = await handle.readFile();
    const afterRead = await handle.stat();
    validateSecretStat(afterRead, platform, effectiveUserId);
    if (!sameOpenedFile(after, afterRead) || secret.length !== afterRead.size) unavailable();
    decodedSecret = decodeLowercaseHexSecret(secret);
    const keyFingerprint = createHash('sha256').update(decodedSecret).digest('hex');
    const key = createSecretKey(decodedSecret);
    const fingerprinter = (platformAgentAccountId: string, rawIdentity: string) =>
      fingerprint(key, platformAgentAccountId, rawIdentity);
    return Object.defineProperty(fingerprinter, 'keyFingerprint', {
      value: keyFingerprint,
      enumerable: false,
      writable: false,
      configurable: false,
    }) as KemerBetAgentIdentityFingerprinter;
  } catch {
    return unavailable();
  } finally {
    secret?.fill(0);
    decodedSecret?.fill(0);
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // No key, path, or raw identity is emitted.
      }
    }
  }
}
