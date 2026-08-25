import { networkInterfaces } from 'node:os';
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE } from '@fetanagent/config/executor';

import {
  createKemerBetReadinessLayer7LookupAuthorization,
  KEMERBET_READINESS_AUTHORIZER_HMAC_KEY_FILE,
  KEMERBET_READINESS_AUTHORIZER_RUN_NONCE_FILE,
  loadKemerBetReadinessAuthorizerSigningMaterial,
  type KemerBetReadinessLayer7SigningMaterial,
} from './kemerbet-readiness-layer7-authorization.js';

const AUTHORIZER_USER_ID = 10004;
const OUTPUT_ROOT = '/run/output';
const OUTPUT_FILE = `${OUTPUT_ROOT}/authorizations`;
const INSTALLING_FILE = `${OUTPUT_ROOT}/.authorizations.installing`;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const TOKEN_PATTERN = /^v1\.[0-9a-f]{32}\.[1-5]\.[0-9a-f]{64}$/u;
const TOKEN_BYTES = 102;
const OUTPUT_BYTES = 5 * (TOKEN_BYTES + 1);

interface ExactStat {
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

export interface KemerBetReadinessAuthorizationPremintDependencies {
  readonly assertOfflineNetwork?: () => void;
  readonly effectiveGroupId?: number;
  readonly effectiveUserId?: number;
  readonly loadPlayerIds?: () => Promise<readonly string[]>;
  readonly loadSigningMaterial?: () => Promise<KemerBetReadinessLayer7SigningMaterial>;
  readonly writeAuthorizations?: (serialized: string) => Promise<void>;
}

export class KemerBetReadinessAuthorizationPremintUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness authorization premint is unavailable.');
    this.name = 'KemerBetReadinessAuthorizationPremintUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessAuthorizationPremintUnavailableError();
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function sameStat(left: ExactStat, right: ExactStat): boolean {
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

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    return unavailable();
  } catch (error) {
    if (!isMissing(error)) return unavailable();
  }
}

async function requireExactOutputDirectory(): Promise<void> {
  const before = (await lstat(OUTPUT_ROOT)) as ExactStat;
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== AUTHORIZER_USER_ID ||
    before.gid !== AUTHORIZER_USER_ID ||
    (before.mode & 0o777) !== 0o700 ||
    (await realpath(OUTPUT_ROOT)) !== OUTPUT_ROOT
  ) {
    return unavailable();
  }
  const after = (await lstat(OUTPUT_ROOT)) as ExactStat;
  if (!sameStat(before, after)) return unavailable();
}

/** Strictly load the one existing exact-five cohort without ever serializing it into output. */
export async function loadExactKemerBetReadinessPremintPlayerIds(): Promise<readonly string[]> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = (await handle.stat()) as ExactStat;
    const pathBefore = (await lstat(KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE)) as ExactStat;
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      !sameStat(before, pathBefore) ||
      before.uid !== 0 ||
      before.gid !== 0 ||
      (before.mode & 0o777) !== 0o444 ||
      before.nlink !== 1 ||
      before.size < 10 ||
      before.size > 325 ||
      (await realpath(KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE)) !==
        KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE
    ) {
      return unavailable();
    }
    const serialized = await handle.readFile({ encoding: 'utf8' });
    const after = (await handle.stat()) as ExactStat;
    const pathAfter = (await lstat(KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE)) as ExactStat;
    if (
      !sameStat(before, after) ||
      !sameStat(after, pathAfter) ||
      Buffer.byteLength(serialized, 'utf8') !== before.size ||
      !serialized.endsWith('\n') ||
      serialized.includes('\r') ||
      serialized.includes('\0')
    ) {
      return unavailable();
    }
    const playerIds = serialized.slice(0, -1).split('\n');
    if (
      playerIds.length !== 5 ||
      new Set(playerIds).size !== 5 ||
      playerIds.some((playerId) => !PLAYER_ID_PATTERN.test(playerId))
    ) {
      return unavailable();
    }
    return Object.freeze(playerIds);
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function serializeKemerBetReadinessPremintedAuthorizations(input: {
  readonly playerIds: readonly string[];
  readonly signingMaterial: KemerBetReadinessLayer7SigningMaterial;
}): string {
  if (
    input.playerIds.length !== 5 ||
    new Set(input.playerIds).size !== 5 ||
    input.playerIds.some((playerId) => !PLAYER_ID_PATTERN.test(playerId)) ||
    input.signingMaterial.hmacKey.length !== 32 ||
    input.signingMaterial.runNonce.length !== 16
  ) {
    return unavailable();
  }
  const tokens = input.playerIds.map((playerId, index) =>
    createKemerBetReadinessLayer7LookupAuthorization({
      hmacKey: input.signingMaterial.hmacKey,
      playerId,
      runNonce: input.signingMaterial.runNonce,
      sequence: index + 1,
    }),
  );
  if (tokens.some((token) => !TOKEN_PATTERN.test(token))) return unavailable();
  const serialized = `${tokens.join('\n')}\n`;
  if (Buffer.byteLength(serialized, 'utf8') !== OUTPUT_BYTES) {
    return unavailable();
  }
  return serialized;
}

