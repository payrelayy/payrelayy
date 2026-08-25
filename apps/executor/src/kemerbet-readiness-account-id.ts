import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';

export const KEMERBET_READINESS_ACCOUNT_ID_FILE =
  '/run/secrets/kemerbet_readiness_account_id' as const;

const BROWSER_USER_ID = 10001;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/u;

interface AccountIdStat {
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

export interface KemerBetReadinessAccountIdFileSystem {
  lstat(path: string): Promise<AccountIdStat>;
  open(path: string, flags: number): Promise<Awaited<ReturnType<typeof open>>>;
  realpath(path: string): Promise<string>;
}

export class KemerBetReadinessAccountIdUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness account identity is unavailable.');
    this.name = 'KemerBetReadinessAccountIdUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessAccountIdUnavailableError();
}

function sameStat(left: AccountIdStat, right: AccountIdStat): boolean {
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

const productionFileSystem: KemerBetReadinessAccountIdFileSystem = {
  lstat: async (path) => (await lstat(path)) as AccountIdStat,
  open,
  realpath,
};

export async function loadKemerBetReadinessAccountId(
  options: {
    readonly effectiveUserId?: number;
    readonly fileSystem?: KemerBetReadinessAccountIdFileSystem;
  } = {},
): Promise<string> {
  const effectiveUserId =
    options.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (effectiveUserId !== BROWSER_USER_ID) unavailable();
  const fileSystem = options.fileSystem ?? productionFileSystem;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await fileSystem.open(
      KEMERBET_READINESS_ACCOUNT_ID_FILE,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = (await handle.stat()) as AccountIdStat;
    const pathBefore = await fileSystem.lstat(KEMERBET_READINESS_ACCOUNT_ID_FILE);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      !sameStat(before, pathBefore) ||
      before.uid !== BROWSER_USER_ID ||
      before.gid !== BROWSER_USER_ID ||
      (before.mode & 0o777) !== 0o400 ||
      before.nlink !== 1 ||
      before.size !== 37 ||
      (await fileSystem.realpath(KEMERBET_READINESS_ACCOUNT_ID_FILE)) !==
        KEMERBET_READINESS_ACCOUNT_ID_FILE
    ) {
      unavailable();
    }
    const serialized = await handle.readFile({ encoding: 'utf8' });
    const after = (await handle.stat()) as AccountIdStat;
    const pathAfter = await fileSystem.lstat(KEMERBET_READINESS_ACCOUNT_ID_FILE);
    if (
      !sameStat(before, after) ||
      !sameStat(after, pathAfter) ||
      pathAfter.isSymbolicLink() ||
      !UUID_PATTERN.test(serialized)
    ) {
      unavailable();
    }
    return serialized.slice(0, -1);
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export const KEMERBET_READINESS_ACCOUNT_ID_CONTRACT = Object.freeze({
  bytes: 37,
  file: KEMERBET_READINESS_ACCOUNT_ID_FILE,
  ownerGroupId: BROWSER_USER_ID,
  ownerUserId: BROWSER_USER_ID,
});
