import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { TextDecoder } from 'node:util';

import { KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN } from './kemerbet-agent-identity-fingerprint.js';

export const KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE =
  '/run/secrets/kemerbet_readiness_proxy_agent_identity_bindings' as const;
export const KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE =
  '/run/secrets/kemerbet_readiness_proxy_agent_identity_hmac_key' as const;
export const KEMERBET_READINESS_AGENT_PROFILE_PATH = '/Account/Profile' as const;

const PROXY_USER_ID = 10003;
const PROXY_GROUP_ID = 10003;
const MAXIMUM_PROFILE_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_USER_NAME_BYTES = 256;
const EXACT_BINDING_FILE_BYTES = 230;
const PROVIDER_AUTHORIZATION_PATTERN = /^Bearer [A-Za-z0-9._~+\/-]{16,4096}={0,2}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BINDING_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) hmac-sha256-agent-identity-v1:([0-9a-f]{64}) hmac-sha256-agent-profile-pin-v3:([0-9a-f]{64})\n$/u;
const HMAC_KEY_FILE_PATTERN = /^[0-9a-f]{64}$/u;

interface SameAgentIdentityFileStat {
  readonly dev: number | bigint;
  readonly gid: number;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetReadinessSameAgentIdentityFileHandle {
  close(): Promise<void>;
  readFile(): Promise<Buffer>;
  stat(): Promise<SameAgentIdentityFileStat>;
}

export interface KemerBetReadinessSameAgentIdentityFileSystem {
  lstat(path: string): Promise<SameAgentIdentityFileStat>;
  open(path: string, flags: number): Promise<KemerBetReadinessSameAgentIdentityFileHandle>;
  realpath(path: string): Promise<string>;
}

export interface KemerBetReadinessAgentProfileResponse {
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly statusCode: number;
}

export interface KemerBetReadinessSameAgentIdentityVerifier {
  readonly agentIdentityBindingSha256: string;
  destroy(): void;
  fail(): void;
  verify(input: {
    readonly authorization: string;
    readonly loadProfile: (
      exactAuthorization: string,
    ) => Promise<KemerBetReadinessAgentProfileResponse>;
  }): Promise<void>;
}

export class KemerBetReadinessSameAgentIdentityUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness same-agent identity boundary is unavailable.');
    this.name = 'KemerBetReadinessSameAgentIdentityUnavailableError';
  }
}

const productionFileSystem: KemerBetReadinessSameAgentIdentityFileSystem = {
  lstat: async (path) => (await lstat(path)) as SameAgentIdentityFileStat,
  open: async (path, flags) =>
    (await open(path, flags)) as unknown as KemerBetReadinessSameAgentIdentityFileHandle,
  realpath,
};

function unavailable(): never {
  throw new KemerBetReadinessSameAgentIdentityUnavailableError();
}

function sameStat(left: SameAgentIdentityFileStat, right: SameAgentIdentityFileStat): boolean {
  return (
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

function exactProxySecretStat(stat: SameAgentIdentityFileStat): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.uid === PROXY_USER_ID &&
    stat.gid === PROXY_GROUP_ID &&
    (stat.mode & 0o777) === 0o400 &&
    stat.nlink === 1 &&
    Number.isSafeInteger(stat.size) &&
    stat.size > 0 &&
    Number.isFinite(stat.mtimeMs)
  );
}

