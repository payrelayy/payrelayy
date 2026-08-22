import { constants } from 'node:fs';
import { access, lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_IDENTITY_FINGERPRINT_PATTERN = /^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u;
const MAXIMUM_AGENT_ACCOUNTS = 64;
const MAXIMUM_BINDING_FILE_BYTES = 16_384;
const MAXIMUM_SELECTOR_FILE_BYTES = 128 * 1_024;
const EXACT_READINESS_PLAYER_COUNT = 5;
const MAXIMUM_READINESS_PLAYER_IDS_FILE_BYTES = 1_024;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

interface IsolationFileStat {
  readonly size: number;
  readonly mode: number;
  readonly uid: number;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mtimeMs: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface ExecutorIsolationFileHandle {
  stat(): Promise<IsolationFileStat>;
  readFile(): Promise<Buffer>;
  close(): Promise<void>;
}

export interface ExecutorIsolationFileSystem {
  lstat(path: string): Promise<IsolationFileStat>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number): Promise<ExecutorIsolationFileHandle>;
  access(path: string, mode: number): Promise<void>;
}

const nodeFileSystem: ExecutorIsolationFileSystem = { lstat, realpath, open, access };

export class KemerBetExecutorIsolationUnavailableError extends Error {
  constructor() {
    super('The KemerBet executor runtime isolation boundary is unavailable.');
    this.name = 'KemerBetExecutorIsolationUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetExecutorIsolationUnavailableError();
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

function sameFile(left: IsolationFileStat, right: IsolationFileStat): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.mtimeMs === right.mtimeMs
  );
}

function effectiveUserId(platform: NodeJS.Platform, configured?: number): number | null {
  if (platform === 'win32') return null;
  const value =
    configured ?? (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (!Number.isSafeInteger(value) || value < 0) return unavailable();
  return value;
}

function trustedFileStat(
  stat: IsolationFileStat,
  platform: NodeJS.Platform,
  executorUserId: number | null,
): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    Number.isSafeInteger(stat.size) &&
    Number.isFinite(stat.mtimeMs) &&
    (platform === 'win32' ||
      ((stat.uid === 0 || stat.uid === executorUserId) && (stat.mode & 0o022) === 0))
  );
}

