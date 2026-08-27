import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { dirname } from 'node:path';

export const KEMERBET_READINESS_CONTROLLER_STAGE_FILE =
  '/run/fetanagent-kemerbet-readiness-controller-stage-output/stage-v1' as const;
export const KEMERBET_READINESS_BROWSER_STAGE_FILE =
  '/run/fetanagent-kemerbet-readiness-browser-stage-output/stage-v1' as const;
export const KEMERBET_READINESS_PROXY_STAGE_FILE =
  '/run/fetanagent-kemerbet-readiness-proxy-stage-output/stage-v1' as const;

export const KEMERBET_READINESS_CONTROLLER_STAGES = Object.freeze([
  'controller_not_started',
  'controller_bootstrap',
  'controller_rpc_open',
  'controller_identity',
  'controller_authorization',
  'controller_lookup_1',
  'controller_lookup_2',
  'controller_lookup_3',
  'controller_lookup_4',
  'controller_lookup_5',
  'controller_finalize',
  'controller_cleanup',
  'controller_complete',
] as const);

export const KEMERBET_READINESS_BROWSER_STAGES = Object.freeze([
  'browser_not_started',
  'browser_bootstrap',
  'browser_rpc_listen',
  'browser_open',
  'browser_restored_navigation',
  'browser_refresh_admitted',
  'browser_identity',
  'browser_probe_ready',
  'browser_lookup_1',
  'browser_lookup_2',
  'browser_lookup_3',
  'browser_lookup_4',
  'browser_lookup_5',
  'browser_forbidden_request',
  'browser_finalize',
  'browser_cleanup',
  'browser_complete',
] as const);

export const KEMERBET_READINESS_PROXY_STAGES = Object.freeze([
  'proxy_not_started',
  'proxy_bootstrap',
  'proxy_ready',
  'browser_refresh_forwarded',
  'browser_refresh_response_complete',
] as const);

export type KemerBetReadinessControllerStage =
  (typeof KEMERBET_READINESS_CONTROLLER_STAGES)[number];
export type KemerBetReadinessBrowserStage = (typeof KEMERBET_READINESS_BROWSER_STAGES)[number];
export type KemerBetReadinessProxyStage = (typeof KEMERBET_READINESS_PROXY_STAGES)[number];

const MAX_STAGE_BYTES = 64;
const CONTROLLER_EFFECTIVE_USER_ID = 10002;
const BROWSER_EFFECTIVE_USER_ID = 10001;
const PROXY_EFFECTIVE_USER_ID = 10003;

export class KemerBetReadinessFixedStageUnavailableError extends Error {
  constructor() {
    super('The fixed KemerBet readiness stage output is unavailable.');
    this.name = 'KemerBetReadinessFixedStageUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessFixedStageUnavailableError();
}

function sameStat(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.gid === right.gid &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid
  );
}

function missing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function assertStageFile(
  filePath: string,
  expectedUserId: number,
  allowed: ReadonlySet<string>,
  expectedStage?: string,
): string {
  let descriptor = -1;
  try {
    const before = lstatSync(filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.uid !== expectedUserId ||
      before.gid !== expectedUserId ||
      (before.mode & 0o7777) !== 0o400 ||
      before.nlink !== 1 ||
      before.size < 2 ||
      before.size > MAX_STAGE_BYTES ||
      realpathSync(filePath) !== filePath
    ) {
      unavailable();
    }
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!sameStat(before, opened)) unavailable();
    const serialized = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(filePath);
    if (
      !sameStat(opened, after) ||
      !sameStat(after, pathAfter) ||
      serialized.length !== after.size
    ) {
      unavailable();
    }
    if (
      serialized.at(-1) !== 0x0a ||
      serialized.subarray(0, -1).includes(0x0a) ||
      serialized.includes(0x0d) ||
      serialized.includes(0)
    ) {
      unavailable();
    }
    const stage = serialized.subarray(0, -1).toString('ascii');
    if (!allowed.has(stage) || (expectedStage !== undefined && stage !== expectedStage)) {
      unavailable();
    }
    return stage;
  } catch {
    return unavailable();
  } finally {
    if (descriptor >= 0) {
      try {
        closeSync(descriptor);
      } catch {
        // The process is already fail-closed if its exact stage descriptor cannot close.
      }
    }
  }
}

