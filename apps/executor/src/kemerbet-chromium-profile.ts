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

const productionServiceWorkerFileSystem: KemerBetServiceWorkerPurgeFileSystem = {
  lstat: async (path) => (await lstat(path)) as ServiceWorkerStat,
  open,
  readdir: async (path) => readdir(path),
  realpath,
  rename,
  rmdir,
  unlink,
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
