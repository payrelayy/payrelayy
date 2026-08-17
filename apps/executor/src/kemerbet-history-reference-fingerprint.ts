import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createHash, createHmac, createSecretKey, type KeyObject } from 'node:crypto';

export const KEMERBET_HISTORY_REFERENCE_FINGERPRINT_VERSION = 'hmac-sha256-v1' as const;
export const KEMERBET_HISTORY_REFERENCE_FINGERPRINT_DOMAIN =
  'fetanagent\0kemerbet-agent-history-reference\0v1\0' as const;

const SECRET_FILE_BYTES = 64;
const MAXIMUM_REFERENCE_BYTES = 256;

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

export interface KemerBetHistoryReferenceSecretFileHandle {
  stat(): Promise<SecretFileStat>;
  readFile(): Promise<Buffer>;
  close(): Promise<void>;
}

export interface KemerBetHistoryReferenceSecretFileSystem {
  lstat(path: string): Promise<SecretFileStat>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number): Promise<KemerBetHistoryReferenceSecretFileHandle>;
}

export interface KemerBetHistoryReferenceFingerprinterOptions {
  readonly secretFilePath: string;
  readonly fileSystem?: KemerBetHistoryReferenceSecretFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}

export interface KemerBetHistoryReferenceFingerprinter {
  (rawReference: string): string;
  readonly keyFingerprint: string;
}

export class KemerBetHistoryReferenceFingerprintUnavailableError extends Error {
  constructor() {
    super('The KemerBet history-reference fingerprint boundary is unavailable.');
    this.name = 'KemerBetHistoryReferenceFingerprintUnavailableError';
  }
}

const nodeFileSystem: KemerBetHistoryReferenceSecretFileSystem = {
  lstat,
  realpath,
  open,
};

function unavailable(): never {
  throw new KemerBetHistoryReferenceFingerprintUnavailableError();
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
    stat.size !== SECRET_FILE_BYTES
  ) {
    unavailable();
  }
  // Windows ACLs do not map safely to POSIX group/other bits. On POSIX, reject a key readable or
  // writable by anyone other than its owner.
  if (
    platform !== 'win32' &&
    ((stat.uid !== 0 && stat.uid !== effectiveUserId) || (stat.mode & 0o022) !== 0)
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

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

function validateReference(rawReference: string): Buffer {
  if (
    typeof rawReference !== 'string' ||
    rawReference.length < 1 ||
    rawReference !== rawReference.trim() ||
    /\r|\n|\0/u.test(rawReference)
  ) {
    return unavailable();
  }
  const encoded = Buffer.from(rawReference, 'utf8');
  if (encoded.length < 1 || encoded.length > MAXIMUM_REFERENCE_BYTES) {
    encoded.fill(0);
    return unavailable();
  }
  return encoded;
}

function fingerprint(key: KeyObject, rawReference: string): string {
  const encodedReference = validateReference(rawReference);
  try {
    const digest = createHmac('sha256', key)
      .update(KEMERBET_HISTORY_REFERENCE_FINGERPRINT_DOMAIN, 'utf8')
      .update(encodedReference)
      .digest('hex');
    return `${KEMERBET_HISTORY_REFERENCE_FINGERPRINT_VERSION}:${digest}`;
  } finally {
    encodedReference.fill(0);
  }
}

/**
 * Load the HMAC key once from a non-symlink regular file. Errors deliberately omit the path, key,
 * and reference. The returned synchronous function matches the deposit browser adapter boundary.
 */
export async function createKemerBetHistoryReferenceFingerprinter(
  options: KemerBetHistoryReferenceFingerprinterOptions,
): Promise<KemerBetHistoryReferenceFingerprinter> {
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
  let handle: KemerBetHistoryReferenceSecretFileHandle | null = null;
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
    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await fileSystem.open(options.secretFilePath, constants.O_RDONLY | noFollow);
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
    const fingerprinter = (rawReference: string) => fingerprint(key, rawReference);
    return Object.defineProperty(fingerprinter, 'keyFingerprint', {
      value: keyFingerprint,
      enumerable: false,
      writable: false,
      configurable: false,
    }) as KemerBetHistoryReferenceFingerprinter;
  } catch {
    return unavailable();
  } finally {
    secret?.fill(0);
    decodedSecret?.fill(0);
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // The generic failure above is enough when loading failed. A close failure after the key
        // was copied does not expose secret material and does not make the HMAC function unsafe.
      }
    }
  }
}