export async function writeKemerBetReadinessPremintedAuthorizations(
  serialized: string,
): Promise<void> {
  if (
    Buffer.byteLength(serialized, 'utf8') !== OUTPUT_BYTES ||
    serialized.split('\n').length !== 6 ||
    serialized
      .slice(0, -1)
      .split('\n')
      .some(
        (token, index) => !TOKEN_PATTERN.test(token) || token.split('.')[2] !== String(index + 1),
      )
  ) {
    return unavailable();
  }
  await requireExactOutputDirectory();
  await requireAbsent(OUTPUT_FILE);
  await requireAbsent(INSTALLING_FILE);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let renamed = false;
  let complete = false;
  try {
    handle = await open(
      INSTALLING_FILE,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(serialized, { encoding: 'utf8' });
    await handle.sync();
    await handle.chmod(0o400);
    const written = (await handle.stat()) as ExactStat;
    if (
      !written.isFile() ||
      written.isSymbolicLink() ||
      written.uid !== AUTHORIZER_USER_ID ||
      written.gid !== AUTHORIZER_USER_ID ||
      (written.mode & 0o777) !== 0o400 ||
      written.nlink !== 1 ||
      written.size !== OUTPUT_BYTES
    ) {
      return unavailable();
    }
    await handle.close();
    handle = null;
    await requireAbsent(OUTPUT_FILE);
    await rename(INSTALLING_FILE, OUTPUT_FILE);
    renamed = true;
    const installed = (await lstat(OUTPUT_FILE)) as ExactStat;
    if (
      !installed.isFile() ||
      installed.isSymbolicLink() ||
      installed.uid !== AUTHORIZER_USER_ID ||
      installed.gid !== AUTHORIZER_USER_ID ||
      (installed.mode & 0o777) !== 0o400 ||
      installed.nlink !== 1 ||
      installed.size !== OUTPUT_BYTES ||
      (await realpath(OUTPUT_FILE)) !== OUTPUT_FILE
    ) {
      return unavailable();
    }
    const directory = await open(OUTPUT_ROOT, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    complete = true;
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(INSTALLING_FILE).catch(() => undefined);
    if (renamed && !complete) await unlink(OUTPUT_FILE).catch(() => undefined);
  }
}

function assertNoNetworkInterfaces(): void {
  const interfaces = networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (name !== 'lo' && (addresses ?? []).some((address) => !address.internal)) unavailable();
  }
}

export async function runKemerBetReadinessAuthorizationPremint(
  dependencies: KemerBetReadinessAuthorizationPremintDependencies = {},
): Promise<void> {
  const userId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  const groupId =
    dependencies.effectiveGroupId ??
    (typeof process.getegid === 'function' ? process.getegid() : Number.NaN);
  if (userId !== AUTHORIZER_USER_ID || groupId !== AUTHORIZER_USER_ID) return unavailable();
  (dependencies.assertOfflineNetwork ?? assertNoNetworkInterfaces)();
  const signingMaterial = await (
    dependencies.loadSigningMaterial ?? loadKemerBetReadinessAuthorizerSigningMaterial
  )();
  try {
    const playerIds = await (
      dependencies.loadPlayerIds ?? loadExactKemerBetReadinessPremintPlayerIds
    )();
    const serialized = serializeKemerBetReadinessPremintedAuthorizations({
      playerIds,
      signingMaterial,
    });
    await (dependencies.writeAuthorizations ?? writeKemerBetReadinessPremintedAuthorizations)(
      serialized,
    );
  } catch {
    return unavailable();
  } finally {
    signingMaterial.hmacKey.fill(0);
    signingMaterial.runNonce.fill(0);
  }
}

export const KEMERBET_READINESS_AUTHORIZATION_PREMINT_RUNTIME_CONTRACT = Object.freeze({
  command: Object.freeze([
    'node',
    'apps/executor/dist/kemerbet-readiness-authorization-premint.js',
  ]),
  environment: Object.freeze([]),
  groupId: AUTHORIZER_USER_ID,
  networkMode: 'none',
  output: Object.freeze({
    bytes: OUTPUT_BYTES,
    file: OUTPUT_FILE,
    installingFile: INSTALLING_FILE,
    mode: 0o400,
    schema: 'five LF-terminated v1.<nonce>.<sequence>.<mac> lines; no Player IDs',
  }),
  outputRoot: OUTPUT_ROOT,
  secretFiles: Object.freeze([
    KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,
    KEMERBET_READINESS_AUTHORIZER_HMAC_KEY_FILE,
    KEMERBET_READINESS_AUTHORIZER_RUN_NONCE_FILE,
  ]),
  userId: AUTHORIZER_USER_ID,
} as const);

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    await runKemerBetReadinessAuthorizationPremint();
  } catch {
    process.exitCode = 1;
  }
}