async function readExactProxySecret(input: {
  readonly expectedBytes?: number;
  readonly fileSystem: KemerBetReadinessSameAgentIdentityFileSystem;
  readonly maximumBytes: number;
  readonly path: string;
}): Promise<Buffer> {
  let handle: KemerBetReadinessSameAgentIdentityFileHandle | null = null;
  let contents: Buffer | null = null;
  try {
    const pathBefore = await input.fileSystem.lstat(input.path);
    if (
      !exactProxySecretStat(pathBefore) ||
      pathBefore.size > input.maximumBytes ||
      (input.expectedBytes !== undefined && pathBefore.size !== input.expectedBytes) ||
      (await input.fileSystem.realpath(input.path)) !== input.path
    ) {
      return unavailable();
    }
    handle = await input.fileSystem.open(
      input.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat();
    if (!exactProxySecretStat(opened) || !sameStat(pathBefore, opened)) return unavailable();
    contents = await handle.readFile();
    const openedAfterRead = await handle.stat();
    const pathAfterRead = await input.fileSystem.lstat(input.path);
    if (
      !sameStat(opened, openedAfterRead) ||
      !sameStat(openedAfterRead, pathAfterRead) ||
      pathAfterRead.isSymbolicLink() ||
      contents.length !== openedAfterRead.size
    ) {
      return unavailable();
    }
    const result = Buffer.from(contents);
    contents.fill(0);
    contents = null;
    return result;
  } catch {
    return unavailable();
  } finally {
    contents?.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

function decodeExactMaterial(input: {
  readonly bindingFile: Buffer;
  readonly hmacKeyFile: Buffer;
}): {
  readonly accountId: Buffer;
  readonly bindingFileSha256: string;
  readonly expectedAgentProfilePinDigest: Buffer;
  readonly hmacKey: Buffer;
} {
  let accountId: Buffer | null = null;
  let expectedIdentityDigest: Buffer | null = null;
  let expectedAgentProfilePinDigest: Buffer | null = null;
  let hmacKey: Buffer | null = null;
  try {
    const bindingText = input.bindingFile.toString('utf8');
    const hmacKeyText = input.hmacKeyFile.toString('ascii');
    const binding = BINDING_PATTERN.exec(bindingText);
    if (
      binding === null ||
      binding[1] === undefined ||
      binding[2] === undefined ||
      binding[3] === undefined ||
      !UUID_PATTERN.test(binding[1]) ||
      !HMAC_KEY_FILE_PATTERN.test(hmacKeyText)
    ) {
      return unavailable();
    }
    accountId = Buffer.from(binding[1], 'utf8');
    expectedIdentityDigest = Buffer.from(binding[2], 'hex');
    expectedAgentProfilePinDigest = Buffer.from(binding[3], 'hex');
    hmacKey = Buffer.from(hmacKeyText, 'hex');
    if (
      accountId.length !== 36 ||
      expectedIdentityDigest.length !== 32 ||
      expectedAgentProfilePinDigest.length !== 32 ||
      hmacKey.length !== 32 ||
      !timingSafeEqual(expectedIdentityDigest, expectedAgentProfilePinDigest)
    ) {
      return unavailable();
    }
    expectedIdentityDigest.fill(0);
    expectedIdentityDigest = null;
    return {
      accountId,
      bindingFileSha256: createHash('sha256').update(input.bindingFile).digest('hex'),
      expectedAgentProfilePinDigest,
      hmacKey,
    };
  } catch {
    accountId?.fill(0);
    expectedIdentityDigest?.fill(0);
    expectedAgentProfilePinDigest?.fill(0);
    hmacKey?.fill(0);
    return unavailable();
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function identityContentEncoding(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): boolean {
  const values: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'content-encoding' || value === undefined) continue;
    if (typeof value === 'string') values.push(value);
    else values.push(...value);
  }
  return values.length === 0 || (values.length === 1 && values[0] === 'identity');
}

/** Reject duplicate object keys before JSON.parse can silently keep only the last value. */
function hasOnlyUniqueJsonObjectKeys(serialized: string): boolean {
  let index = 0;
  const skipWhitespace = (): void => {
    while (/\s/u.test(serialized[index] ?? '') && /[\t\n\r ]/u.test(serialized[index] ?? '')) {
      index += 1;
    }
  };
  const parseString = (decode: boolean): { readonly ok: boolean; readonly value: string } => {
    if (serialized[index] !== '"') return { ok: false, value: '' };
    const start = index;
    index += 1;
    while (index < serialized.length) {
      const character = serialized[index] ?? '';
      if (character === '"') {
        index += 1;
        if (!decode) return { ok: true, value: '' };
        try {
          const value = JSON.parse(serialized.slice(start, index)) as unknown;
          return typeof value === 'string' ? { ok: true, value } : { ok: false, value: '' };
        } catch {
          return { ok: false, value: '' };
        }
      }
      if (character === '\\') {
        index += 1;
        const escape = serialized[index] ?? '';
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(serialized.slice(index + 1, index + 5))) {
            return { ok: false, value: '' };
          }
          index += 5;
          continue;
        }
        if (!/["\\/bfnrt]/u.test(escape)) return { ok: false, value: '' };
        index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) return { ok: false, value: '' };
      index += 1;
    }
    return { ok: false, value: '' };
  };
  const parseValue = (depth: number): boolean => {
    if (depth > 64) return false;
    skipWhitespace();
    const character = serialized[index];
    if (character === '"') return parseString(false).ok;
    if (character === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (serialized[index] === '}') {
        index += 1;
        return true;
      }
      while (index < serialized.length) {
        skipWhitespace();
        const key = parseString(true);
        if (!key.ok || keys.has(key.value)) return false;
        keys.add(key.value);
        skipWhitespace();
        if (serialized[index] !== ':') return false;
        index += 1;
        if (!parseValue(depth + 1)) return false;
        skipWhitespace();
        if (serialized[index] === '}') {
          index += 1;
          return true;
        }
        if (serialized[index] !== ',') return false;
        index += 1;
      }
      return false;
    }
    if (character === '[') {
      index += 1;
      skipWhitespace();
      if (serialized[index] === ']') {
        index += 1;
        return true;
      }
      while (index < serialized.length) {
        if (!parseValue(depth + 1)) return false;
        skipWhitespace();
        if (serialized[index] === ']') {
          index += 1;
          return true;
        }
        if (serialized[index] !== ',') return false;
        index += 1;
      }
      return false;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (serialized.startsWith(literal, index)) {
        index += literal.length;
        return true;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      serialized.slice(index),
    )?.[0];
    if (number === undefined) return false;
    index += number.length;
    return true;
  };
  try {
    if (!parseValue(0)) return false;
    skipWhitespace();
    return index === serialized.length;
  } catch {
    return false;
  }
}

function exactUserName(
  body: Buffer,
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Buffer {
  if (body.length < 1 || body.length > MAXIMUM_PROFILE_RESPONSE_BYTES) return unavailable();
  if (!identityContentEncoding(headers)) return unavailable();
  if (
    body.includes(0) ||
    (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf)
  ) {
    return unavailable();
  }
  let decoded: unknown;
  try {
    const serialized = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
    if (!hasOnlyUniqueJsonObjectKeys(serialized)) return unavailable();
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    return unavailable();
  }
  if (!plainRecord(decoded) || !Object.is(decoded.resultCode, 0) || !plainRecord(decoded.value)) {
    return unavailable();
  }
  const userName = decoded.value.userName;
  if (
    typeof userName !== 'string' ||
    userName.length < 1 ||
    userName !== userName.trim() ||
    /[\r\n\0]/u.test(userName)
  ) {
    return unavailable();
  }
  const encoded = Buffer.from(userName, 'utf8');
  if (encoded.length < 1 || encoded.length > MAXIMUM_USER_NAME_BYTES) {
    encoded.fill(0);
    return unavailable();
  }
  return encoded;
}

function bearerDigest(authorization: string): Buffer {
  if (!PROVIDER_AUTHORIZATION_PATTERN.test(authorization)) return unavailable();
  const encoded = Buffer.from(authorization, 'utf8');
  try {
    return createHash('sha256').update(encoded).digest();
  } finally {
    encoded.fill(0);
  }
}

/**
 * Consume exact proxy-only file bytes and build the one-run identity verifier. Both input buffers
 * are always zeroed before this function returns or throws.
 */
export function createKemerBetReadinessSameAgentIdentityVerifier(input: {
  readonly bindingFile: Buffer;
  readonly hmacKeyFile: Buffer;
}): KemerBetReadinessSameAgentIdentityVerifier {
  let material: ReturnType<typeof decodeExactMaterial> | null = null;
  try {
    if (!Buffer.isBuffer(input.bindingFile) || !Buffer.isBuffer(input.hmacKeyFile)) {
      return unavailable();
    }
    material = decodeExactMaterial(input);
  } finally {
    input.bindingFile.fill(0);
    input.hmacKeyFile.fill(0);
  }

  const accountId = material.accountId;
  const expectedAgentProfilePinDigest = material.expectedAgentProfilePinDigest;
  const hmacKey = material.hmacKey;
  const agentIdentityBindingSha256 = material.bindingFileSha256;
  let pinnedBearerDigest: Buffer | null = null;
  let state: 'unvalidated' | 'validating' | 'validated' | 'failed' | 'destroyed' = 'unvalidated';

  const eraseSecrets = (): void => {
    accountId.fill(0);
    expectedAgentProfilePinDigest.fill(0);
    hmacKey.fill(0);
    pinnedBearerDigest?.fill(0);
    pinnedBearerDigest = null;
  };
  const fail = (): void => {
    if (state === 'destroyed') return;
    state = 'failed';
    eraseSecrets();
  };

  const verifier: KemerBetReadinessSameAgentIdentityVerifier = {
    agentIdentityBindingSha256,
    destroy: () => {
      if (state === 'destroyed') return;
      eraseSecrets();
      state = 'destroyed';
    },
    fail,
    verify: async (verificationInput: {
      readonly authorization: string;
      readonly loadProfile: (
        exactAuthorization: string,
      ) => Promise<KemerBetReadinessAgentProfileResponse>;
    }) => {
      let candidateBearerDigest: Buffer | null = null;
      let profileResponse: KemerBetReadinessAgentProfileResponse | null = null;
      let userName: Buffer | null = null;
      let observedIdentityDigest: Buffer | null = null;
      try {
        candidateBearerDigest = bearerDigest(verificationInput.authorization);
        if (state === 'validated') {
          if (
            pinnedBearerDigest === null ||
            pinnedBearerDigest.length !== candidateBearerDigest.length ||
            !timingSafeEqual(pinnedBearerDigest, candidateBearerDigest)
          ) {
            fail();
            return unavailable();
          }
          return;
        }
        if (state !== 'unvalidated') {
          fail();
          return unavailable();
        }
        state = 'validating';
        const loadedProfileResponse = await verificationInput.loadProfile(
          verificationInput.authorization,
        );
        profileResponse = loadedProfileResponse;
        if (state !== 'validating') return unavailable();
        if (
          loadedProfileResponse.statusCode !== 200 ||
          !Number.isSafeInteger(loadedProfileResponse.statusCode) ||
          !Buffer.isBuffer(loadedProfileResponse.body)
        ) {
          fail();
          return unavailable();
        }
        userName = exactUserName(loadedProfileResponse.body, loadedProfileResponse.headers);
        observedIdentityDigest = createHmac('sha256', hmacKey)
          .update(KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN, 'utf8')
          .update(accountId)
          .update('\0', 'utf8')
          .update(userName)
          .digest();
        if (
          state !== 'validating' ||
          observedIdentityDigest.length !== expectedAgentProfilePinDigest.length ||
          !timingSafeEqual(observedIdentityDigest, expectedAgentProfilePinDigest)
        ) {
          fail();
          return unavailable();
        }
        pinnedBearerDigest = Buffer.from(candidateBearerDigest);
        state = 'validated';
      } catch {
        fail();
        return unavailable();
      } finally {
        candidateBearerDigest?.fill(0);
        profileResponse?.body.fill(0);
        userName?.fill(0);
        observedIdentityDigest?.fill(0);
      }
    },
  };
  return Object.freeze(verifier);
}

/** Load only two exact 10003:10003, 0400, one-link proxy identity files. */
export async function loadKemerBetReadinessSameAgentIdentityVerifier(
  options: {
    readonly effectiveGroupId?: number;
    readonly effectiveUserId?: number;
    readonly fileSystem?: KemerBetReadinessSameAgentIdentityFileSystem;
  } = {},
): Promise<KemerBetReadinessSameAgentIdentityVerifier> {
  const effectiveUserId =
    options.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  const effectiveGroupId =
    options.effectiveGroupId ??
    (typeof process.getegid === 'function' ? process.getegid() : Number.NaN);
  if (effectiveUserId !== PROXY_USER_ID || effectiveGroupId !== PROXY_GROUP_ID) {
    return unavailable();
  }
  const fileSystem = options.fileSystem ?? productionFileSystem;
  let bindingFile: Buffer | null = null;
  let hmacKeyFile: Buffer | null = null;
  try {
    bindingFile = await readExactProxySecret({
      expectedBytes: EXACT_BINDING_FILE_BYTES,
      fileSystem,
      maximumBytes: EXACT_BINDING_FILE_BYTES,
      path: KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE,
    });
    hmacKeyFile = await readExactProxySecret({
      expectedBytes: 64,
      fileSystem,
      maximumBytes: 64,
      path: KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE,
    });
    const verifier = createKemerBetReadinessSameAgentIdentityVerifier({
      bindingFile,
      hmacKeyFile,
    });
    bindingFile = null;
    hmacKeyFile = null;
    return verifier;
  } catch {
    return unavailable();
  } finally {
    bindingFile?.fill(0);
    hmacKeyFile?.fill(0);
  }
}

export const KEMERBET_READINESS_SAME_AGENT_IDENTITY_CONTRACT = Object.freeze({
  bindingFile: KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE,
  bindingFileDigest: 'sha256-of-exact-single-line-binding-file',
  bindingFileBytes: EXACT_BINDING_FILE_BYTES,
  bindingVersion: 3,
  hmacKeyFile: KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE,
  maximumProfileResponseBytes: MAXIMUM_PROFILE_RESPONSE_BYTES,
  maximumUserNameBytes: MAXIMUM_USER_NAME_BYTES,
  ownerGroupId: PROXY_GROUP_ID,
  ownerUserId: PROXY_USER_ID,
  profileMethod: 'GET',
  profilePath: KEMERBET_READINESS_AGENT_PROFILE_PATH,
  profileSuccessResultCode: 0,
} as const);
