import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';

export const KEMERBET_READINESS_CONTROLLER_FIREWALL_RELEASE_FILE =
  '/run/secrets/kemerbet_readiness_controller_firewall_release' as const;
export const KEMERBET_READINESS_BROWSER_FIREWALL_RELEASE_FILE =
  '/run/secrets/kemerbet_readiness_browser_firewall_release' as const;
export const KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT =
  'fetanagent-kemerbet-readiness-firewall-v1\n' as const;

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_MS = 50;

interface ReleaseStat {
  readonly dev: number | bigint;
  readonly gid: number;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetReadinessFirewallReleaseFileSystem {
  lstat(path: string): Promise<ReleaseStat>;
  open(path: string, flags: number): Promise<Awaited<ReturnType<typeof open>>>;
  realpath(path: string): Promise<string>;
}

export class KemerBetReadinessFirewallReleaseUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness firewall release boundary is unavailable.');
    this.name = 'KemerBetReadinessFirewallReleaseUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessFirewallReleaseUnavailableError();
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function sameIdentity(left: ReleaseStat, right: ReleaseStat): boolean {
  return (
    left.dev === right.dev &&
    left.gid === right.gid &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid
  );
}

const productionFileSystem: KemerBetReadinessFirewallReleaseFileSystem = {
  lstat: async (path) => (await lstat(path)) as ReleaseStat,
  open,
  realpath,
};

async function requireAbsent(
  fileSystem: KemerBetReadinessFirewallReleaseFileSystem,
  path: string,
): Promise<void> {
  try {
    await fileSystem.lstat(path);
    unavailable();
  } catch (error) {
    if (!isMissing(error)) unavailable();
  }
}

export async function waitForKemerBetReadinessFirewallRelease(options: {
  readonly fileSystem?: KemerBetReadinessFirewallReleaseFileSystem;
  readonly now?: () => number;
  readonly pause?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly role: 'browser' | 'controller';
  readonly timeoutMs?: number;
}): Promise<void> {
  const fileSystem = options.fileSystem ?? productionFileSystem;
  const now = options.now ?? Date.now;
  const pause =
    options.pause ??
    ((milliseconds: number) =>
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 10 ||
    pollIntervalMs > 1_000 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 60_000
  ) {
    unavailable();
  }
  const path =
    options.role === 'controller'
      ? KEMERBET_READINESS_CONTROLLER_FIREWALL_RELEASE_FILE
      : KEMERBET_READINESS_BROWSER_FIREWALL_RELEASE_FILE;
  const forbiddenPath =
    options.role === 'controller'
      ? KEMERBET_READINESS_BROWSER_FIREWALL_RELEASE_FILE
      : KEMERBET_READINESS_CONTROLLER_FIREWALL_RELEASE_FILE;
  await requireAbsent(fileSystem, forbiddenPath);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await fileSystem.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const initialHandle = (await handle.stat()) as ReleaseStat;
    const initialPath = await fileSystem.lstat(path);
    if (
      !initialHandle.isFile() ||
      initialHandle.isSymbolicLink() ||
      !initialPath.isFile() ||
      initialPath.isSymbolicLink() ||
      !sameIdentity(initialHandle, initialPath) ||
      initialHandle.uid !== 0 ||
      initialHandle.gid !== 0 ||
      (initialHandle.mode & 0o777) !== 0o444 ||
      initialHandle.nlink !== 1 ||
      (initialHandle.size !== 0 &&
        initialHandle.size !== Buffer.byteLength(KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT)) ||
      (await fileSystem.realpath(path)) !== path
    ) {
      unavailable();
    }
    const startedAt = now();
    const deadline = startedAt + timeoutMs;
    if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(deadline)) unavailable();
    while (now() < deadline) {
      await requireAbsent(fileSystem, forbiddenPath);
      const currentHandle = (await handle.stat()) as ReleaseStat;
      const currentPath = await fileSystem.lstat(path);
      if (
        !currentHandle.isFile() ||
        currentHandle.isSymbolicLink() ||
        !currentPath.isFile() ||
        currentPath.isSymbolicLink() ||
        !sameIdentity(initialHandle, currentHandle) ||
        !sameIdentity(currentHandle, currentPath) ||
        (await fileSystem.realpath(path)) !== path
      ) {
        unavailable();
      }
      if (currentHandle.size === 0) {
        await pause(pollIntervalMs);
        continue;
      }
      const expected = Buffer.from(KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT, 'utf8');
      if (currentHandle.size !== expected.length) unavailable();
      const observed = Buffer.alloc(expected.length);
      const { bytesRead } = await handle.read(observed, 0, observed.length, 0);
      const finalHandle = (await handle.stat()) as ReleaseStat;
      const finalPath = await fileSystem.lstat(path);
      const exact =
        bytesRead === expected.length &&
        observed.equals(expected) &&
        sameIdentity(initialHandle, finalHandle) &&
        sameIdentity(finalHandle, finalPath) &&
        finalHandle.size === expected.length &&
        finalPath.size === expected.length;
      observed.fill(0);
      expected.fill(0);
      if (!exact) unavailable();
      return;
    }
    unavailable();
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export const KEMERBET_READINESS_FIREWALL_RELEASE_CONTRACT = Object.freeze({
  browserFile: KEMERBET_READINESS_BROWSER_FIREWALL_RELEASE_FILE,
  content: KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT,
  controllerFile: KEMERBET_READINESS_CONTROLLER_FIREWALL_RELEASE_FILE,
  maximumWaitMs: 60_000,
});
