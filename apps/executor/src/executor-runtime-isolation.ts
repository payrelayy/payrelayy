import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_IDENTITY_FINGERPRINT_PATTERN = /^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u;
const AGENT_PROFILE_PIN_PATTERN = /^hmac-sha256-agent-profile-pin-v3:[0-9a-f]{64}$/u;
const AGENT_IDENTITY_FINGERPRINT_PREFIX = 'hmac-sha256-agent-identity-v1:';
const AGENT_PROFILE_PIN_PREFIX = 'hmac-sha256-agent-profile-pin-v3:';
const KEMERBET_SECURITY_RECOVERY_IDENTITY_AUTHORIZATION_CONTRACT =
  'fetanagent-kemerbet-quarantine-recovery-identity-authorization-v1';
const MAXIMUM_AGENT_ACCOUNTS = 64;
const MAXIMUM_BINDING_FILE_BYTES = 16_384;
const MAXIMUM_SELECTOR_FILE_BYTES = 128 * 1_024;
const EXACT_READINESS_PLAYER_COUNT = 5;
const MAXIMUM_READINESS_PLAYER_IDS_FILE_BYTES = 1_024;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const LINUX_OPEN_DIRECTORY = 0o200000;
const LINUX_OPEN_NOFOLLOW = 0o400000;

