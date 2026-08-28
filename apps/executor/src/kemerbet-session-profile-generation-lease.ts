import { constants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const MARKER_NAME = '.fetanagent-unclean-session-generation-v1';
const MARKER_CONTENTS = Buffer.from('fetanagent-kemerbet-session-active-v1\n', 'utf8');

interface LeaseStat {
  readonly dev: number | bigint;
  readonly gid: number;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface LeaseHandle {
  close(): Promise<void>;
  readFile(): Promise<Buffer>;
  stat(): Promise<LeaseStat>;
  sync(): Promise<void>;
  writeFile(value: Uint8Array): Promise<void>;
}

export interface KemerBetSessionProfileGenerationLeaseFileSystem {
  lstat(path: string): Promise<LeaseStat>;
  open(path: string, flags: number, mode?: number): Promise<LeaseHandle>;
  realpath(path: string): Promise<string>;
  unlink(path: string): Promise<void>;
}

const productionFileSystem: KemerBetSessionProfileGenerationLeaseFileSystem = {
  lstat,
  open: (path, flags, mode) => open(path, flags, mode),
  realpath,
  unlink,
};

export interface KemerBetSessionProfileGenerationLease {
  /** Remove the crash marker only after the exact browser received a clean profile attestation. */
  releaseAfterCleanCheckpoint(): Promise<void>;
}

export type KemerBetSessionProfileGenerationLeaseInspection =
  | Readonly<{ state: 'clear' }>
  | Readonly<{ reasonCode: 'unclean_session_generation'; state: 'quarantined' }>;

export class KemerBetSessionProfileGenerationLeaseUnavailableError extends Error {
  constructor() {
    super('The KemerBet session profile generation lease is unavailable.');
    this.name = 'KemerBetSessionProfileGenerationLeaseUnavailableError';
  }
}

export class KemerBetSessionProfileGenerationQuarantinedError extends Error {
  readonly reasonCode = 'unclean_session_generation' as const;

  constructor() {
    super('The KemerBet session profile generation is quarantined.');
    this.name = 'KemerBetSessionProfileGenerationQuarantinedError';
  }
}

function unavailable(): never {
  throw new KemerBetSessionProfileGenerationLeaseUnavailableError();
}

function sameIdentity(left: LeaseStat, right: LeaseStat): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.nlink === right.nlink
  );
}

function exactOwnedMarker(stat: LeaseStat, effectiveUserId: number): boolean {
  return (
    stat.isFile() &&
    !stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === effectiveUserId &&
    stat.gid === effectiveUserId &&
    stat.nlink === 1 &&
    (stat.mode & 0o7777) === 0o600
  );
}

function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function requireStableOwnedProfile(
  fileSystem: KemerBetSessionProfileGenerationLeaseFileSystem,
  profilePath: string,
  effectiveUserId: number,
): Promise<void> {
  const before = await fileSystem.lstat(profilePath);
  if (
    !before.isDirectory() ||
    before.isFile() ||
    before.isSymbolicLink() ||
    before.uid !== effectiveUserId ||
    before.gid !== effectiveUserId ||
    (before.mode & 0o7777) !== 0o700 ||
    (await fileSystem.realpath(profilePath)) !== profilePath
  ) {
    unavailable();
  }
  const after = await fileSystem.lstat(profilePath);
  if (!sameIdentity(before, after)) unavailable();
}

