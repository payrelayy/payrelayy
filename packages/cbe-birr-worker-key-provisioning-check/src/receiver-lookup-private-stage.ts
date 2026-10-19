import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { types as nodeUtilTypes } from 'node:util';

import {
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
  loadCbeBirrReceiverLookupKeyCustody,
  type CbeBirrGuardedFileSystem,
  type CbeBirrReceiverLookupReleasePins,
} from '@fetanagent/cbe-birr-worker-key-custody';

import {
  wasPreparedCbeBirrReceiverDeliveryBundle,
  type CbeBirrReceiverDeliveryBundle,
} from './receiver-lookup-delivery-bundle.js';
import type { CbeBirrReceiverProvisioningCandidateInput } from './receiver-lookup-candidate.js';

/** A private, empty host directory. Later deployment must independently bind its files. */
export const CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT =
  '/var/lib/fetanagent/cbe-birr-receiver-key-custody-v1' as const;

const MAX_FILE_BYTES = 4_096;
const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PIN_KEYS = [
  'deploymentTarget',
  'receiverRevisionId',
  'receiverVersion',
  'rootProfileSha256',
  'workerProfileSha256',
  'workerKeyId',
] as const;
const SNAPSHOT_KEYS = [
  'receiverRevisionId',
  'receiverVersion',
  'protectionProfileVersion',
  'encryptionKeyVersion',
  'fingerprintKeyVersion',
] as const;
const STAGED_FILES = [
  {
    sourcePath: CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
    name: 'owner-root-profile.v2.json',
    mode: 0o444,
    owner: 'root',
  },
  {
    sourcePath: CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
    name: 'receiver-opening-profile.v1.json',
    mode: 0o444,
    owner: 'root',
  },
  {
    sourcePath: CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
    name: 'receiver-child-key.v1.json',
    mode: 0o400,
    owner: 'worker',
  },
] as const;

export interface CbeBirrReceiverPrivateStageInput {
  readonly bundle: CbeBirrReceiverDeliveryBundle;
  readonly approvedPins: CbeBirrReceiverLookupReleasePins;
  readonly approvedWorkerUserId: number;
  readonly actorAuthUserId: string;
  readonly readActiveSnapshot: CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot'];
}

export interface CbeBirrReceiverStageStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface CbeBirrReceiverStageHandle {
  stat(): Promise<CbeBirrReceiverStageStat>;
  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  chown(uid: number, gid: number): Promise<void>;
  chmod(mode: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface CbeBirrReceiverStageFileSystem {
  readonly noFollowFlag: number | undefined;
  readonly directoryFlag: number | undefined;
  lstat(path: string): Promise<CbeBirrReceiverStageStat>;
  realpath(path: string): Promise<string>;
  readdir(path: string): Promise<readonly string[]>;
  open(path: string, flags: number, mode?: number): Promise<CbeBirrReceiverStageHandle>;
  unlink(path: string): Promise<void>;
}

export interface CbeBirrReceiverPrivateStageDependencies {
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
  readonly fileSystem?: CbeBirrReceiverStageFileSystem;
}

export class CbeBirrReceiverPrivateStageError extends Error {
  constructor() {
    super('CBE Birr receiver private stage is unavailable.');
    this.name = 'CbeBirrReceiverPrivateStageError';
  }
}

const nodeFileSystem: CbeBirrReceiverStageFileSystem = {
  noFollowFlag: constants.O_NOFOLLOW,
  directoryFlag: constants.O_DIRECTORY,
  lstat,
  realpath,
  readdir,
  open: (path, flags, mode) => open(path, flags, mode) as Promise<FileHandle>,
  unlink,
};

function unavailable(): never {
  throw new CbeBirrReceiverPrivateStageError();
}

function exactDataProperties(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    nodeUtilTypes.isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Object.prototype
  )
    return undefined;
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      return undefined;
    values[key] = descriptor.value;
  }
  return values;
}

function sameStat(left: CbeBirrReceiverStageStat, right: CbeBirrReceiverStageStat): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size
  );
}

function sameRoot(left: CbeBirrReceiverStageStat, right: CbeBirrReceiverStageStat): boolean {
  return validRoot(left) && validRoot(right) && left.dev === right.dev && left.ino === right.ino;
}

function validRoot(stat: CbeBirrReceiverStageStat): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === 0 &&
    stat.gid === 0 &&
    stat.nlink >= 1 &&
    (stat.mode & 0o7777) === 0o700
  );
}

function validFile(
  stat: CbeBirrReceiverStageStat,
  uid: number,
  mode: number,
  size: number,
): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.uid === uid &&
    stat.gid === uid &&
    stat.nlink === 1 &&
    (stat.mode & 0o7777) === mode &&
    stat.size === size
  );
}

