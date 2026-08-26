import { createHash, createHmac } from 'node:crypto';
import { constants } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN } from './kemerbet-agent-identity-fingerprint.js';
import {
  createKemerBetReadinessSameAgentIdentityVerifier,
  KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE,
  KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE,
  KEMERBET_READINESS_SAME_AGENT_IDENTITY_CONTRACT,
  KemerBetReadinessSameAgentIdentityUnavailableError,
  loadKemerBetReadinessSameAgentIdentityVerifier,
  type KemerBetReadinessAgentProfileResponse,
  type KemerBetReadinessSameAgentIdentityFileSystem,
} from './kemerbet-readiness-same-agent-identity.js';

const ACCOUNT_ONE = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_TWO = '22222222-2222-4222-8222-222222222222';
const USER_NAME = 'private-agent@example.invalid';
const HMAC_KEY = Buffer.from('33'.repeat(32), 'hex');
const HMAC_KEY_FILE = HMAC_KEY.toString('hex');
const AUTHORIZATION = 'Bearer abcdefghijklmnop.qrstuvwxyz012345.ABCDEFGHIJKLMNOP';
const OTHER_AUTHORIZATION = 'Bearer abcdefghijklmnop.qrstuvwxyz012345.DIFFERENTTOKEN';

function identityDigest(accountId: string, userName: string): string {
  return createHmac('sha256', HMAC_KEY)
    .update(KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN, 'utf8')
    .update(accountId, 'utf8')
    .update('\0', 'utf8')
    .update(userName, 'utf8')
    .digest('hex');
}

function bindingFile(
  accountId = ACCOUNT_ONE,
  userName = USER_NAME,
  digestAccountId = accountId,
): string {
  const digest = identityDigest(digestAccountId, userName);
  return `${accountId} hmac-sha256-agent-identity-v1:${digest} hmac-sha256-agent-profile-pin-v3:${digest}\n`;
}

function verifier(serializedBinding = bindingFile()) {
  const bindingInput = Buffer.from(serializedBinding, 'utf8');
  const keyInput = Buffer.from(HMAC_KEY_FILE, 'ascii');
  const result = createKemerBetReadinessSameAgentIdentityVerifier({
    bindingFile: bindingInput,
    hmacKeyFile: keyInput,
  });
  return { bindingInput, keyInput, result };
}

function profileResponse(
  body: Buffer = Buffer.from(
    JSON.stringify({ resultCode: 0, value: { userName: USER_NAME } }),
    'utf8',
  ),
  statusCode = 200,
  headers: Readonly<Record<string, string | readonly string[] | undefined>> = {},
): KemerBetReadinessAgentProfileResponse {
  return { body, headers, statusCode };
}