async function syncProfileDirectory(
  fileSystem: KemerBetSessionProfileGenerationLeaseFileSystem,
  profilePath: string,
): Promise<void> {
  const directory = await fileSystem.open(
    profilePath,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * Inspect the immutable crash marker without changing it. Only the exact marker installed by this
 * process contract is classified as quarantined; every ambiguous filesystem shape fails closed as
 * unavailable and must not be described more precisely to callers.
 */
export async function inspectKemerBetSessionProfileGenerationLease(
  profilePath: string,
  effectiveUserId: number,
  fileSystem: KemerBetSessionProfileGenerationLeaseFileSystem = productionFileSystem,
): Promise<KemerBetSessionProfileGenerationLeaseInspection> {
  if (!Number.isSafeInteger(effectiveUserId) || effectiveUserId <= 0) unavailable();
  const markerPath = resolve(profilePath, MARKER_NAME);
  if (relative(profilePath, markerPath) !== MARKER_NAME) unavailable();
  try {
    await requireStableOwnedProfile(fileSystem, profilePath, effectiveUserId);
    let pathBefore: LeaseStat;
    try {
      pathBefore = await fileSystem.lstat(markerPath);
    } catch (error) {
      if (!missing(error)) throw error;
      await requireStableOwnedProfile(fileSystem, profilePath, effectiveUserId);
      return Object.freeze({ state: 'clear' });
    }
    if (
      !exactOwnedMarker(pathBefore, effectiveUserId) ||
      pathBefore.size !== MARKER_CONTENTS.byteLength ||
      (await fileSystem.realpath(markerPath)) !== markerPath
    ) {
      unavailable();
    }
    const marker = await fileSystem.open(
      markerPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const handleBefore = await marker.stat();
      if (!sameIdentity(pathBefore, handleBefore)) unavailable();
      const contents = await marker.readFile();
      const handleAfter = await marker.stat();
      if (
        !sameIdentity(handleBefore, handleAfter) ||
        handleAfter.size !== MARKER_CONTENTS.byteLength ||
        !contents.equals(MARKER_CONTENTS)
      ) {
        unavailable();
      }
    } finally {
      await marker.close();
    }
    const pathAfter = await fileSystem.lstat(markerPath);
    if (!sameIdentity(pathBefore, pathAfter)) unavailable();
    await requireStableOwnedProfile(fileSystem, profilePath, effectiveUserId);
    return Object.freeze({ reasonCode: 'unclean_session_generation', state: 'quarantined' });
  } catch (error) {
    if (error instanceof KemerBetSessionProfileGenerationLeaseUnavailableError) throw error;
    return unavailable();
  }
}

/**
 * Atomically install a per-profile crash marker before Chromium exists. Existing markers are never
 * auto-recovered: they mean a previous process did not prove a clean checkpoint, so that immutable
 * profile revision must be retired/resealed rather than silently reused after restart.
 */
export async function acquireKemerBetSessionProfileGenerationLease(
  profilePath: string,
  effectiveUserId: number,
  fileSystem: KemerBetSessionProfileGenerationLeaseFileSystem = productionFileSystem,
): Promise<KemerBetSessionProfileGenerationLease> {
  if (!Number.isSafeInteger(effectiveUserId) || effectiveUserId <= 0) unavailable();
  const markerPath = resolve(profilePath, MARKER_NAME);
  if (relative(profilePath, markerPath) !== MARKER_NAME) unavailable();
  try {
    await requireStableOwnedProfile(fileSystem, profilePath, effectiveUserId);
    const inspection = await inspectKemerBetSessionProfileGenerationLease(
      profilePath,
      effectiveUserId,
      fileSystem,
    );
    if (inspection.state === 'quarantined') {
      throw new KemerBetSessionProfileGenerationQuarantinedError();
    }
    const marker = await fileSystem.open(
      markerPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    let acquiredStat: LeaseStat;
    try {
      acquiredStat = await marker.stat();
      if (!exactOwnedMarker(acquiredStat, effectiveUserId)) unavailable();
      await marker.writeFile(MARKER_CONTENTS);
      await marker.sync();
      const afterWrite = await marker.stat();
      if (!sameIdentity(acquiredStat, afterWrite)) unavailable();
    } finally {
      await marker.close();
    }
    const pathStat = await fileSystem.lstat(markerPath);
    if (
      !sameIdentity(acquiredStat, pathStat) ||
      !exactOwnedMarker(pathStat, effectiveUserId) ||
      (await fileSystem.realpath(markerPath)) !== markerPath
    ) {
      unavailable();
    }
    await syncProfileDirectory(fileSystem, profilePath);
    await requireStableOwnedProfile(fileSystem, profilePath, effectiveUserId);

    let released = false;
    return Object.freeze({
      async releaseAfterCleanCheckpoint(): Promise<void> {
        if (released) return unavailable();
        await requireStableOwnedProfile(fileSystem, profilePath, effectiveUserId);
        const inspection = await inspectKemerBetSessionProfileGenerationLease(
          profilePath,
          effectiveUserId,
          fileSystem,
        );
        if (inspection.state !== 'quarantined') return unavailable();
        const beforeUnlink = await fileSystem.lstat(markerPath);
        if (
          !sameIdentity(acquiredStat, beforeUnlink) ||
          !exactOwnedMarker(beforeUnlink, effectiveUserId) ||
          (await fileSystem.realpath(markerPath)) !== markerPath
        ) {
          return unavailable();
        }
        await fileSystem.unlink(markerPath);
        await syncProfileDirectory(fileSystem, profilePath);
        try {
          await fileSystem.lstat(markerPath);
        } catch (error) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            released = true;
            await requireStableOwnedProfile(fileSystem, profilePath, effectiveUserId);
            return;
          }
        }
        return unavailable();
      },
    });
  } catch (error) {
    if (
      error instanceof KemerBetSessionProfileGenerationLeaseUnavailableError ||
      error instanceof KemerBetSessionProfileGenerationQuarantinedError
    ) {
      throw error;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      const inspection = await inspectKemerBetSessionProfileGenerationLease(
        profilePath,
        effectiveUserId,
        fileSystem,
      );
      if (inspection.state === 'quarantined') {
        throw new KemerBetSessionProfileGenerationQuarantinedError();
      }
    }
    return unavailable();
  }
}

export const KEMERBET_SESSION_PROFILE_GENERATION_LEASE_CONTRACT = Object.freeze({
  markerName: MARKER_NAME,
  markerMode: 0o600,
});