function recordFixedStage(input: {
  readonly allowedStages: readonly string[];
  readonly expectedUserId: number;
  readonly filePath: string;
  readonly stage: string;
}): void {
  const allowed = new Set(input.allowedStages);
  if (!allowed.has(input.stage)) unavailable();
  const effectiveUserId = typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN;
  if (effectiveUserId !== input.expectedUserId) unavailable();
  const outputRoot = dirname(input.filePath);
  const installingPath = `${input.filePath}.installing`;
  let descriptor = -1;
  let installingCreated = false;
  let directoryDescriptor = -1;
  try {
    const root = lstatSync(outputRoot);
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      root.uid !== input.expectedUserId ||
      root.gid !== input.expectedUserId ||
      (root.mode & 0o7777) !== 0o700 ||
      realpathSync(outputRoot) !== outputRoot
    ) {
      unavailable();
    }
    assertStageFile(input.filePath, input.expectedUserId, allowed);
    try {
      lstatSync(installingPath);
      unavailable();
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const serialized = Buffer.from(`${input.stage}\n`, 'ascii');
    if (serialized.length < 2 || serialized.length > MAX_STAGE_BYTES) unavailable();
    descriptor = openSync(
      installingPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    installingCreated = true;
    const created = fstatSync(descriptor);
    if (
      !created.isFile() ||
      created.isSymbolicLink() ||
      created.uid !== input.expectedUserId ||
      created.gid !== input.expectedUserId ||
      (created.mode & 0o7777) !== 0o600 ||
      created.nlink !== 1 ||
      created.size !== 0
    ) {
      unavailable();
    }
    let offset = 0;
    while (offset < serialized.length) {
      const written = writeSync(descriptor, serialized, offset, serialized.length - offset, offset);
      if (written < 1) unavailable();
      offset += written;
    }
    fsyncSync(descriptor);
    fchmodSync(descriptor, 0o400);
    const sealed = fstatSync(descriptor);
    if (
      sealed.uid !== input.expectedUserId ||
      sealed.gid !== input.expectedUserId ||
      (sealed.mode & 0o7777) !== 0o400 ||
      sealed.nlink !== 1 ||
      sealed.size !== serialized.length
    ) {
      unavailable();
    }
    closeSync(descriptor);
    descriptor = -1;
    renameSync(installingPath, input.filePath);
    installingCreated = false;
    directoryDescriptor = openSync(
      outputRoot,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const openedRoot = fstatSync(directoryDescriptor);
    if (!openedRoot.isDirectory() || openedRoot.uid !== input.expectedUserId) unavailable();
    fsyncSync(directoryDescriptor);
    assertStageFile(input.filePath, input.expectedUserId, allowed, input.stage);
  } catch {
    if (descriptor >= 0) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the fixed generic failure below.
      }
      descriptor = -1;
    }
    if (installingCreated) {
      try {
        unlinkSync(installingPath);
      } catch {
        // Preserve the fixed generic failure below.
      }
    }
    return unavailable();
  } finally {
    if (directoryDescriptor >= 0) {
      try {
        closeSync(directoryDescriptor);
      } catch {
        // The stage has already been synchronized and revalidated.
      }
    }
  }
}

export function recordKemerBetReadinessControllerStage(
  stage: KemerBetReadinessControllerStage,
): void {
  recordFixedStage({
    allowedStages: KEMERBET_READINESS_CONTROLLER_STAGES,
    expectedUserId: CONTROLLER_EFFECTIVE_USER_ID,
    filePath: KEMERBET_READINESS_CONTROLLER_STAGE_FILE,
    stage,
  });
}

export function recordKemerBetReadinessBrowserStage(stage: KemerBetReadinessBrowserStage): void {
  recordFixedStage({
    allowedStages: KEMERBET_READINESS_BROWSER_STAGES,
    expectedUserId: BROWSER_EFFECTIVE_USER_ID,
    filePath: KEMERBET_READINESS_BROWSER_STAGE_FILE,
    stage,
  });
}

export function recordKemerBetReadinessProxyStage(stage: KemerBetReadinessProxyStage): void {
  recordFixedStage({
    allowedStages: KEMERBET_READINESS_PROXY_STAGES,
    expectedUserId: PROXY_EFFECTIVE_USER_ID,
    filePath: KEMERBET_READINESS_PROXY_STAGE_FILE,
    stage,
  });
}

export const KEMERBET_READINESS_FIXED_STAGE_CONTRACT = Object.freeze({
  browserFile: KEMERBET_READINESS_BROWSER_STAGE_FILE,
  browserStages: KEMERBET_READINESS_BROWSER_STAGES,
  controllerFile: KEMERBET_READINESS_CONTROLLER_STAGE_FILE,
  controllerStages: KEMERBET_READINESS_CONTROLLER_STAGES,
  maxBytes: MAX_STAGE_BYTES,
  proxyFile: KEMERBET_READINESS_PROXY_STAGE_FILE,
  proxyStages: KEMERBET_READINESS_PROXY_STAGES,
});
