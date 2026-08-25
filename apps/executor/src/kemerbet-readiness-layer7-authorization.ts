import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';

export const KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER =
  'x-fetanagent-readiness-authorization' as const;
export const KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE =
  '/run/secrets/kemerbet_readiness_proxy_hmac_key' as const;
export const KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE =
  '/run/secrets/kemerbet_readiness_proxy_run_nonce' as const;
export const KEMERBET_READINESS_LAYER7_RELEASE_SHA_FILE =
  '/run/secrets/kemerbet_readiness_release_sha' as const;
export const KEMERBET_READINESS_AUTHORIZER_HMAC_KEY_FILE =
  '/run/secrets/kemerbet_readiness_authorizer_hmac_key' as const;
export const KEMERBET_READINESS_AUTHORIZER_RUN_NONCE_FILE =
  '/run/secrets/kemerbet_readiness_authorizer_run_nonce' as const;
export const KEMERBET_READINESS_LAYER7_AUTHORIZATION_DOMAIN =
  'fetanagent-kemerbet-readiness-proxy-v1' as const;
export const KEMERBET_READINESS_LAYER7_LOOKUP_HOSTNAME = 'admin-api.agt-digi.com' as const;
export const KEMERBET_READINESS_LAYER7_LOOKUP_PATH = '/Player/GeneralInfoByExternalId' as const;

const PROXY_USER_ID = 10003;
const AUTHORIZER_USER_ID = 10004;
const KEY_PATTERN = /^[0-9a-f]{64}\n$/u;
const NONCE_PATTERN = /^[0-9a-f]{32}\n$/u;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}\n$/u;
const AUTHORIZATION_PATTERN = /^v1\.([0-9a-f]{32})\.([1-5])\.([0-9a-f]{64})$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

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

export interface KemerBetReadinessLayer7AuthorizationFileSystem {
  lstat(path: string): Promise<AuthorizationStat>;
  open(path: string, flags: number): Promise<Awaited<ReturnType<typeof open>>>;
  realpath(path: string): Promise<string>;
}

export interface KemerBetReadinessLayer7SigningMaterial {
  readonly hmacKey: Buffer;
  readonly runNonce: Buffer;
}

export interface KemerBetReadinessLayer7AuthorizationMaterial extends KemerBetReadinessLayer7SigningMaterial {
  readonly releaseSha: string;
}

export interface KemerBetReadinessLayer7AuthorizationReservation {
  readonly playerId: string;
  readonly sequence: 1 | 2 | 3 | 4 | 5;
}

export interface KemerBetReadinessLayer7AuthorizationCompletion {
  readonly allCompleted: boolean;
  readonly completedSequence: 1 | 2 | 3 | 4 | 5;
}

export interface KemerBetReadinessLayer7AuthorizationVerifier {
  readonly releaseSha: string;
  readonly runNonceSha256: string;
  abort(reservation: KemerBetReadinessLayer7AuthorizationReservation): void;
  complete(
    reservation: KemerBetReadinessLayer7AuthorizationReservation,
  ): KemerBetReadinessLayer7AuthorizationCompletion | null;
  destroy(): void;
  reserve(input: {
    readonly authorization: string;
    readonly hostname: string;
    readonly method: string;
    readonly path: string;
  }): KemerBetReadinessLayer7AuthorizationReservation | null;
}

export class KemerBetReadinessLayer7AuthorizationUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness Layer-7 authorization is unavailable.');
    this.name = 'KemerBetReadinessLayer7AuthorizationUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessLayer7AuthorizationUnavailableError();
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

const productionFileSystem: KemerBetReadinessLayer7AuthorizationFileSystem = {
  lstat: async (path) => (await lstat(path)) as AuthorizationStat,
  open,
  realpath,
};

