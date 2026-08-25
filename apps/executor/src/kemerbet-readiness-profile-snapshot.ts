import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_USER_ID = 0;
const SOURCE_ROOT = '/run/source';
const SNAPSHOT_ROOT = '/run/snapshot';
const OUTPUT_ROOT = '/run/output';
const ACCOUNT_ID_FILE = '/run/secrets/kemerbet_readiness_account_id';
const MANIFEST_FILE = `${OUTPUT_ROOT}/profile-manifest`;
const MANIFEST_INSTALLING_FILE = `${OUTPUT_ROOT}/.profile-manifest.installing`;
const MANIFEST_CONTRACT = 'fetanagent-kemerbet-readiness-profile-snapshot-v1';
const TREE_DIGEST_DOMAIN = 'fetanagent-kemerbet-readiness-profile-tree-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_TREE_ENTRIES = 200_000;
const MAXIMUM_ACCOUNT_ID_BYTES = 37;
const MAXIMUM_PROFILE_FILE_BYTES = 256 * 1024 * 1024;
const MAXIMUM_PROFILE_TREE_BYTES = 1024 * 1024 * 1024;
const STALE_CHROMIUM_SINGLETON_NAMES: ReadonlySet<string> = new Set([
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
]);

export const KEMERBET_READINESS_PROFILE_SNAPSHOT_LIMITS = Object.freeze({
  maximumFileBytes: MAXIMUM_PROFILE_FILE_BYTES,
  maximumTreeBytes: MAXIMUM_PROFILE_TREE_BYTES,
});