async function readVerifiedTextFile(options: {
  readonly path: string;
  readonly maximumBytes: number;
  readonly fileSystem: ExecutorIsolationFileSystem;
  readonly platform: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<string> {
  if (!isAbsolute(options.path) || /\0/u.test(options.path)) return unavailable();
  let handle: ExecutorIsolationFileHandle | null = null;
  let bytes: Buffer | null = null;
  try {
    const executorUserId = effectiveUserId(options.platform, options.effectiveUserId);
    const before = await options.fileSystem.lstat(options.path);
    if (
      !trustedFileStat(before, options.platform, executorUserId) ||
      before.size < 1 ||
      before.size > options.maximumBytes ||
      !samePath(await options.fileSystem.realpath(options.path), options.path, options.platform)
    ) {
      return unavailable();
    }
    handle = await options.fileSystem.open(
      options.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const after = await handle.stat();
    if (
      !trustedFileStat(after, options.platform, executorUserId) ||
      !sameFile(before, after) ||
      after.size < 1 ||
      after.size > options.maximumBytes
    ) {
      return unavailable();
    }
    bytes = await handle.readFile();
    const afterRead = await handle.stat();
    if (
      !trustedFileStat(afterRead, options.platform, executorUserId) ||
      !sameFile(after, afterRead) ||
      bytes.length !== afterRead.size
    ) {
      return unavailable();
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return unavailable();
  } finally {
    bytes?.fill(0);
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // The caller receives only the generic isolation failure from the guarded operation.
      }
    }
  }
}

export interface KemerBetAgentIdentityBindings {
  readonly platformAgentAccountIds: readonly string[];
  readonly expectedAgentIdentityBindings: ReadonlyMap<string, string>;
}

export function parseKemerBetAgentIdentityBindings(value: string): KemerBetAgentIdentityBindings {
  if (value.length < 1 || /\r|\0/u.test(value)) return unavailable();
  const body = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (body.length < 1 || body.endsWith('\n')) return unavailable();
  const lines = body.split('\n');
  if (lines.length < 1 || lines.length > MAXIMUM_AGENT_ACCOUNTS) return unavailable();

  const accountIds: string[] = [];
  const bindings = new Map<string, string>();
  const fingerprints = new Set<string>();
  for (const line of lines) {
    const separator = line.indexOf(' ');
    if (separator < 1 || separator !== line.lastIndexOf(' ')) return unavailable();
    const accountId = line.slice(0, separator);
    const fingerprint = line.slice(separator + 1);
    if (
      !UUID_PATTERN.test(accountId) ||
      accountId === '00000000-0000-0000-0000-000000000000' ||
      !AGENT_IDENTITY_FINGERPRINT_PATTERN.test(fingerprint) ||
      bindings.has(accountId) ||
      fingerprints.has(fingerprint)
    ) {
      return unavailable();
    }
    accountIds.push(accountId);
    bindings.set(accountId, fingerprint);
    fingerprints.add(fingerprint);
  }

  return Object.freeze({
    platformAgentAccountIds: Object.freeze(accountIds),
    expectedAgentIdentityBindings: bindings as ReadonlyMap<string, string>,
  });
}

export async function loadKemerBetAgentIdentityBindings(options: {
  readonly filePath: string;
  readonly fileSystem?: ExecutorIsolationFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<KemerBetAgentIdentityBindings> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const platform = options.platform ?? process.platform;
  const text = await readVerifiedTextFile({
    path: options.filePath,
    maximumBytes: MAXIMUM_BINDING_FILE_BYTES,
    fileSystem,
    platform,
    ...(options.effectiveUserId === undefined ? {} : { effectiveUserId: options.effectiveUserId }),
  });
  return parseKemerBetAgentIdentityBindings(text);
}

export async function loadKemerBetSelectorContract<T>(options: {
  readonly filePath: string;
  readonly validate: (value: unknown) => T;
  readonly fileSystem?: ExecutorIsolationFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<T> {
  const text = await readVerifiedTextFile({
    path: options.filePath,
    maximumBytes: MAXIMUM_SELECTOR_FILE_BYTES,
    fileSystem: options.fileSystem ?? nodeFileSystem,
    platform: options.platform ?? process.platform,
    ...(options.effectiveUserId === undefined ? {} : { effectiveUserId: options.effectiveUserId }),
  });
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    return unavailable();
  }
  try {
    return options.validate(decoded);
  } catch {
    return unavailable();
  }
}

export interface KemerBetNoTransferReadinessPlayers {
  readonly playerIds: readonly string[];
}

/**
 * Parse the one-use private readiness cohort. Player IDs are deliberately returned only to the
 * in-process lookup probe and must never be logged or included in readiness output.
 */
export function parseKemerBetNoTransferReadinessPlayerIds(
  value: string,
): KemerBetNoTransferReadinessPlayers {
  if (value.length < 1 || /\r|\0/u.test(value)) return unavailable();
  const body = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (body.length < 1 || body.endsWith('\n')) return unavailable();
  const playerIds = body.split('\n');
  if (
    playerIds.length !== EXACT_READINESS_PLAYER_COUNT ||
    new Set(playerIds).size !== EXACT_READINESS_PLAYER_COUNT ||
    playerIds.some((playerId) => !PLAYER_ID_PATTERN.test(playerId))
  ) {
    return unavailable();
  }
  return Object.freeze({ playerIds: Object.freeze([...playerIds]) });
}

export async function loadKemerBetNoTransferReadinessPlayerIds(options: {
  readonly filePath: string;
  readonly fileSystem?: ExecutorIsolationFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<KemerBetNoTransferReadinessPlayers> {
  const text = await readVerifiedTextFile({
    path: options.filePath,
    maximumBytes: MAXIMUM_READINESS_PLAYER_IDS_FILE_BYTES,
    fileSystem: options.fileSystem ?? nodeFileSystem,
    platform: options.platform ?? process.platform,
    ...(options.effectiveUserId === undefined ? {} : { effectiveUserId: options.effectiveUserId }),
  });
  return parseKemerBetNoTransferReadinessPlayerIds(text);
}

export async function assertKemerBetBrowserExecutable(options: {
  readonly executablePath: string;
  readonly fileSystem?: ExecutorIsolationFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<void> {
  if (!isAbsolute(options.executablePath) || /\0/u.test(options.executablePath)) {
    return unavailable();
  }
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const platform = options.platform ?? process.platform;
  let handle: ExecutorIsolationFileHandle | null = null;
  try {
    const executorUserId = effectiveUserId(platform, options.effectiveUserId);
    const before = await fileSystem.lstat(options.executablePath);
    if (
      !trustedFileStat(before, platform, executorUserId) ||
      before.size < 1 ||
      !samePath(await fileSystem.realpath(options.executablePath), options.executablePath, platform)
    ) {
      return unavailable();
    }
    handle = await fileSystem.open(
      options.executablePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat();
    if (
      !trustedFileStat(opened, platform, executorUserId) ||
      opened.size < 1 ||
      !sameFile(before, opened)
    ) {
      return unavailable();
    }
    await fileSystem.access(options.executablePath, constants.X_OK);
    const finalPath = await fileSystem.lstat(options.executablePath);
    const finalOpened = await handle.stat();
    if (
      !trustedFileStat(finalPath, platform, executorUserId) ||
      !trustedFileStat(finalOpened, platform, executorUserId) ||
      !sameFile(opened, finalPath) ||
      !sameFile(opened, finalOpened) ||
      !samePath(await fileSystem.realpath(options.executablePath), options.executablePath, platform)
    ) {
      return unavailable();
    }
  } catch {
    return unavailable();
  } finally {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // The executable remains unavailable without exposing its path or metadata.
      }
    }
  }
}