async function readExactOwnedSecret(options: {
  readonly expectedBytes: number;
  readonly fileSystem: KemerBetReadinessLayer7AuthorizationFileSystem;
  readonly ownerGroupId: number;
  readonly ownerUserId: number;
  readonly path: string;
  readonly pattern: RegExp;
}): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await options.fileSystem.open(
      options.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = (await handle.stat()) as AuthorizationStat;
    const pathBefore = await options.fileSystem.lstat(options.path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      !sameStat(before, pathBefore) ||
      before.uid !== options.ownerUserId ||
      before.gid !== options.ownerGroupId ||
      (before.mode & 0o777) !== 0o400 ||
      before.nlink !== 1 ||
      before.size !== options.expectedBytes ||
      (await options.fileSystem.realpath(options.path)) !== options.path
    ) {
      return unavailable();
    }
    const serialized = await handle.readFile({ encoding: 'utf8' });
    const after = (await handle.stat()) as AuthorizationStat;
    const pathAfter = await options.fileSystem.lstat(options.path);
    if (
      !sameStat(before, after) ||
      !sameStat(after, pathAfter) ||
      pathAfter.isSymbolicLink() ||
      Buffer.byteLength(serialized, 'utf8') !== options.expectedBytes ||
      !options.pattern.test(serialized)
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

async function loadSigningMaterial(options: {
  readonly fileSystem: KemerBetReadinessLayer7AuthorizationFileSystem;
  readonly hmacKeyFile: string;
  readonly ownerGroupId: number;
  readonly ownerUserId: number;
  readonly runNonceFile: string;
}): Promise<KemerBetReadinessLayer7SigningMaterial> {
  let hmacKey: Buffer | null = null;
  let runNonce: Buffer | null = null;
  try {
    hmacKey = Buffer.from(
      await readExactOwnedSecret({
        expectedBytes: 65,
        fileSystem: options.fileSystem,
        ownerGroupId: options.ownerGroupId,
        ownerUserId: options.ownerUserId,
        path: options.hmacKeyFile,
        pattern: KEY_PATTERN,
      }),
      'hex',
    );
    runNonce = Buffer.from(
      await readExactOwnedSecret({
        expectedBytes: 33,
        fileSystem: options.fileSystem,
        ownerGroupId: options.ownerGroupId,
        ownerUserId: options.ownerUserId,
        path: options.runNonceFile,
        pattern: NONCE_PATTERN,
      }),
      'hex',
    );
    return Object.freeze({ hmacKey, runNonce });
  } catch {
    hmacKey?.fill(0);
    runNonce?.fill(0);
    return unavailable();
  }
}

/** Load the proxy-only verifier material. These inodes are never mounted in the authorizer. */
export async function loadKemerBetReadinessLayer7AuthorizationMaterial(
  options: {
    readonly fileSystem?: KemerBetReadinessLayer7AuthorizationFileSystem;
  } = {},
): Promise<KemerBetReadinessLayer7AuthorizationMaterial> {
  const fileSystem = options.fileSystem ?? productionFileSystem;
  const signing = await loadSigningMaterial({
    fileSystem,
    hmacKeyFile: KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE,
    ownerGroupId: PROXY_USER_ID,
    ownerUserId: PROXY_USER_ID,
    runNonceFile: KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE,
  });
  try {
    const releaseSha = await readExactOwnedSecret({
      expectedBytes: 41,
      fileSystem,
      ownerGroupId: PROXY_USER_ID,
      ownerUserId: PROXY_USER_ID,
      path: KEMERBET_READINESS_LAYER7_RELEASE_SHA_FILE,
      pattern: RELEASE_SHA_PATTERN,
    });
    return Object.freeze({ ...signing, releaseSha });
  } catch {
    signing.hmacKey.fill(0);
    signing.runNonce.fill(0);
    return unavailable();
  }
}

/** Load the physically separate authorizer-only signing copies. */
export async function loadKemerBetReadinessAuthorizerSigningMaterial(
  options: {
    readonly fileSystem?: KemerBetReadinessLayer7AuthorizationFileSystem;
  } = {},
): Promise<KemerBetReadinessLayer7SigningMaterial> {
  return loadSigningMaterial({
    fileSystem: options.fileSystem ?? productionFileSystem,
    hmacKeyFile: KEMERBET_READINESS_AUTHORIZER_HMAC_KEY_FILE,
    ownerGroupId: AUTHORIZER_USER_ID,
    ownerUserId: AUTHORIZER_USER_ID,
    runNonceFile: KEMERBET_READINESS_AUTHORIZER_RUN_NONCE_FILE,
  });
}

function exactLookupPath(playerId: string): string {
  if (!PLAYER_ID_PATTERN.test(playerId)) return unavailable();
  return `${KEMERBET_READINESS_LAYER7_LOOKUP_PATH}?externalId=${playerId}`;
}

function canonicalAuthorizationInput(input: {
  readonly nonceHex: string;
  readonly path: string;
  readonly sequence: number;
}): string {
  return `${KEMERBET_READINESS_LAYER7_AUTHORIZATION_DOMAIN}\n${input.nonceHex}\n${input.sequence}\nGET\n${KEMERBET_READINESS_LAYER7_LOOKUP_HOSTNAME}\n${input.path}`;
}

export function isKemerBetReadinessLayer7Authorization(value: unknown): value is string {
  return typeof value === 'string' && AUTHORIZATION_PATTERN.test(value);
}

/** Pure authorizer-side helper for one exact ID/sequence-bound lookup token. */
export function createKemerBetReadinessLayer7LookupAuthorization(input: {
  readonly hmacKey: Buffer;
  readonly playerId: string;
  readonly runNonce: Buffer;
  readonly sequence: number;
}): string {
  if (
    input.hmacKey.length !== 32 ||
    input.runNonce.length !== 16 ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1 ||
    input.sequence > 5
  ) {
    return unavailable();
  }
  const nonceHex = input.runNonce.toString('hex');
  const path = exactLookupPath(input.playerId);
  const mac = createHmac('sha256', input.hmacKey)
    .update(canonicalAuthorizationInput({ nonceHex, path, sequence: input.sequence }), 'utf8')
    .digest('hex');
  return `v1.${nonceHex}.${input.sequence}.${mac}`;
}

/**
 * Proxy-side state machine. A valid token is reserved synchronously before any upstream await;
 * only the exact reservation can complete, while any abort/invalid/duplicate path is sticky-fatal.
 */
export function createKemerBetReadinessLayer7AuthorizationVerifier(
  material: KemerBetReadinessLayer7AuthorizationMaterial,
): KemerBetReadinessLayer7AuthorizationVerifier {
  if (
    material.hmacKey.length !== 32 ||
    material.runNonce.length !== 16 ||
    !/^[0-9a-f]{40}$/u.test(material.releaseSha)
  ) {
    return unavailable();
  }
  const hmacKey = Buffer.from(material.hmacKey);
  const runNonce = Buffer.from(material.runNonce);
  const configuredNonceHex = runNonce.toString('hex');
  const runNonceSha256 = createHash('sha256').update(runNonce).digest('hex');
  let nextSequence = 1;
  let active: KemerBetReadinessLayer7AuthorizationReservation | null = null;
  let destroyed = false;
  let failed = false;

  const fail = (): void => {
    failed = true;
    active = null;
  };

  return Object.freeze({
    releaseSha: material.releaseSha,
    runNonceSha256,
    reserve: (input: {
      readonly authorization: string;
      readonly hostname: string;
      readonly method: string;
      readonly path: string;
    }) => {
      if (destroyed || failed || active !== null || nextSequence > 5) {
        fail();
        return null;
      }
      const parsed = isKemerBetReadinessLayer7Authorization(input.authorization)
        ? AUTHORIZATION_PATTERN.exec(input.authorization)
        : null;
      const candidateNonceHex = parsed?.[1] ?? '0'.repeat(32);
      const candidateSequence = Number(parsed?.[2] ?? 0);
      const candidateMac = Buffer.from(parsed?.[3] ?? '0'.repeat(64), 'hex');
      const candidateNonce = Buffer.from(candidateNonceHex, 'hex');
      const expectedMac = createHmac('sha256', hmacKey)
        .update(
          canonicalAuthorizationInput({
            nonceHex: configuredNonceHex,
            path: input.path,
            sequence: candidateSequence,
          }),
          'utf8',
        )
        .digest();
      const prefix = `${KEMERBET_READINESS_LAYER7_LOOKUP_PATH}?externalId=`;
      const playerId = input.path.startsWith(prefix) ? input.path.slice(prefix.length) : '';
      const pathIsExact = PLAYER_ID_PATTERN.test(playerId) && input.path === `${prefix}${playerId}`;
      const nonceIsExact =
        candidateNonce.length === runNonce.length && timingSafeEqual(candidateNonce, runNonce);
      const macIsExact =
        candidateMac.length === expectedMac.length && timingSafeEqual(candidateMac, expectedMac);
      const exact =
        parsed !== null &&
        input.method === 'GET' &&
        input.hostname === KEMERBET_READINESS_LAYER7_LOOKUP_HOSTNAME &&
        pathIsExact &&
        candidateSequence === nextSequence &&
        nonceIsExact &&
        macIsExact;
      candidateNonce.fill(0);
      candidateMac.fill(0);
      expectedMac.fill(0);
      if (!exact) {
        fail();
        return null;
      }
      const reservation = Object.freeze({
        playerId,
        sequence: candidateSequence as 1 | 2 | 3 | 4 | 5,
      });
      active = reservation;
      return reservation;
    },
    complete: (reservation: KemerBetReadinessLayer7AuthorizationReservation) => {
      if (destroyed || failed || active !== reservation || reservation.sequence !== nextSequence) {
        fail();
        return null;
      }
      active = null;
      nextSequence += 1;
      return Object.freeze({
        allCompleted: nextSequence === 6,
        completedSequence: reservation.sequence,
      });
    },
    abort: (reservation: KemerBetReadinessLayer7AuthorizationReservation) => {
      if (active !== reservation) {
        fail();
        return;
      }
      fail();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      failed = true;
      active = null;
      hmacKey.fill(0);
      runNonce.fill(0);
    },
  });
}

export const KEMERBET_READINESS_LAYER7_AUTHORIZATION_CONTRACT = Object.freeze({
  authorizerHmacKeyFile: KEMERBET_READINESS_AUTHORIZER_HMAC_KEY_FILE,
  authorizerOwnerGroupId: AUTHORIZER_USER_ID,
  authorizerOwnerUserId: AUTHORIZER_USER_ID,
  authorizerRunNonceFile: KEMERBET_READINESS_AUTHORIZER_RUN_NONCE_FILE,
  domain: KEMERBET_READINESS_LAYER7_AUTHORIZATION_DOMAIN,
  header: KEMERBET_READINESS_LAYER7_AUTHORIZATION_HEADER,
  hmacKeyFile: KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE,
  lookupHostname: KEMERBET_READINESS_LAYER7_LOOKUP_HOSTNAME,
  lookupPath: KEMERBET_READINESS_LAYER7_LOOKUP_PATH,
  maximumSequence: 5,
  proxyOwnerGroupId: PROXY_USER_ID,
  proxyOwnerUserId: PROXY_USER_ID,
  releaseShaFile: KEMERBET_READINESS_LAYER7_RELEASE_SHA_FILE,
  runNonceFile: KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE,
});