describe('KemerBet readiness trusted same-agent identity verifier', () => {
  it('validates Profile once, pins the complete bearer for all five lookups, and clears buffers', async () => {
    const test = verifier();
    expect([...test.bindingInput]).toEqual(new Array(test.bindingInput.length).fill(0));
    expect([...test.keyInput]).toEqual(new Array(test.keyInput.length).fill(0));
    expect(test.result.agentIdentityBindingSha256).toBe(
      createHash('sha256').update(bindingFile(), 'utf8').digest('hex'),
    );
    const profileBody = profileResponse().body;
    const loadProfile = vi.fn(async (exactAuthorization: string) => {
      expect(exactAuthorization).toBe(AUTHORIZATION);
      return profileResponse(profileBody, 200, { 'content-encoding': 'identity' });
    });

    await test.result.verify({ authorization: AUTHORIZATION, loadProfile });
    for (let sequence = 2; sequence <= 5; sequence += 1) {
      await test.result.verify({
        authorization: AUTHORIZATION,
        loadProfile: async () => {
          throw new Error('Profile must be fetched exactly once.');
        },
      });
    }

    expect(loadProfile).toHaveBeenCalledTimes(1);
    expect([...profileBody]).toEqual(new Array(profileBody.length).fill(0));
    test.result.destroy();
    await expect(
      test.result.verify({ authorization: AUTHORIZATION, loadProfile }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
  });

  it('rejects a compromised browser using a valid session for the wrong bound account', async () => {
    const privateBinding = bindingFile(ACCOUNT_TWO, USER_NAME, ACCOUNT_ONE);
    const test = verifier(privateBinding);
    const body = profileResponse().body;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let observed: unknown;
    try {
      await test.result.verify({
        authorization: AUTHORIZATION,
        loadProfile: async () => profileResponse(body),
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    const diagnostic = String(observed);
    expect(diagnostic).not.toContain(AUTHORIZATION);
    expect(diagnostic).not.toContain(USER_NAME);
    expect(diagnostic).not.toContain(ACCOUNT_ONE);
    expect(diagnostic).not.toContain(ACCOUNT_TWO);
    expect(diagnostic).not.toContain(identityDigest(ACCOUNT_ONE, USER_NAME));
    expect(log).not.toHaveBeenCalled();
    expect([...body]).toEqual(new Array(body.length).fill(0));
    log.mockRestore();

    const retryProfile = vi.fn(async () => profileResponse());
    await expect(
      test.result.verify({ authorization: AUTHORIZATION, loadProfile: retryProfile }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    expect(retryProfile).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'non-200',
      response: () => profileResponse(undefined, 401),
    },
    {
      name: 'gzip encoding',
      response: () => profileResponse(undefined, 200, { 'content-encoding': 'gzip' }),
    },
    {
      name: 'duplicate encoding',
      response: () =>
        profileResponse(undefined, 200, { 'content-encoding': ['identity', 'identity'] }),
    },
    {
      name: 'invalid UTF-8',
      response: () => profileResponse(Buffer.from([0xc3, 0x28])),
    },
    {
      name: 'UTF-8 BOM',
      response: () =>
        profileResponse(
          Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from('{"resultCode":0,"value":{"userName":"x"}}'),
          ]),
        ),
    },
    {
      name: 'NUL-bearing identity',
      response: () =>
        profileResponse(Buffer.from('{"resultCode":0,"value":{"userName":"x\\u0000y"}}')),
    },
    {
      name: 'oversized response',
      response: () => profileResponse(Buffer.alloc(64 * 1024 + 1, 0x20)),
    },
    {
      name: 'malformed JSON',
      response: () => profileResponse(Buffer.from('{', 'utf8')),
    },
    {
      name: 'non-success result',
      response: () =>
        profileResponse(
          Buffer.from(JSON.stringify({ resultCode: 1, value: { userName: USER_NAME } })),
        ),
    },
    {
      name: 'duplicate resultCode',
      response: () =>
        profileResponse(
          Buffer.from(`{"resultCode":0,"resultCode":0,"value":{"userName":"${USER_NAME}"}}`),
        ),
    },
    {
      name: 'escaped duplicate userName',
      response: () =>
        profileResponse(
          Buffer.from(
            `{"resultCode":0,"value":{"userName":"${USER_NAME}","user\\u004eame":"${USER_NAME}"}}`,
          ),
        ),
    },
    {
      name: 'negative-zero result',
      response: () => profileResponse(Buffer.from('{"resultCode":-0,"value":{"userName":"x"}}')),
    },
    {
      name: 'non-plain value',
      response: () => profileResponse(Buffer.from('{"resultCode":0,"value":[]}')),
    },
    {
      name: 'missing userName',
      response: () => profileResponse(Buffer.from('{"resultCode":0,"value":{}}')),
    },
    {
      name: 'untrimmed userName',
      response: () => profileResponse(Buffer.from('{"resultCode":0,"value":{"userName":" x"}}')),
    },
    {
      name: 'oversized userName',
      response: () =>
        profileResponse(
          Buffer.from(JSON.stringify({ resultCode: 0, value: { userName: 'x'.repeat(257) } })),
        ),
    },
  ])('fails sticky-closed on a $name Profile response', async ({ response }) => {
    const test = verifier();
    const firstResponse = response();
    await expect(
      test.result.verify({
        authorization: AUTHORIZATION,
        loadProfile: async () => firstResponse,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    expect([...firstResponse.body]).toEqual(new Array(firstResponse.body.length).fill(0));
    const retry = vi.fn(async () => profileResponse());
    await expect(
      test.result.verify({ authorization: AUTHORIZATION, loadProfile: retry }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    expect(retry).not.toHaveBeenCalled();
  });

  it('makes a full-bearer drift after validation sticky-fatal without another Profile call', async () => {
    const test = verifier();
    const firstProfile = vi.fn(async () => profileResponse());
    await test.result.verify({ authorization: AUTHORIZATION, loadProfile: firstProfile });
    const unexpectedProfile = vi.fn(async () => profileResponse());
    await expect(
      test.result.verify({
        authorization: OTHER_AUTHORIZATION,
        loadProfile: unexpectedProfile,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    expect(firstProfile).toHaveBeenCalledTimes(1);
    expect(unexpectedProfile).not.toHaveBeenCalled();
    await expect(
      test.result.verify({ authorization: AUTHORIZATION, loadProfile: unexpectedProfile }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
  });

  it('accepts a fresh bearer for the same stable Profile identity and pins it for this run', async () => {
    const test = verifier();
    const loadProfile = vi.fn(async (exactAuthorization: string) => {
      expect(exactAuthorization).toBe(OTHER_AUTHORIZATION);
      return profileResponse();
    });
    await expect(
      test.result.verify({ authorization: OTHER_AUTHORIZATION, loadProfile }),
    ).resolves.toBeUndefined();
    await expect(
      test.result.verify({
        authorization: OTHER_AUTHORIZATION,
        loadProfile: async () => {
          throw new Error('Profile must be fetched exactly once.');
        },
      }),
    ).resolves.toBeUndefined();
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it('makes concurrent first validations race-fatal and never validates either request', async () => {
    const test = verifier();
    let releaseProfile: ((response: KemerBetReadinessAgentProfileResponse) => void) | undefined;
    const loadProfile = vi.fn(
      async () =>
        new Promise<KemerBetReadinessAgentProfileResponse>((resolvePromise) => {
          releaseProfile = resolvePromise;
        }),
    );
    const first = test.result.verify({ authorization: AUTHORIZATION, loadProfile });
    await vi.waitFor(() => expect(loadProfile).toHaveBeenCalledTimes(1));
    await expect(
      test.result.verify({ authorization: AUTHORIZATION, loadProfile }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    const body = profileResponse().body;
    releaseProfile?.(profileResponse(body));
    await expect(first).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    expect([...body]).toEqual(new Array(body.length).fill(0));
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it('makes an explicit reservation abort/disconnect sticky-fatal while Profile is pending', async () => {
    const test = verifier();
    let releaseProfile: ((response: KemerBetReadinessAgentProfileResponse) => void) | undefined;
    const first = test.result.verify({
      authorization: AUTHORIZATION,
      loadProfile: async () =>
        new Promise<KemerBetReadinessAgentProfileResponse>((resolvePromise) => {
          releaseProfile = resolvePromise;
        }),
    });
    await vi.waitFor(() => expect(releaseProfile).toBeTypeOf('function'));
    test.result.fail();
    const body = profileResponse().body;
    releaseProfile?.(profileResponse(body));
    await expect(first).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    expect([...body]).toEqual(new Array(body.length).fill(0));
  });

  it('requires one canonical binding line with LF and always zeros rejected input files', () => {
    for (const serializedBinding of [
      bindingFile().slice(0, -1),
      `${bindingFile()}${bindingFile()}`,
      bindingFile().replace('hmac-sha256', 'HMAC-SHA256'),
      bindingFile().replace(/ hmac-sha256-agent-profile-pin-v3:[0-9a-f]{64}/u, ''),
      bindingFile().replace('hmac-sha256-agent-profile-pin-v3', 'hmac-sha256-agent-profile-pin-v2'),
      bindingFile().replace(
        /hmac-sha256-agent-profile-pin-v3:[0-9a-f]{64}/u,
        `hmac-sha256-agent-profile-pin-v3:${'f'.repeat(64)}`,
      ),
      bindingFile().replace(
        /hmac-sha256-agent-profile-pin-v3:[0-9a-f]{64}/u,
        `sha256-provider-authorization-v1:${'f'.repeat(64)}`,
      ),
    ]) {
      const bindingInput = Buffer.from(serializedBinding, 'utf8');
      const keyInput = Buffer.from(HMAC_KEY_FILE, 'ascii');
      expect(() =>
        createKemerBetReadinessSameAgentIdentityVerifier({
          bindingFile: bindingInput,
          hmacKeyFile: keyInput,
        }),
      ).toThrow(KemerBetReadinessSameAgentIdentityUnavailableError);
      expect([...bindingInput]).toEqual(new Array(bindingInput.length).fill(0));
      expect([...keyInput]).toEqual(new Array(keyInput.length).fill(0));
    }
  });
});

interface FakeSecretEntry {
  readonly contents: Buffer;
  readonly dev: number;
  readonly gid: number;
  ino: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly uid: number;
}

function loaderFileSystem(options: {
  readonly binding?: string;
  readonly key?: string;
  readonly mutatePath?: string;
  readonly overrideGid?: number;
  readonly overrideMode?: number;
}) {
  const entries = new Map<string, FakeSecretEntry>([
    [
      KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE,
      {
        contents: Buffer.from(options.binding ?? bindingFile(), 'utf8'),
        dev: 1,
        gid: options.overrideGid ?? 10003,
        ino: 11,
        mode: options.overrideMode ?? 0o100400,
        mtimeMs: 1_000,
        nlink: 1,
        uid: 10003,
      },
    ],
    [
      KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE,
      {
        contents: Buffer.from(options.key ?? HMAC_KEY_FILE, 'ascii'),
        dev: 1,
        gid: options.overrideGid ?? 10003,
        ino: 12,
        mode: options.overrideMode ?? 0o100400,
        mtimeMs: 1_000,
        nlink: 1,
        uid: 10003,
      },
    ],
  ]);
  const observedFlags: number[] = [];
  const returnedBuffers: Buffer[] = [];
  const stat = (entry: FakeSecretEntry) => ({
    dev: entry.dev,
    gid: entry.gid,
    ino: entry.ino,
    mode: entry.mode,
    mtimeMs: entry.mtimeMs,
    nlink: entry.nlink,
    size: entry.contents.length,
    uid: entry.uid,
    isFile: () => true,
    isSymbolicLink: () => false,
  });
  const fileSystem: KemerBetReadinessSameAgentIdentityFileSystem = {
    lstat: async (path) => {
      const entry = entries.get(path);
      if (entry === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return stat(entry);
    },
    open: async (path, flags) => {
      observedFlags.push(flags);
      const entry = entries.get(path);
      if (entry === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return {
        close: async () => undefined,
        readFile: async () => {
          const result = Buffer.from(entry.contents);
          returnedBuffers.push(result);
          if (options.mutatePath === path) entry.ino += 1;
          return result;
        },
        stat: async () => stat(entry),
      };
    },
    realpath: async (path) => path,
  };
  return { fileSystem, observedFlags, returnedBuffers };
}

describe('KemerBet readiness proxy-only identity material loader', () => {
  it('loads only exact 10003:10003 0400 one-link files with O_NOFOLLOW', async () => {
    const fixture = loaderFileSystem({});
    const result = await loadKemerBetReadinessSameAgentIdentityVerifier({
      effectiveGroupId: 10003,
      effectiveUserId: 10003,
      fileSystem: fixture.fileSystem,
    });
    expect(result.agentIdentityBindingSha256).toBe(
      createHash('sha256').update(bindingFile(), 'utf8').digest('hex'),
    );
    expect(Buffer.byteLength(bindingFile(), 'utf8')).toBe(230);
    expect(fixture.observedFlags).toHaveLength(2);
    if (constants.O_NOFOLLOW !== undefined) {
      for (const flags of fixture.observedFlags) {
        expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      }
    }
    for (const returned of fixture.returnedBuffers) {
      expect([...returned]).toEqual(new Array(returned.length).fill(0));
    }
    expect(KEMERBET_READINESS_SAME_AGENT_IDENTITY_CONTRACT).toMatchObject({
      bindingFile: KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE,
      bindingFileBytes: 230,
      bindingVersion: 3,
      hmacKeyFile: KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE,
      ownerGroupId: 10003,
      ownerUserId: 10003,
      profileMethod: 'GET',
      profilePath: '/Account/Profile',
      profileSuccessResultCode: 0,
    });
    result.destroy();
  });

  it.each([
    ['wrong group', { overrideGid: 10001 }],
    ['writable mode', { overrideMode: 0o100600 }],
    ['missing binding LF', { binding: bindingFile().slice(0, -1) }],
    [
      'read-time inode replacement',
      { mutatePath: KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE },
    ],
  ] as const)('rejects %s', async (_name, options) => {
    const fixture = loaderFileSystem(options);
    await expect(
      loadKemerBetReadinessSameAgentIdentityVerifier({
        effectiveGroupId: 10003,
        effectiveUserId: 10003,
        fileSystem: fixture.fileSystem,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    for (const returned of fixture.returnedBuffers) {
      expect([...returned]).toEqual(new Array(returned.length).fill(0));
    }
  });

  it('rejects every non-proxy effective UID/GID before reading a secret', async () => {
    const fixture = loaderFileSystem({});
    await expect(
      loadKemerBetReadinessSameAgentIdentityVerifier({
        effectiveGroupId: 10003,
        effectiveUserId: 10001,
        fileSystem: fixture.fileSystem,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessSameAgentIdentityUnavailableError);
    expect(fixture.observedFlags).toHaveLength(0);
  });
});
