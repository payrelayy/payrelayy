import { timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';

import { isKemerBetReadinessLayer7Authorization } from './kemerbet-readiness-layer7-authorization.js';

export const KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE =
  '/run/secrets/kemerbet_readiness_layer7_authorizations' as const;

const CONTROLLER_USER_ID = 10002;
const TOKEN_BYTES = 102;
const TOKEN_COUNT = 5;
const FILE_BYTES = TOKEN_COUNT * (TOKEN_BYTES + 1);

interface AuthorizationStat {
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

export interface KemerBetReadinessLayer7AuthorizationsFileSystem {
  lstat(path: string): Promise<AuthorizationStat>;
  open(path: string, flags: number): Promise<Awaited<ReturnType<typeof open>>>;
  realpath(path: string): Promise<string>;
}

export interface KemerBetReadinessLayer7Authorizations {
  readonly authorizations: readonly string[];
}

export class KemerBetReadinessLayer7AuthorizationsUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness Layer-7 authorization contract is unavailable.');
    this.name = 'KemerBetReadinessLayer7AuthorizationsUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessLayer7AuthorizationsUnavailableError();
}

function sameStat(left: AuthorizationStat, right: AuthorizationStat): boolean {
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

function exactNonce(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  const comparable =
    rightBytes.length === leftBytes.length ? rightBytes : Buffer.alloc(leftBytes.length);
  const equal = timingSafeEqual(leftBytes, comparable);
  leftBytes.fill(0);
  if (comparable !== rightBytes) comparable.fill(0);
  rightBytes.fill(0);
  return equal && comparable === rightBytes;
}

const productionFileSystem: KemerBetReadinessLayer7AuthorizationsFileSystem = {
  lstat: async (path) => (await lstat(path)) as AuthorizationStat,
  open,
  realpath,
};

/** Load the five pre-minted tokens without receiving, deriving, or duplicating any Player ID. */
export async function loadKemerBetReadinessLayer7Authorizations(
  options: {
    readonly effectiveUserId?: number;
    readonly fileSystem?: KemerBetReadinessLayer7AuthorizationsFileSystem;
  } = {},
): Promise<KemerBetReadinessLayer7Authorizations> {
  const effectiveUserId =
    options.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (effectiveUserId !== CONTROLLER_USER_ID) unavailable();
  const fileSystem = options.fileSystem ?? productionFileSystem;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await fileSystem.open(
      KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = (await handle.stat()) as AuthorizationStat;
    const pathBefore = await fileSystem.lstat(KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      !sameStat(before, pathBefore) ||
      before.uid !== CONTROLLER_USER_ID ||
      before.gid !== CONTROLLER_USER_ID ||
      (before.mode & 0o777) !== 0o400 ||
      before.nlink !== 1 ||
      before.size !== FILE_BYTES ||
      (await fileSystem.realpath(KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE)) !==
        KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE
    ) {
      unavailable();
    }
    const serialized = await handle.readFile({ encoding: 'utf8' });
    const after = (await handle.stat()) as AuthorizationStat;
    const pathAfter = await fileSystem.lstat(KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE);
    if (
      !sameStat(before, after) ||
      !sameStat(after, pathAfter) ||
      pathAfter.isSymbolicLink() ||
      Buffer.byteLength(serialized, 'utf8') !== FILE_BYTES ||
      !serialized.endsWith('\n') ||
      serialized.includes('\r')
    ) {
      unavailable();
    }
    const lines = serialized.slice(0, -1).split('\n');
    if (lines.length !== TOKEN_COUNT) unavailable();
    let nonce: string | null = null;
    const authorizations = lines.map((authorization, index) => {
      if (!isKemerBetReadinessLayer7Authorization(authorization)) unavailable();
      const fields = authorization.split('.');
      if (fields[2] !== String(index + 1)) unavailable();
      if (nonce === null) nonce = fields[1] ?? unavailable();
      else if (fields[1] === undefined || !exactNonce(fields[1], nonce)) unavailable();
      return authorization;
    });
    return Object.freeze({ authorizations: Object.freeze(authorizations) });
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export const KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_CONTRACT = Object.freeze({
  bytes: FILE_BYTES,
  file: KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE,
  ownerGroupId: CONTROLLER_USER_ID,
  ownerUserId: CONTROLLER_USER_ID,
  tokenCount: TOKEN_COUNT,
});
