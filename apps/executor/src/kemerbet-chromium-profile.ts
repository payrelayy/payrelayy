import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const CHROMIUM_SINGLETON_ARTIFACTS = Object.freeze([
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
] as const);

export interface KemerBetSingletonArtifactFileSystem {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  unlink(path: string): Promise<void>;
}

interface ServiceWorkerStat {
  readonly gid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly uid: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface CleanExitStat {
  readonly ctimeMs: number;
  readonly dev: number;
  readonly gid: number;
  readonly ino: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetCleanExitFileHandle {
  close(): Promise<void>;
  readFile(): Promise<Buffer>;
  stat(): Promise<CleanExitStat>;
}

export interface KemerBetCleanExitFileSystem {
  lstat(path: string): Promise<CleanExitStat>;
  open(path: string, flags: number): Promise<KemerBetCleanExitFileHandle>;
  realpath(path: string): Promise<string>;
}

export interface KemerBetServiceWorkerPurgeFileSystem {
  lstat(path: string): Promise<ServiceWorkerStat>;
  open(path: string, flags: number): Promise<Awaited<ReturnType<typeof open>>>;
  readdir(path: string): Promise<string[]>;
  realpath(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export class KemerBetChromiumProfileUnavailableError extends Error {
  constructor() {
    super('The private KemerBet Chromium profile boundary is unavailable.');
    this.name = 'KemerBetChromiumProfileUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetChromiumProfileUnavailableError();
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === expectedCode
  );
}

/**
 * A force-stopped Chromium process can leave these three profile-owner symlinks behind. A newly
 * started, isolated session container has no inherited Chromium process, so removing only these
 * exact symlinks once per profile restores the persistent profile without touching KemerBet data.
 */
export async function removeStaleChromiumSingletonArtifacts(
  profilePath: string,
  fileSystem: KemerBetSingletonArtifactFileSystem = { lstat, unlink },
): Promise<void> {
  for (const artifact of CHROMIUM_SINGLETON_ARTIFACTS) {
    const artifactPath = resolve(profilePath, artifact);
    if (relative(profilePath, artifactPath) !== artifact) unavailable();
    try {
      const stat = await fileSystem.lstat(artifactPath);
      if (!stat.isSymbolicLink()) unavailable();
      await fileSystem.unlink(artifactPath);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) unavailable();
    }
  }
}

const SERVICE_WORKER_DIRECTORY = 'Service Worker';
const SERVICE_WORKER_TOMBSTONE = '.Service Worker.fetanagent-purge-v1';
const CHROMIUM_PREFERENCES_FILE = 'Preferences';
const CHROMIUM_PREFERENCES_MAX_BYTES = 4 * 1_024 * 1_024;

const productionServiceWorkerFileSystem: KemerBetServiceWorkerPurgeFileSystem = {
  lstat: async (path) => (await lstat(path)) as ServiceWorkerStat,
  open,
  readdir: async (path) => readdir(path),
  realpath,
  rename,
  rmdir,
  unlink,
};

const productionCleanExitFileSystem: KemerBetCleanExitFileSystem = {
  lstat: async (path) => (await lstat(path)) as CleanExitStat,
  open: async (path, flags) => (await open(path, flags)) as KemerBetCleanExitFileHandle,
  realpath,
};

async function pathState(
  fileSystem: KemerBetServiceWorkerPurgeFileSystem,
  path: string,
): Promise<'absent' | 'present'> {
  try {
    await fileSystem.lstat(path);
    return 'present';
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return 'absent';
    return unavailable();
  }
}

function exactChild(parent: string, name: string): string {
  const child = resolve(parent, name);
  if (relative(parent, child) !== name || name === '.' || name === '..') unavailable();
  return child;
}

function exactStableStat(before: CleanExitStat, after: CleanExitStat): boolean {
  return (
    before.ctimeMs === after.ctimeMs &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.uid === after.uid &&
    before.gid === after.gid &&
    before.mode === after.mode &&
    before.mtimeMs === after.mtimeMs &&
    before.nlink === after.nlink &&
    before.size === after.size &&
    before.isDirectory() === after.isDirectory() &&
    before.isFile() === after.isFile() &&
    before.isSymbolicLink() === after.isSymbolicLink()
  );
}

async function requireStableOwnedDirectory(
  fileSystem: KemerBetCleanExitFileSystem,
  path: string,
  effectiveUserId: number,
): Promise<void> {
  const before = await fileSystem.lstat(path);
  if (
    !before.isDirectory() ||
    before.isFile() ||
    before.isSymbolicLink() ||
    before.uid !== effectiveUserId ||
    before.gid !== effectiveUserId ||
    (before.mode & 0o7777) !== 0o700 ||
    (await fileSystem.realpath(path)) !== path
  ) {
    unavailable();
  }
  const after = await fileSystem.lstat(path);
  if (!exactStableStat(before, after)) unavailable();
}

/**
 * Prove that Chromium completed an orderly profile shutdown without reading any provider session
 * material. Playwright can resolve a persistent-context close after its own graceful-close timeout
 * force-kills Chromium, so process disconnection alone is not a sufficient checkpoint. This
 * attestor is deliberately read-only and accepts only Chromium's own `Normal` exit marker.
 */
export async function assertKemerBetChromiumProfileCleanlyClosed(
  profilePath: string,
  effectiveUserId: number,
  fileSystem: KemerBetCleanExitFileSystem = productionCleanExitFileSystem,
): Promise<void> {
  if (!Number.isSafeInteger(effectiveUserId) || effectiveUserId <= 0) unavailable();
  try {
    await requireStableOwnedDirectory(fileSystem, profilePath, effectiveUserId);
    const defaultRoot = exactChild(profilePath, 'Default');
    await requireStableOwnedDirectory(fileSystem, defaultRoot, effectiveUserId);

    for (const singleton of CHROMIUM_SINGLETON_ARTIFACTS) {
      const singletonPath = exactChild(profilePath, singleton);
      try {
        await fileSystem.lstat(singletonPath);
        unavailable();
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) unavailable();
      }
    }

    const preferencesPath = exactChild(defaultRoot, CHROMIUM_PREFERENCES_FILE);
    const pathBefore = await fileSystem.lstat(preferencesPath);
    if (
      !pathBefore.isFile() ||
      pathBefore.isDirectory() ||
      pathBefore.isSymbolicLink() ||
      pathBefore.uid !== effectiveUserId ||
      pathBefore.gid !== effectiveUserId ||
      pathBefore.nlink !== 1 ||
      (pathBefore.mode & 0o7777) !== 0o600 ||
      pathBefore.size < 2 ||
      pathBefore.size > CHROMIUM_PREFERENCES_MAX_BYTES ||
      (await fileSystem.realpath(preferencesPath)) !== preferencesPath
    ) {
      unavailable();
    }

    let handle: KemerBetCleanExitFileHandle | null = null;
    let contents: Buffer | null = null;
    let openedAfterRead: CleanExitStat | null = null;
    try {
      handle = await fileSystem.open(
        preferencesPath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const opened = await handle.stat();
      if (!exactStableStat(pathBefore, opened)) unavailable();
      contents = await handle.readFile();
      openedAfterRead = await handle.stat();
      const pathAfterRead = await fileSystem.lstat(preferencesPath);
      if (
        !exactStableStat(opened, openedAfterRead) ||
        !exactStableStat(openedAfterRead, pathAfterRead) ||
        contents.byteLength !== openedAfterRead.size
      ) {
        unavailable();
      }

      const parsed = JSON.parse(contents.toString('utf8')) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) unavailable();
      const profile = (parsed as Record<string, unknown>).profile;
      if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) unavailable();
      const profileObject = profile as Record<string, unknown>;
      if (
        profileObject.exit_type !== 'Normal' ||
        (profileObject.exited_cleanly !== undefined && profileObject.exited_cleanly !== true)
      ) {
        unavailable();
      }
    } finally {
      contents?.fill(0);
      await handle?.close();
    }

    if (openedAfterRead === null) unavailable();
    const pathAfterClose = await fileSystem.lstat(preferencesPath);
    if (
      !exactStableStat(openedAfterRead, pathAfterClose) ||
      (await fileSystem.realpath(preferencesPath)) !== preferencesPath
    ) {
      unavailable();
    }

    await requireStableOwnedDirectory(fileSystem, defaultRoot, effectiveUserId);
    await requireStableOwnedDirectory(fileSystem, profilePath, effectiveUserId);
  } catch {
    return unavailable();
  }
}

async function syncDirectory(
  fileSystem: KemerBetServiceWorkerPurgeFileSystem,
  path: string,
): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await fileSystem.open(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    await handle.sync();
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function removeExactOwnedTree(
  fileSystem: KemerBetServiceWorkerPurgeFileSystem,
  root: string,
  path: string,
  effectiveUserId: number,
): Promise<void> {
  if (path !== root && !relative(root, path).match(/^(?!\.\.)(?!.*[\\/](?:\.\.|\.)[\\/]).+/u)) {
    unavailable();
  }
  const stat = await fileSystem.lstat(path).catch(() => unavailable());
  if (stat.isSymbolicLink() || stat.uid !== effectiveUserId || stat.gid !== effectiveUserId) {
    unavailable();
  }
  if (stat.isFile()) {
    if (stat.nlink !== 1) unavailable();
    await fileSystem.unlink(path).catch(() => unavailable());
    return;
  }
  if (
    !stat.isDirectory() ||
    (await fileSystem.realpath(path).catch(() => unavailable())) !== path
  ) {
    unavailable();
  }
  const entries = await fileSystem.readdir(path).catch(() => unavailable());
  if (entries.length > 100_000 || new Set(entries).size !== entries.length) unavailable();
  for (const entry of entries.sort()) {
    if (entry.length < 1 || entry.length > 255 || entry.includes('/') || entry.includes('\\')) {
      unavailable();
    }
    await removeExactOwnedTree(fileSystem, root, exactChild(path, entry), effectiveUserId);
  }
  await fileSystem.rmdir(path).catch(() => unavailable());
}

/**
 * Before Chromium exists, atomically isolate and remove only Default/Service Worker. The fixed
 * same-directory tombstone makes a crash after rename safely resumable without broad profile
 * deletion. Symlinks, hard-linked files, ownership drift, or ambiguous live+tombstone state fail
 * closed.
 */
export async function purgeKemerBetPersistedServiceWorkerState(
  profilePath: string,
  effectiveUserId: number,
  fileSystem: KemerBetServiceWorkerPurgeFileSystem = productionServiceWorkerFileSystem,
): Promise<void> {
  if (!Number.isSafeInteger(effectiveUserId) || effectiveUserId <= 0) unavailable();
  const defaultRoot = exactChild(profilePath, 'Default');
  const live = exactChild(defaultRoot, SERVICE_WORKER_DIRECTORY);
  const tombstone = exactChild(defaultRoot, SERVICE_WORKER_TOMBSTONE);
  try {
    const defaultStat = await fileSystem.lstat(defaultRoot);
    if (
      !defaultStat.isDirectory() ||
      defaultStat.isSymbolicLink() ||
      defaultStat.uid !== effectiveUserId ||
      defaultStat.gid !== effectiveUserId ||
      (await fileSystem.realpath(defaultRoot)) !== defaultRoot
    ) {
      unavailable();
    }
    const [liveState, tombstoneState] = await Promise.all([
      pathState(fileSystem, live),
      pathState(fileSystem, tombstone),
    ]);
    if (liveState === 'present' && tombstoneState === 'present') unavailable();
    if (tombstoneState === 'present') {
      await removeExactOwnedTree(fileSystem, tombstone, tombstone, effectiveUserId);
      await syncDirectory(fileSystem, defaultRoot);
      return;
    }
    if (liveState === 'absent') return;
    const liveStat = await fileSystem.lstat(live);
    if (
      !liveStat.isDirectory() ||
      liveStat.isSymbolicLink() ||
      liveStat.uid !== effectiveUserId ||
      liveStat.gid !== effectiveUserId ||
      (await fileSystem.realpath(live)) !== live
    ) {
      unavailable();
    }
    await fileSystem.rename(live, tombstone);
    await syncDirectory(fileSystem, defaultRoot);
    await removeExactOwnedTree(fileSystem, tombstone, tombstone, effectiveUserId);
    await syncDirectory(fileSystem, defaultRoot);
    if ((await pathState(fileSystem, live)) !== 'absent') unavailable();
    if ((await pathState(fileSystem, tombstone)) !== 'absent') unavailable();
  } catch {
    return unavailable();
  }
}

export const KEMERBET_SERVICE_WORKER_PURGE_CONTRACT = Object.freeze({
  directory: SERVICE_WORKER_DIRECTORY,
  tombstone: SERVICE_WORKER_TOMBSTONE,
});