interface SnapshotStat {
  readonly ctimeMs: number;
  readonly dev: number | bigint;
  readonly gid: number;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isDirectory(): boolean;
  isFIFO(): boolean;
  isFile(): boolean;
  isSocket(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetReadinessProfileTreeRecord {
  readonly contentSha256: string | null;
  readonly gid: number;
  readonly mode: number;
  readonly relativePath: string;
  readonly size: number;
  readonly type: 'directory' | 'file';
  readonly uid: number;
}

export interface KemerBetReadinessProfileManifest {
  readonly accountIdSha256: string;
  readonly contract: typeof MANIFEST_CONTRACT;
  readonly directoryCount: number;
  readonly fileCount: number;
  readonly treeSha256: string;
  readonly version: 1;
}

export interface KemerBetReadinessProfileSnapshotDependencies {
  readonly assertMountContract?: (mode: 'snapshot' | 'verify' | 'verify-original') => Promise<void>;
  readonly assertOfflineNetwork?: () => void;
  readonly effectiveGroupId?: number;
  readonly effectiveUserId?: number;
  readonly loadAccountId?: () => Promise<string>;
  readonly snapshot?: (accountId: string) => Promise<void>;
  readonly verify?: (accountId: string) => Promise<void>;
  readonly verifyOriginal?: (accountId: string) => Promise<void>;
}

export class KemerBetReadinessProfileSnapshotUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness profile snapshot is unavailable.');
    this.name = 'KemerBetReadinessProfileSnapshotUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessProfileSnapshotUnavailableError();
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function sameStat(left: SnapshotStat, right: SnapshotStat): boolean {
  return (
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.gid === right.gid &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid
  );
}

function isOnlyDirectoryOrFile(stat: SnapshotStat): boolean {
  return (
    !stat.isSymbolicLink() &&
    !stat.isBlockDevice() &&
    !stat.isCharacterDevice() &&
    !stat.isFIFO() &&
    !stat.isSocket() &&
    (stat.isDirectory() || stat.isFile())
  );
}

function safeRelativePath(root: string, path: string): string {
  const value = relative(root, path);
  if (isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`) || value.includes('\0')) {
    return unavailable();
  }
  return value.split(sep).join('/');
}

function updateLengthPrefixed(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

/** Deterministic aggregate tree digest; individual paths never appear in the manifest. */
export function createKemerBetReadinessProfileTreeDigest(
  records: readonly KemerBetReadinessProfileTreeRecord[],
): string {
  if (records.length < 1 || records.length > MAXIMUM_TREE_ENTRIES) return unavailable();
  const ordered = [...records].sort((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath, 'utf8'), Buffer.from(right.relativePath, 'utf8')),
  );
  if (new Set(ordered.map(({ relativePath }) => relativePath)).size !== ordered.length) {
    return unavailable();
  }
  const hash = createHash('sha256');
  let totalFileBytes = 0;
  hash.update(`${TREE_DIGEST_DOMAIN}\0`, 'utf8');
  for (const record of ordered) {
    if (
      record.relativePath.includes('\0') ||
      record.relativePath.startsWith('/') ||
      record.relativePath.split('/').some((part) => part === '..') ||
      !Number.isSafeInteger(record.uid) ||
      record.uid < 0 ||
      !Number.isSafeInteger(record.gid) ||
      record.gid < 0 ||
      !Number.isSafeInteger(record.mode) ||
      record.mode < 0 ||
      !Number.isSafeInteger(record.size) ||
      record.size < 0 ||
      (record.type === 'file' && record.size > MAXIMUM_PROFILE_FILE_BYTES) ||
      (record.type === 'file' && totalFileBytes > MAXIMUM_PROFILE_TREE_BYTES - record.size) ||
      (record.type === 'file' && !SHA256_PATTERN.test(record.contentSha256 ?? '')) ||
      (record.type === 'directory' && (record.contentSha256 !== null || record.size !== 0))
    ) {
      return unavailable();
    }
    if (record.type === 'file') totalFileBytes += record.size;
    hash.update(record.type === 'directory' ? 'D' : 'F', 'utf8');
    updateLengthPrefixed(hash, record.relativePath);
    updateLengthPrefixed(
      hash,
      `${record.uid}:${record.gid}:${record.mode & 0o7777}:${record.size}:${record.contentSha256 ?? ''}`,
    );
  }
  return hash.digest('hex');
}

export function serializeKemerBetReadinessProfileManifest(
  manifest: KemerBetReadinessProfileManifest,
): string {
  if (
    manifest.contract !== MANIFEST_CONTRACT ||
    manifest.version !== 1 ||
    !SHA256_PATTERN.test(manifest.accountIdSha256) ||
    !SHA256_PATTERN.test(manifest.treeSha256) ||
    !Number.isSafeInteger(manifest.directoryCount) ||
    manifest.directoryCount < 1 ||
    !Number.isSafeInteger(manifest.fileCount) ||
    manifest.fileCount < 0 ||
    manifest.directoryCount + manifest.fileCount > MAXIMUM_TREE_ENTRIES
  ) {
    return unavailable();
  }
  return `${JSON.stringify({
    accountIdSha256: manifest.accountIdSha256,
    contract: MANIFEST_CONTRACT,
    directoryCount: manifest.directoryCount,
    fileCount: manifest.fileCount,
    treeSha256: manifest.treeSha256,
    version: 1,
  })}\n`;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const observed = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    observed.length === expected.length && observed.every((key, index) => key === expected[index])
  );
}

export function parseKemerBetReadinessProfileManifest(
  serialized: string,
): KemerBetReadinessProfileManifest {
  if (!serialized.endsWith('\n') || serialized.includes('\r') || serialized.includes('\0')) {
    return unavailable();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized.slice(0, -1)) as unknown;
  } catch {
    return unavailable();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return unavailable();
  const value = parsed as Record<string, unknown>;
  if (
    !exactKeys(value, [
      'accountIdSha256',
      'contract',
      'directoryCount',
      'fileCount',
      'treeSha256',
      'version',
    ]) ||
    value.contract !== MANIFEST_CONTRACT ||
    value.version !== 1 ||
    typeof value.accountIdSha256 !== 'string' ||
    typeof value.treeSha256 !== 'string' ||
    typeof value.directoryCount !== 'number' ||
    typeof value.fileCount !== 'number'
  ) {
    return unavailable();
  }
  const manifest = Object.freeze({
    accountIdSha256: value.accountIdSha256,
    contract: MANIFEST_CONTRACT,
    directoryCount: value.directoryCount,
    fileCount: value.fileCount,
    treeSha256: value.treeSha256,
    version: 1 as const,
  });
  if (serializeKemerBetReadinessProfileManifest(manifest) !== serialized) return unavailable();
  return manifest;
}

function decodeMountPath(value: string): string {
  return value.replace(/\\(040|011|012|134)/gu, (_match, code: string) => {
    if (code === '040') return ' ';
    if (code === '011') return '\t';
    if (code === '012') return '\n';
    return '\\';
  });
}

export function assertKemerBetReadinessProfileMountInfo(
  mountInfo: string,
  mode: 'snapshot' | 'verify' | 'verify-original' = 'snapshot',
): void {
  const options = new Map<string, Set<string>>();
  for (const line of mountInfo.split('\n')) {
    if (line === '') continue;
    const fields = line.split(' ');
    if (fields.length < 7) return unavailable();
    const mountPoint = decodeMountPath(fields[4] ?? '');
    options.set(mountPoint, new Set((fields[5] ?? '').split(',')));
  }
  const source = options.get(SOURCE_ROOT);
  const snapshot = options.get(SNAPSHOT_ROOT);
  const output = options.get(OUTPUT_ROOT);
  if (
    source === undefined ||
    !source.has('ro') ||
    source.has('rw') ||
    (mode === 'snapshot' &&
      (snapshot === undefined ||
        !snapshot.has('rw') ||
        snapshot.has('ro') ||
        output === undefined ||
        !output.has('rw') ||
        output.has('ro'))) ||
    ((mode === 'verify' || mode === 'verify-original') &&
      (snapshot !== undefined || output === undefined || !output.has('ro') || output.has('rw')))
  ) {
    return unavailable();
  }
}

async function requireDirectory(
  path: string,
  options: { readonly empty?: boolean; readonly mode?: number; readonly rootOwned?: boolean },
): Promise<void> {
  const before = (await lstat(path)) as SnapshotStat;
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    (options.rootOwned === true && (before.uid !== 0 || before.gid !== 0)) ||
    (options.mode !== undefined && (before.mode & 0o777) !== options.mode) ||
    (before.mode & 0o022) !== 0 ||
    (await realpath(path)) !== path
  ) {
    return unavailable();
  }
  if (options.empty === true && (await readdir(path)).length !== 0) return unavailable();
  if (!sameStat(before, (await lstat(path)) as SnapshotStat)) return unavailable();
}

async function assertProductionMountContract(
  mode: 'snapshot' | 'verify' | 'verify-original',
): Promise<void> {
  const before = await readFile('/proc/self/mountinfo', 'utf8');
  assertKemerBetReadinessProfileMountInfo(before, mode);
  await requireDirectory(SOURCE_ROOT, {});
  if (mode === 'snapshot') {
    await requireDirectory(SNAPSHOT_ROOT, { empty: true, mode: 0o700, rootOwned: true });
  } else {
    try {
      await lstat(SNAPSHOT_ROOT);
      return unavailable();
    } catch (error) {
      if (!isMissing(error)) return unavailable();
    }
  }
  await requireDirectory(OUTPUT_ROOT, { mode: 0o700, rootOwned: true });
  const after = await readFile('/proc/self/mountinfo', 'utf8');
  if (before !== after) return unavailable();
}

function assertNoNetworkInterfaces(): void {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (name !== 'lo' && (addresses ?? []).some((address) => !address.internal)) unavailable();
  }
}

async function loadAccountId(): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(ACCOUNT_ID_FILE, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = (await handle.stat()) as SnapshotStat;
    const pathBefore = (await lstat(ACCOUNT_ID_FILE)) as SnapshotStat;
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      !sameStat(before, pathBefore) ||
      before.uid !== 0 ||
      before.gid !== 0 ||
      (before.mode & 0o777) !== 0o400 ||
      before.nlink !== 1 ||
      before.size !== MAXIMUM_ACCOUNT_ID_BYTES ||
      (await realpath(ACCOUNT_ID_FILE)) !== ACCOUNT_ID_FILE
    ) {
      return unavailable();
    }
    const serialized = await handle.readFile({ encoding: 'utf8' });
    const after = (await handle.stat()) as SnapshotStat;
    const pathAfter = (await lstat(ACCOUNT_ID_FILE)) as SnapshotStat;
    if (
      !sameStat(before, after) ||
      !sameStat(after, pathAfter) ||
      Buffer.byteLength(serialized, 'utf8') !== MAXIMUM_ACCOUNT_ID_BYTES ||
      !UUID_PATTERN.test(serialized.slice(0, -1)) ||
      serialized.at(-1) !== '\n'
    ) {
      return unavailable();
    }
    return serialized.slice(0, -1);
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function hashKemerBetReadinessProfileOpenedFile(
  source: Awaited<ReturnType<typeof open>>,
  destination: Awaited<ReturnType<typeof open>> | null,
  maximumBytes = MAXIMUM_PROFILE_FILE_BYTES,
): Promise<{ readonly bytes: number; readonly digest: string }> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) return unavailable();
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  try {
    while (true) {
      const remaining = maximumBytes - position;
      const readLength = Math.min(buffer.length, remaining + 1);
      const { bytesRead } = await source.read(buffer, 0, readLength, position);
      if (bytesRead === 0) break;
      if (bytesRead > remaining) return unavailable();
      hash.update(buffer.subarray(0, bytesRead));
      if (destination !== null) {
        let written = 0;
        while (written < bytesRead) {
          const result = await destination.write(
            buffer,
            written,
            bytesRead - written,
            position + written,
          );
          if (result.bytesWritten < 1 || result.bytesWritten > bytesRead - written) {
            return unavailable();
          }
          written += result.bytesWritten;
        }
      }
      position += bytesRead;
    }
    return Object.freeze({ bytes: position, digest: hash.digest('hex') });
  } finally {
    buffer.fill(0);
  }
}

function safeMode(stat: SnapshotStat): number {
  return stat.mode & 0o7777;
}

export async function inspectTree(options: {
  readonly copyToRoot?: string;
  readonly ignoreTopLevelChromiumSingletonSymlinks?: boolean;
  readonly root: string;
}): Promise<readonly KemerBetReadinessProfileTreeRecord[]> {
  const records: KemerBetReadinessProfileTreeRecord[] = [];
  let logicalFileBytes = 0;
  let readFileBytes = 0;
  const visit = async (sourcePath: string, destinationPath: string | null): Promise<void> => {
    if (records.length >= MAXIMUM_TREE_ENTRIES) return unavailable();
    const relativePath = safeRelativePath(options.root, sourcePath);
    const before = (await lstat(sourcePath)) as SnapshotStat;
    if (!relativePath.includes('/') && STALE_CHROMIUM_SINGLETON_NAMES.has(relativePath)) {
      if (options.ignoreTopLevelChromiumSingletonSymlinks !== true || !before.isSymbolicLink()) {
        return unavailable();
      }
      const after = (await lstat(sourcePath)) as SnapshotStat;
      if (!after.isSymbolicLink() || !sameStat(before, after)) return unavailable();
      return;
    }
    if (!isOnlyDirectoryOrFile(before) || (await realpath(sourcePath)) !== sourcePath) {
      return unavailable();
    }
    if (before.isFile()) {
      if (
        before.nlink !== 1 ||
        (destinationPath === null) !== (options.copyToRoot === undefined) ||
        !Number.isSafeInteger(before.size) ||
        before.size < 0 ||
        before.size > MAXIMUM_PROFILE_FILE_BYTES ||
        logicalFileBytes > MAXIMUM_PROFILE_TREE_BYTES - before.size
      ) {
        return unavailable();
      }
      logicalFileBytes += before.size;
      let source: Awaited<ReturnType<typeof open>> | null = null;
      let destination: Awaited<ReturnType<typeof open>> | null = null;
      try {
        source = await open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        if (!sameStat(before, (await source.stat()) as SnapshotStat)) return unavailable();
        if (destinationPath !== null) {
          destination = await open(
            destinationPath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
            0o600,
          );
        }
        const hashed = await hashKemerBetReadinessProfileOpenedFile(
          source,
          destination,
          Math.min(MAXIMUM_PROFILE_FILE_BYTES, MAXIMUM_PROFILE_TREE_BYTES - readFileBytes),
        );
        readFileBytes += hashed.bytes;
        const after = (await source.stat()) as SnapshotStat;
        if (
          readFileBytes > MAXIMUM_PROFILE_TREE_BYTES ||
          !sameStat(before, after) ||
          !sameStat(after, (await lstat(sourcePath)) as SnapshotStat) ||
          hashed.bytes !== before.size
        ) {
          return unavailable();
        }
        if (destination !== null && destinationPath !== null) {
          await destination.sync();
          await destination.chown(before.uid, before.gid);
          await destination.chmod(safeMode(before));
          const copied = (await destination.stat()) as SnapshotStat;
          if (
            !copied.isFile() ||
            copied.isSymbolicLink() ||
            copied.nlink !== 1 ||
            copied.size !== before.size ||
            copied.uid !== before.uid ||
            copied.gid !== before.gid ||
            safeMode(copied) !== safeMode(before) ||
            (await realpath(destinationPath)) !== destinationPath
          ) {
            return unavailable();
          }
        }
        records.push(
          Object.freeze({
            contentSha256: hashed.digest,
            gid: before.gid,
            mode: safeMode(before),
            relativePath,
            size: before.size,
            type: 'file' as const,
            uid: before.uid,
          }),
        );
      } finally {
        await destination?.close().catch(() => undefined);
        await source?.close().catch(() => undefined);
      }
      return;
    }

    if (destinationPath !== null) {
      await mkdir(destinationPath, { mode: 0o700 });
      const created = (await lstat(destinationPath)) as SnapshotStat;
      if (!created.isDirectory() || created.isSymbolicLink()) return unavailable();
    }
    const names = await readdir(sourcePath);
    names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    if (new Set(names).size !== names.length) return unavailable();
    for (const name of names) {
      if (
        name === '' ||
        name === '.' ||
        name === '..' ||
        name.includes('/') ||
        name.includes('\0')
      ) {
        return unavailable();
      }
      const childSource = resolve(sourcePath, name);
      if (safeRelativePath(options.root, childSource) === '') return unavailable();
      const childDestination = destinationPath === null ? null : resolve(destinationPath, name);
      if (childDestination !== null && options.copyToRoot !== undefined) {
        safeRelativePath(options.copyToRoot, childDestination);
      }
      await visit(childSource, childDestination);
    }
    if (!sameStat(before, (await lstat(sourcePath)) as SnapshotStat)) return unavailable();
    if (destinationPath !== null) {
      const directory = await open(
        destinationPath,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
      );
      try {
        await directory.chown(before.uid, before.gid);
        await directory.chmod(safeMode(before));
        await directory.sync();
      } finally {
        await directory.close();
      }
      const copied = (await lstat(destinationPath)) as SnapshotStat;
      if (
        !copied.isDirectory() ||
        copied.isSymbolicLink() ||
        copied.uid !== before.uid ||
        copied.gid !== before.gid ||
        safeMode(copied) !== safeMode(before) ||
        (await realpath(destinationPath)) !== destinationPath
      ) {
        return unavailable();
      }
    }
    records.push(
      Object.freeze({
        contentSha256: null,
        gid: before.gid,
        mode: safeMode(before),
        relativePath,
        size: 0,
        type: 'directory' as const,
        uid: before.uid,
      }),
    );
  };

  const rootDestination =
    options.copyToRoot === undefined ? null : join(options.copyToRoot, basename(options.root));
  await visit(options.root, rootDestination);
  return Object.freeze(records);
}

function summarize(accountId: string, records: readonly KemerBetReadinessProfileTreeRecord[]) {
  return Object.freeze({
    accountIdSha256: createHash('sha256').update(accountId, 'utf8').digest('hex'),
    contract: MANIFEST_CONTRACT,
    directoryCount: records.filter(({ type }) => type === 'directory').length,
    fileCount: records.filter(({ type }) => type === 'file').length,
    treeSha256: createKemerBetReadinessProfileTreeDigest(records),
    version: 1 as const,
  });
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    return unavailable();
  } catch (error) {
    if (!isMissing(error)) return unavailable();
  }
}

async function writeManifest(manifest: KemerBetReadinessProfileManifest): Promise<void> {
  const serialized = serializeKemerBetReadinessProfileManifest(manifest);
  await requireAbsent(MANIFEST_FILE);
  await requireAbsent(MANIFEST_INSTALLING_FILE);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let renamed = false;
  let complete = false;
  try {
    handle = await open(
      MANIFEST_INSTALLING_FILE,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.chmod(0o400);
    const written = (await handle.stat()) as SnapshotStat;
    if (
      !written.isFile() ||
      written.isSymbolicLink() ||
      written.uid !== 0 ||
      written.gid !== 0 ||
      (written.mode & 0o777) !== 0o400 ||
      written.nlink !== 1 ||
      written.size !== Buffer.byteLength(serialized, 'utf8')
    ) {
      return unavailable();
    }
    await handle.close();
    handle = null;
    await requireAbsent(MANIFEST_FILE);
    await rename(MANIFEST_INSTALLING_FILE, MANIFEST_FILE);
    renamed = true;
    if ((await realpath(MANIFEST_FILE)) !== MANIFEST_FILE) return unavailable();
    const output = await open(OUTPUT_ROOT, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try {
      await output.sync();
    } finally {
      await output.close();
    }
    complete = true;
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(MANIFEST_INSTALLING_FILE).catch(() => undefined);
    if (renamed && !complete) await unlink(MANIFEST_FILE).catch(() => undefined);
  }
}

async function loadManifest(): Promise<KemerBetReadinessProfileManifest> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(MANIFEST_FILE, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = (await handle.stat()) as SnapshotStat;
    const pathBefore = (await lstat(MANIFEST_FILE)) as SnapshotStat;
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !sameStat(before, pathBefore) ||
      before.uid !== 0 ||
      before.gid !== 0 ||
      (before.mode & 0o777) !== 0o400 ||
      before.nlink !== 1 ||
      before.size < 100 ||
      before.size > 1024 ||
      (await realpath(MANIFEST_FILE)) !== MANIFEST_FILE
    ) {
      return unavailable();
    }
    const serialized = await handle.readFile({ encoding: 'utf8' });
    if (
      Buffer.byteLength(serialized, 'utf8') !== before.size ||
      !sameStat(before, (await handle.stat()) as SnapshotStat) ||
      !sameStat(before, (await lstat(MANIFEST_FILE)) as SnapshotStat)
    ) {
      return unavailable();
    }
    return parseKemerBetReadinessProfileManifest(serialized);
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function productionSnapshot(accountId: string): Promise<void> {
  if (!UUID_PATTERN.test(accountId)) return unavailable();
  const mountInfoBefore = await readFile('/proc/self/mountinfo', 'utf8');
  assertKemerBetReadinessProfileMountInfo(mountInfoBefore, 'snapshot');
  const sourceAccount = resolve(SOURCE_ROOT, accountId);
  if (safeRelativePath(SOURCE_ROOT, sourceAccount) !== accountId) return unavailable();
  const sourceRecords = await inspectTree({
    copyToRoot: SNAPSHOT_ROOT,
    ignoreTopLevelChromiumSingletonSymlinks: true,
    root: sourceAccount,
  });
  const targetAccount = resolve(SNAPSHOT_ROOT, accountId);
  if (safeRelativePath(SNAPSHOT_ROOT, targetAccount) !== accountId) return unavailable();
  const targetRecords = await inspectTree({ root: targetAccount });
  const sourceAfter = await inspectTree({
    ignoreTopLevelChromiumSingletonSymlinks: true,
    root: sourceAccount,
  });
  const sourceManifest = summarize(accountId, sourceRecords);
  if (
    sourceManifest.treeSha256 !== createKemerBetReadinessProfileTreeDigest(targetRecords) ||
    sourceManifest.treeSha256 !== createKemerBetReadinessProfileTreeDigest(sourceAfter) ||
    sourceManifest.fileCount !== targetRecords.filter(({ type }) => type === 'file').length ||
    sourceManifest.directoryCount !==
      targetRecords.filter(({ type }) => type === 'directory').length ||
    (await readdir(SNAPSHOT_ROOT)).length !== 1 ||
    (await readdir(SNAPSHOT_ROOT))[0] !== accountId
  ) {
    return unavailable();
  }
  await writeManifest(sourceManifest);
  const mountInfoAfter = await readFile('/proc/self/mountinfo', 'utf8');
  if (mountInfoBefore !== mountInfoAfter) return unavailable();
}

async function productionVerify(accountId: string): Promise<void> {
  if (!UUID_PATTERN.test(accountId)) return unavailable();
  const mountInfoBefore = await readFile('/proc/self/mountinfo', 'utf8');
  assertKemerBetReadinessProfileMountInfo(mountInfoBefore, 'verify');
  const manifest = await loadManifest();
  const sourceAccount = resolve(SOURCE_ROOT, accountId);
  if (safeRelativePath(SOURCE_ROOT, sourceAccount) !== accountId) return unavailable();
  const records = await inspectTree({ root: sourceAccount });
  const observed = summarize(accountId, records);
  if (
    serializeKemerBetReadinessProfileManifest(observed) !==
    serializeKemerBetReadinessProfileManifest(manifest)
  ) {
    return unavailable();
  }
  const mountInfoAfter = await readFile('/proc/self/mountinfo', 'utf8');
  if (mountInfoBefore !== mountInfoAfter) return unavailable();
}

async function productionVerifyOriginal(accountId: string): Promise<void> {
  if (!UUID_PATTERN.test(accountId)) return unavailable();
  const mountInfoBefore = await readFile('/proc/self/mountinfo', 'utf8');
  assertKemerBetReadinessProfileMountInfo(mountInfoBefore, 'verify-original');
  const manifest = await loadManifest();
  const sourceAccount = resolve(SOURCE_ROOT, accountId);
  if (safeRelativePath(SOURCE_ROOT, sourceAccount) !== accountId) return unavailable();
  const records = await inspectTree({
    ignoreTopLevelChromiumSingletonSymlinks: true,
    root: sourceAccount,
  });
  const observed = summarize(accountId, records);
  if (
    serializeKemerBetReadinessProfileManifest(observed) !==
    serializeKemerBetReadinessProfileManifest(manifest)
  ) {
    return unavailable();
  }
  const mountInfoAfter = await readFile('/proc/self/mountinfo', 'utf8');
  if (mountInfoBefore !== mountInfoAfter) return unavailable();
}

export async function runKemerBetReadinessProfileSnapshot(
  mode: 'snapshot' | 'verify' | 'verify-original',
  dependencies: KemerBetReadinessProfileSnapshotDependencies = {},
): Promise<void> {
  const userId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  const groupId =
    dependencies.effectiveGroupId ??
    (typeof process.getegid === 'function' ? process.getegid() : Number.NaN);
  if (userId !== ROOT_USER_ID || groupId !== ROOT_USER_ID) return unavailable();
  (dependencies.assertOfflineNetwork ?? assertNoNetworkInterfaces)();
  await (dependencies.assertMountContract ?? assertProductionMountContract)(mode);
  const accountId = await (dependencies.loadAccountId ?? loadAccountId)();
  if (!UUID_PATTERN.test(accountId)) return unavailable();
  if (mode === 'snapshot') await (dependencies.snapshot ?? productionSnapshot)(accountId);
  else if (mode === 'verify') await (dependencies.verify ?? productionVerify)(accountId);
  else if (mode === 'verify-original') {
    await (dependencies.verifyOriginal ?? productionVerifyOriginal)(accountId);
  } else return unavailable();
}

export const KEMERBET_READINESS_PROFILE_SNAPSHOT_RUNTIME_CONTRACT = Object.freeze({
  commands: Object.freeze({
    snapshot: Object.freeze([
      'node',
      'apps/executor/dist/kemerbet-readiness-profile-snapshot.js',
      'snapshot',
    ]),
    verify: Object.freeze([
      'node',
      'apps/executor/dist/kemerbet-readiness-profile-snapshot.js',
      'verify',
    ]),
    verifyOriginal: Object.freeze([
      'node',
      'apps/executor/dist/kemerbet-readiness-profile-snapshot.js',
      'verify-original',
    ]),
  }),
  environment: Object.freeze([]),
  groupId: ROOT_USER_ID,
  manifest: Object.freeze({
    file: MANIFEST_FILE,
    installingFile: MANIFEST_INSTALLING_FILE,
    mode: 0o400,
    schema: Object.freeze([
      'accountIdSha256',
      'contract',
      'directoryCount',
      'fileCount',
      'treeSha256',
      'version',
    ]),
  }),
  mountsByCommand: Object.freeze({
    snapshot: Object.freeze({
      accountId: Object.freeze({ file: ACCOUNT_ID_FILE, mode: 0o400, readOnly: true }),
      output: Object.freeze({ path: OUTPUT_ROOT, readOnly: false }),
      snapshot: Object.freeze({ path: SNAPSHOT_ROOT, readOnly: false }),
      source: Object.freeze({ path: SOURCE_ROOT, readOnly: true }),
    }),
    verify: Object.freeze({
      accountId: Object.freeze({ file: ACCOUNT_ID_FILE, mode: 0o400, readOnly: true }),
      forbiddenPath: SNAPSHOT_ROOT,
      output: Object.freeze({ path: OUTPUT_ROOT, readOnly: true }),
      source: Object.freeze({
        description: 'the completed snapshot volume remounted read-only',
        path: SOURCE_ROOT,
        readOnly: true,
      }),
    }),
    verifyOriginal: Object.freeze({
      accountId: Object.freeze({ file: ACCOUNT_ID_FILE, mode: 0o400, readOnly: true }),
      forbiddenPath: SNAPSHOT_ROOT,
      output: Object.freeze({ path: OUTPUT_ROOT, readOnly: true }),
      source: Object.freeze({
        description: 'the original profile volume remounted read-only for post-run re-attestation',
        path: SOURCE_ROOT,
        readOnly: true,
      }),
    }),
  }),
  networkMode: 'none',
  resourceLimits: KEMERBET_READINESS_PROFILE_SNAPSHOT_LIMITS,
  postVerifyHandoff: Object.freeze({
    browserRootGroupId: 10001,
    browserRootMode: 0o700,
    browserRootUserId: 10001,
    invariant:
      'After verify succeeds, the root helper may chown/chmod only /run/snapshot itself; copied account-tree metadata and profile-manifest bytes must remain unchanged and must be re-attested before browser start.',
  }),
  userId: ROOT_USER_ID,
} as const);

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const mode = process.argv[2];
  try {
    if (mode !== 'snapshot' && mode !== 'verify' && mode !== 'verify-original') unavailable();
    await runKemerBetReadinessProfileSnapshot(mode);
  } catch {
    process.exitCode = 1;
  }
}