interface IsolationFileStat {
  readonly dev: number | bigint;
  readonly gid: number;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isDirectory?(): boolean;
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
    left.gid === right.gid &&
    left.nlink === right.nlink &&
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

export type KemerBetSessionIdentityAuthorization =
  | Readonly<{
      readonly expectedAgentIdentityFingerprint: string;
      readonly kind: 'binding';
      readonly platformAgentAccountId: string;
      readonly verificationPlatformAgentAccountId: string;
    }>
  | Readonly<{
      readonly expectedAgentIdentityFingerprint: string;
      readonly kind: 'security_recovery';
      readonly platformAgentAccountId: string;
      readonly verificationPlatformAgentAccountId: string;
    }>;

export function parseKemerBetAgentIdentityBindings(value: string): KemerBetAgentIdentityBindings {
  if (value.length < 1 || /\r|\0/u.test(value)) return unavailable();
  const body = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (body.length < 1 || body.endsWith('\n')) return unavailable();
  const lines = body.split('\n');
  if (lines.length < 1 || lines.length > MAXIMUM_AGENT_ACCOUNTS) return unavailable();

  const accountIds: string[] = [];
  const bindings = new Map<string, string>();
  const fingerprints = new Set<string>();
  const agentProfilePins = new Set<string>();
  for (const line of lines) {
    const fields = line.split(' ');
    if (fields.length !== 3) return unavailable();
    const [accountId, fingerprint, agentProfilePin] = fields;
    if (
      accountId === undefined ||
      fingerprint === undefined ||
      agentProfilePin === undefined ||
      !UUID_PATTERN.test(accountId) ||
      accountId === '00000000-0000-0000-0000-000000000000' ||
      !AGENT_IDENTITY_FINGERPRINT_PATTERN.test(fingerprint) ||
      !AGENT_PROFILE_PIN_PATTERN.test(agentProfilePin) ||
      fingerprint.slice(AGENT_IDENTITY_FINGERPRINT_PREFIX.length) !==
        agentProfilePin.slice(AGENT_PROFILE_PIN_PREFIX.length) ||
      bindings.has(accountId) ||
      fingerprints.has(fingerprint) ||
      agentProfilePins.has(agentProfilePin)
    ) {
      return unavailable();
    }
    accountIds.push(accountId);
    bindings.set(accountId, fingerprint);
    fingerprints.add(fingerprint);
    agentProfilePins.add(agentProfilePin);
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

/**
 * Parse the private-preview authorization boundary. Ordinary enrollment continues to use one
 * canonical v3 binding. Security recovery instead carries only the retired Profile UUID, its
 * already-keyed identity digest, and the fresh Profile UUID. It is deliberately not a binding:
 * the old UUID-bound digest can authorize one signed-in observation but cannot authenticate the
 * fresh Profile to any ordinary v3 consumer.
 */
export function parseKemerBetSessionIdentityAuthorization(
  value: string,
): KemerBetSessionIdentityAuthorization {
  if (value.length < 1 || /\r|\0/u.test(value) || !value.endsWith('\n')) return unavailable();

  try {
    const bindings = parseKemerBetAgentIdentityBindings(value);
    if (
      bindings.platformAgentAccountIds.length !== 1 ||
      bindings.expectedAgentIdentityBindings.size !== 1
    ) {
      return unavailable();
    }
    const platformAgentAccountId = bindings.platformAgentAccountIds[0];
    const expectedAgentIdentityFingerprint =
      platformAgentAccountId === undefined
        ? undefined
        : bindings.expectedAgentIdentityBindings.get(platformAgentAccountId);
    if (platformAgentAccountId === undefined || expectedAgentIdentityFingerprint === undefined) {
      return unavailable();
    }
    return Object.freeze({
      expectedAgentIdentityFingerprint,
      kind: 'binding',
      platformAgentAccountId,
      verificationPlatformAgentAccountId: platformAgentAccountId,
    });
  } catch (error) {
    if (!(error instanceof KemerBetExecutorIsolationUnavailableError)) throw error;
  }

  const lines = value.slice(0, -1).split('\n');
  if (
    lines.length !== 8 ||
    lines[0] !== 'version=1' ||
    lines[1] !== `contract=${KEMERBET_SECURITY_RECOVERY_IDENTITY_AUTHORIZATION_CONTRACT}` ||
    !lines[2]?.startsWith('old_profile_id=') ||
    !lines[3]?.startsWith('old_identity_fingerprint=') ||
    !lines[4]?.startsWith('new_profile_id=') ||
    lines[5] !== 'configuration_reason=security_recovery' ||
    lines[6] !== 'transfer_disabled=true' ||
    lines[7] !== 'money_moved=false'
  ) {
    return unavailable();
  }
  const verificationPlatformAgentAccountId = lines[2].slice('old_profile_id='.length);
  const expectedAgentIdentityFingerprint = lines[3].slice('old_identity_fingerprint='.length);
  const platformAgentAccountId = lines[4].slice('new_profile_id='.length);
  if (
    !UUID_PATTERN.test(verificationPlatformAgentAccountId) ||
    verificationPlatformAgentAccountId === '00000000-0000-0000-0000-000000000000' ||
    !AGENT_IDENTITY_FINGERPRINT_PATTERN.test(expectedAgentIdentityFingerprint) ||
    !UUID_PATTERN.test(platformAgentAccountId) ||
    platformAgentAccountId === '00000000-0000-0000-0000-000000000000' ||
    platformAgentAccountId === verificationPlatformAgentAccountId
  ) {
    return unavailable();
  }
  return Object.freeze({
    expectedAgentIdentityFingerprint,
    kind: 'security_recovery',
    platformAgentAccountId,
    verificationPlatformAgentAccountId,
  });
}

export async function loadKemerBetSessionIdentityAuthorization(options: {
  readonly filePath: string;
  readonly fileSystem?: ExecutorIsolationFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<KemerBetSessionIdentityAuthorization> {
  const text = await readVerifiedTextFile({
    path: options.filePath,
    maximumBytes: MAXIMUM_BINDING_FILE_BYTES,
    fileSystem: options.fileSystem ?? nodeFileSystem,
    platform: options.platform ?? process.platform,
    ...(options.effectiveUserId === undefined ? {} : { effectiveUserId: options.effectiveUserId }),
  });
  return parseKemerBetSessionIdentityAuthorization(text);
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
 * Exact imported-stage input retained only in memory. The attestation closure binds the original
 * inode and content digest without exposing either value to the readiness workflow or its output.
 */
export interface KemerBetExactImportedReadinessPlayers extends KemerBetNoTransferReadinessPlayers {
  readonly reattest: () => Promise<void>;
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

interface ExactReadinessStageRead {
  readonly digest: Buffer;
  readonly identity: IsolationFileStat;
  readonly parentIdentity?: IsolationFileStat;
  readonly players: KemerBetNoTransferReadinessPlayers;
}

interface ExactReadinessStageContract {
  readonly fileGroupId: number;
  readonly fileMode: number;
  readonly fileUserId: number;
  readonly parent?: {
    readonly groupId: number;
    readonly mode: number;
    readonly userId: number;
  };
}

function exactReadinessStageStat(
  stat: IsolationFileStat,
  platform: NodeJS.Platform,
  contract: ExactReadinessStageContract,
): boolean {
  return (
    platform !== 'win32' &&
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.uid === contract.fileUserId &&
    stat.gid === contract.fileGroupId &&
    stat.nlink === 1 &&
    (stat.mode & 0o7777) === contract.fileMode &&
    Number.isSafeInteger(stat.size) &&
    stat.size >= 10 &&
    stat.size <= MAXIMUM_READINESS_PLAYER_IDS_FILE_BYTES &&
    Number.isFinite(stat.mtimeMs)
  );
}

function exactReadinessStageParentStat(
  stat: IsolationFileStat,
  platform: NodeJS.Platform,
  contract: NonNullable<ExactReadinessStageContract['parent']>,
): boolean {
  return (
    platform !== 'win32' &&
    stat.isDirectory?.() === true &&
    !stat.isSymbolicLink() &&
    stat.uid === contract.userId &&
    stat.gid === contract.groupId &&
    stat.nlink >= 2 &&
    Number.isSafeInteger(stat.nlink) &&
    (stat.mode & 0o7777) === contract.mode &&
    Number.isSafeInteger(stat.size) &&
    Number.isFinite(stat.mtimeMs)
  );
}

async function readExactReadinessStage(options: {
  readonly contract: ExactReadinessStageContract;
  readonly filePath: string;
  readonly fileSystem: ExecutorIsolationFileSystem;
  readonly platform: NodeJS.Platform;
}): Promise<ExactReadinessStageRead> {
  if (
    options.platform !== 'linux' ||
    !isAbsolute(options.filePath) ||
    /\0/u.test(options.filePath) ||
    (process.platform === 'linux' &&
      (constants.O_DIRECTORY !== LINUX_OPEN_DIRECTORY ||
        constants.O_NOFOLLOW !== LINUX_OPEN_NOFOLLOW))
  ) {
    return unavailable();
  }
  const parentPath = dirname(options.filePath);
  let handle: ExecutorIsolationFileHandle | null = null;
  let parentHandle: ExecutorIsolationFileHandle | null = null;
  let bytes: Buffer | null = null;
  try {
    let parentHandleBefore: IsolationFileStat | undefined;
    if (options.contract.parent) {
      if (parentPath === options.filePath) {
        return unavailable();
      }
      const parentPathBefore = await options.fileSystem.lstat(parentPath);
      if (
        !exactReadinessStageParentStat(
          parentPathBefore,
          options.platform,
          options.contract.parent,
        ) ||
        !samePath(await options.fileSystem.realpath(parentPath), parentPath, options.platform)
      ) {
        return unavailable();
      }
      parentHandle = await options.fileSystem.open(
        parentPath,
        constants.O_RDONLY | LINUX_OPEN_DIRECTORY | LINUX_OPEN_NOFOLLOW,
      );
      parentHandleBefore = await parentHandle.stat();
      if (
        !exactReadinessStageParentStat(
          parentHandleBefore,
          options.platform,
          options.contract.parent,
        ) ||
        !sameFile(parentPathBefore, parentHandleBefore)
      ) {
        return unavailable();
      }
    }
    const pathBefore = await options.fileSystem.lstat(options.filePath);
    if (
      !exactReadinessStageStat(pathBefore, options.platform, options.contract) ||
      !samePath(
        await options.fileSystem.realpath(options.filePath),
        options.filePath,
        options.platform,
      )
    ) {
      return unavailable();
    }
    handle = await options.fileSystem.open(
      options.filePath,
      constants.O_RDONLY | LINUX_OPEN_NOFOLLOW,
    );
    const handleBefore = await handle.stat();
    if (
      !exactReadinessStageStat(handleBefore, options.platform, options.contract) ||
      !sameFile(pathBefore, handleBefore)
    ) {
      return unavailable();
    }
    bytes = await handle.readFile();
    const handleAfter = await handle.stat();
    const pathAfter = await options.fileSystem.lstat(options.filePath);
    if (
      !exactReadinessStageStat(handleAfter, options.platform, options.contract) ||
      !exactReadinessStageStat(pathAfter, options.platform, options.contract) ||
      !sameFile(handleBefore, handleAfter) ||
      !sameFile(handleAfter, pathAfter) ||
      bytes.length !== handleAfter.size ||
      !samePath(
        await options.fileSystem.realpath(options.filePath),
        options.filePath,
        options.platform,
      )
    ) {
      return unavailable();
    }
    let parentIdentity: IsolationFileStat | undefined;
    if (options.contract.parent && parentHandle && parentHandleBefore) {
      const parentHandleAfter = await parentHandle.stat();
      const parentPathAfter = await options.fileSystem.lstat(parentPath);
      if (
        !exactReadinessStageParentStat(
          parentHandleAfter,
          options.platform,
          options.contract.parent,
        ) ||
        !exactReadinessStageParentStat(
          parentPathAfter,
          options.platform,
          options.contract.parent,
        ) ||
        !sameFile(parentHandleBefore, parentHandleAfter) ||
        !sameFile(parentHandleAfter, parentPathAfter) ||
        !samePath(await options.fileSystem.realpath(parentPath), parentPath, options.platform)
      ) {
        return unavailable();
      }
      parentIdentity = parentHandleAfter;
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!decoded.endsWith('\n')) return unavailable();
    const players = parseKemerBetNoTransferReadinessPlayerIds(decoded);
    const canonical = Buffer.from(`${players.playerIds.join('\n')}\n`, 'utf8');
    if (canonical.length !== bytes.length || !timingSafeEqual(canonical, bytes)) {
      return unavailable();
    }
    return {
      digest: createHash('sha256').update(bytes).digest(),
      identity: handleAfter,
      ...(parentIdentity ? { parentIdentity } : {}),
      players,
    };
  } catch (error) {
    if (error instanceof KemerBetExecutorIsolationUnavailableError) throw error;
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
    if (parentHandle !== null) {
      try {
        await parentHandle.close();
      } catch {
        // The caller receives only the generic isolation failure from the guarded operation.
      }
    }
  }
}

async function loadExactKemerBetReadinessPlayerIds(options: {
  readonly contract: ExactReadinessStageContract;
  readonly filePath: string;
  readonly fileSystem?: ExecutorIsolationFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<KemerBetExactImportedReadinessPlayers> {
  const platform = options.platform ?? process.platform;
  if (effectiveUserId(platform, options.effectiveUserId) !== 10_001) return unavailable();
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const initial = await readExactReadinessStage({
    contract: options.contract,
    filePath: options.filePath,
    fileSystem,
    platform,
  });
  const expectedDigest = Buffer.from(initial.digest);
  initial.digest.fill(0);
  return Object.freeze({
    playerIds: initial.players.playerIds,
    reattest: async (): Promise<void> => {
      const current = await readExactReadinessStage({
        contract: options.contract,
        filePath: options.filePath,
        fileSystem,
        platform,
      });
      try {
        if (
          !sameFile(initial.identity, current.identity) ||
          (initial.parentIdentity === undefined) !== (current.parentIdentity === undefined) ||
          (initial.parentIdentity !== undefined &&
            current.parentIdentity !== undefined &&
            !sameFile(initial.parentIdentity, current.parentIdentity)) ||
          current.digest.length !== expectedDigest.length ||
          !timingSafeEqual(current.digest, expectedDigest)
        ) {
          return unavailable();
        }
      } finally {
        current.digest.fill(0);
      }
    },
  });
}

/**
 * Load the standalone one-shot secret without conflating it with the imported control-volume stage.
 */
export async function loadExactKemerBetStandaloneReadinessPlayerIds(options: {
  readonly filePath: string;
  readonly fileSystem?: ExecutorIsolationFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<KemerBetExactImportedReadinessPlayers> {
  return loadExactKemerBetReadinessPlayerIds({
    ...options,
    contract: {
      fileGroupId: 10_001,
      fileMode: 0o400,
      fileUserId: 10_001,
    },
  });
}

/**
 * Load only the frozen root-owned imported cohort, then retain an opaque inode/content attestation
 * that can be checked immediately before the readiness binding is installed.
 */
export async function loadExactKemerBetImportedReadinessPlayerIds(options: {
  readonly filePath: string;
  readonly fileSystem?: ExecutorIsolationFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}): Promise<KemerBetExactImportedReadinessPlayers> {
  return loadExactKemerBetReadinessPlayerIds({
    ...options,
    contract: {
      fileGroupId: 0,
      fileMode: 0o444,
      fileUserId: 0,
      parent: {
        groupId: 10_001,
        mode: 0o700,
        userId: 10_001,
      },
    },
  });
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