async function requireActiveRevision(
  reader: CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot'],
  actorAuthUserId: string,
  pins: CbeBirrReceiverLookupReleasePins,
): Promise<void> {
  const revision = Object.freeze({
    receiverRevisionId: pins.receiverRevisionId,
    receiverVersion: pins.receiverVersion,
  });
  const snapshot = exactDataProperties(await reader(actorAuthUserId, revision), SNAPSHOT_KEYS);
  if (
    !snapshot ||
    snapshot.receiverRevisionId !== revision.receiverRevisionId ||
    snapshot.receiverVersion !== revision.receiverVersion ||
    snapshot.protectionProfileVersion !== 2 ||
    snapshot.encryptionKeyVersion !== 2 ||
    snapshot.fingerprintKeyVersion !== 2
  )
    unavailable();
}

function requireBundleCompatibility(
  bundle: CbeBirrReceiverDeliveryBundle,
  pins: CbeBirrReceiverLookupReleasePins,
  workerUid: number,
  copies: readonly Buffer[],
  noFollowFlag: number,
): void {
  const byPath = new Map(
    bundle.files.map((file, index) => [file.path, { file, bytes: copies[index]! }]),
  );
  if (byPath.size !== 3) unavailable();
  const fileSystem: CbeBirrGuardedFileSystem = {
    noFollowFlag,
    lstat(path) {
      const item = byPath.get(path);
      if (!item) return unavailable();
      return {
        dev: 1,
        ino: STAGED_FILES.findIndex((entry) => entry.sourcePath === path) + 1,
        uid: item.file.mode === 0o400 ? workerUid : 0,
        mode: 0o100000 | item.file.mode,
        mtimeMs: 1,
        nlink: 1,
        size: item.bytes.length,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
    },
    realpath: (path) => path,
    open(path) {
      const item = byPath.get(path);
      if (!item) return unavailable();
      return {
        stat: () => fileSystem.lstat(path),
        read: () => Buffer.from(item.bytes),
        close: () => undefined,
      };
    },
  };
  const loaded = loadCbeBirrReceiverLookupKeyCustody(
    {
      NODE_ENV: 'production',
      FINANCIAL_ACTIONS_MODE: 'dry_run',
      INTERNAL_CBE_BIRR_RECEIVER_KEY_CUSTODY_CANDIDATE_ENABLED: 'true',
      CBE_BIRR_RECEIVER_KEY_DEPLOYMENT_TARGET: pins.deploymentTarget,
      CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
      CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
      CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
    },
    pins,
    { platform: 'linux', effectiveUserId: workerUid, fileSystem },
  );
  if (!loaded.enabled) unavailable();
}

async function readExactFile(
  fileSystem: CbeBirrReceiverStageFileSystem,
  path: string,
  expected: Buffer,
  uid: number,
  mode: number,
): Promise<CbeBirrReceiverStageStat> {
  let handle: CbeBirrReceiverStageHandle | undefined;
  const readBytes = Buffer.alloc(expected.length);
  try {
    const before = await fileSystem.lstat(path);
    if (
      !validFile(before, uid, mode, expected.length) ||
      (await fileSystem.realpath(path)) !== path
    )
      unavailable();
    handle = await fileSystem.open(path, constants.O_RDONLY | fileSystem.noFollowFlag!);
    if (!sameStat(before, await handle.stat())) unavailable();
    let offset = 0;
    while (offset < readBytes.length) {
      const result = await handle.read(readBytes, offset, readBytes.length - offset, offset);
      if (result.bytesRead < 1) unavailable();
      offset += result.bytesRead;
    }
    if (
      !timingSafeEqual(readBytes, expected) ||
      !sameStat(before, await handle.stat()) ||
      !sameStat(before, await fileSystem.lstat(path))
    )
      unavailable();
    return before;
  } finally {
    readBytes.fill(0);
    await handle?.close();
  }
}

/**
 * Stage a one-use bundle under a fixed, pre-existing empty root-owned directory. This does not
 * mount the files into any worker or enable CBE. A later deployment must verify the exact mount,
 * active revision, pins, and runtime custody again before use.
 */
export async function stageCbeBirrReceiverDeliveryBundle(
  input: CbeBirrReceiverPrivateStageInput,
  dependencies: CbeBirrReceiverPrivateStageDependencies = {},
): Promise<
  Readonly<{
    disposition: 'private_files_staged_only';
    approvedPins: CbeBirrReceiverLookupReleasePins;
  }>
> {
  const fileSystem = dependencies.fileSystem ?? nodeFileSystem;
  const copies: Buffer[] = [];
  const created: Array<{ path: string; stat: CbeBirrReceiverStageStat }> = [];
  let currentHandle: CbeBirrReceiverStageHandle | undefined;
  let sourceBundle: CbeBirrReceiverDeliveryBundle | undefined;
  try {
    const values = exactDataProperties(input, [
      'bundle',
      'approvedPins',
      'approvedWorkerUserId',
      'actorAuthUserId',
      'readActiveSnapshot',
    ]);
    const pins = exactDataProperties(values?.approvedPins, PIN_KEYS);
    const bundle = values?.bundle;
    if (wasPreparedCbeBirrReceiverDeliveryBundle(bundle)) sourceBundle = bundle;
    const workerUid = values?.approvedWorkerUserId;
    if (
      !values ||
      !wasPreparedCbeBirrReceiverDeliveryBundle(bundle) ||
      !pins ||
      typeof values.actorAuthUserId !== 'string' ||
      !ACTOR_ID.test(values.actorAuthUserId) ||
      typeof values.readActiveSnapshot !== 'function' ||
      typeof workerUid !== 'number' ||
      !Number.isSafeInteger(workerUid) ||
      workerUid < 1 ||
      workerUid > 2_147_483_647 ||
      (dependencies.platform ?? process.platform) !== 'linux' ||
      (dependencies.effectiveUserId ??
        (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN)) !== 0 ||
      typeof fileSystem.noFollowFlag !== 'number' ||
      !Number.isSafeInteger(fileSystem.noFollowFlag) ||
      fileSystem.noFollowFlag <= 0 ||
      typeof fileSystem.directoryFlag !== 'number' ||
      !Number.isSafeInteger(fileSystem.directoryFlag) ||
      fileSystem.directoryFlag <= 0 ||
      !PIN_KEYS.every((key) => pins[key] === bundle.approvedPins[key]) ||
      bundle.files.length !== 3
    )
      unavailable();
    for (const file of bundle.files) {
      if (
        !Buffer.isBuffer(file.bytes) ||
        file.bytes.length < 1 ||
        file.bytes.length > MAX_FILE_BYTES ||
        !STAGED_FILES.some((entry) => entry.sourcePath === file.path && entry.mode === file.mode)
      )
        unavailable();
      copies.push(Buffer.from(file.bytes));
    }
    requireBundleCompatibility(
      bundle,
      values.approvedPins as CbeBirrReceiverLookupReleasePins,
      workerUid,
      copies,
      fileSystem.noFollowFlag,
    );
    const approvedPins = Object.freeze({ ...bundle.approvedPins });
    const reader =
      values.readActiveSnapshot as CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot'];
    await requireActiveRevision(reader, values.actorAuthUserId, approvedPins);

    const rootBefore = await fileSystem.lstat(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT);
    if (
      !validRoot(rootBefore) ||
      (await fileSystem.realpath(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT)) !==
        CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT ||
      (await fileSystem.readdir(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT)).length !== 0
    )
      unavailable();
    for (const entry of STAGED_FILES) {
      const sourceIndex = bundle.files.findIndex((file) => file.path === entry.sourcePath);
      if (sourceIndex < 0) unavailable();
      const bytes = copies[sourceIndex]!;
      const path = join(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT, entry.name);
      currentHandle = await fileSystem.open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | fileSystem.noFollowFlag,
        0o600,
      );
      const first = await currentHandle.stat();
      created.push({ path, stat: first });
      if (!validFile(first, 0, 0o600, 0)) unavailable();
      let offset = 0;
      while (offset < bytes.length) {
        const result = await currentHandle.write(bytes, offset, bytes.length - offset, offset);
        if (result.bytesWritten < 1) unavailable();
        offset += result.bytesWritten;
      }
      const uid = entry.owner === 'worker' ? workerUid : 0;
      await currentHandle.chown(uid, uid);
      await currentHandle.chmod(entry.mode);
      await currentHandle.sync();
      if (!validFile(await currentHandle.stat(), uid, entry.mode, bytes.length)) unavailable();
      await currentHandle.close();
      currentHandle = undefined;
    }
    if (!sameRoot(rootBefore, await fileSystem.lstat(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT)))
      unavailable();
    const directory = await fileSystem.open(
      CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT,
      constants.O_RDONLY | fileSystem.directoryFlag | fileSystem.noFollowFlag,
    );
    currentHandle = directory;
    if (!sameRoot(rootBefore, await directory.stat())) unavailable();
    await directory.sync();
    await directory.close();
    currentHandle = undefined;
    await requireActiveRevision(reader, values.actorAuthUserId, approvedPins);
    if ((await fileSystem.readdir(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT)).length !== 3)
      unavailable();
    for (const entry of STAGED_FILES) {
      const sourceIndex = bundle.files.findIndex((file) => file.path === entry.sourcePath);
      await readExactFile(
        fileSystem,
        join(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT, entry.name),
        copies[sourceIndex]!,
        entry.owner === 'worker' ? workerUid : 0,
        entry.mode,
      );
    }
    return Object.freeze({ disposition: 'private_files_staged_only', approvedPins });
  } catch {
    if (currentHandle) {
      try {
        await currentHandle.close();
      } catch {
        /* Preserve the fixed error. */
      }
    }
    for (const item of created.reverse()) {
      try {
        const current = await fileSystem.lstat(item.path);
        if (current.dev === item.stat.dev && current.ino === item.stat.ino)
          await fileSystem.unlink(item.path);
      } catch {
        /* Any residue blocks a later attempt because the directory must be empty. */
      }
    }
    return unavailable();
  } finally {
    for (const bytes of copies) bytes.fill(0);
    if (sourceBundle) {
      for (const file of sourceBundle.files) file.bytes.fill(0);
    }
  }
}
