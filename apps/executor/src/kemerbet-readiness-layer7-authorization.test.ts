import { createHash, createHmac } from 'node:crypto';
import { constants } from 'node:fs';
import type { open } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  createKemerBetReadinessLayer7AuthorizationVerifier,
  createKemerBetReadinessLayer7LookupAuthorization,
  isKemerBetReadinessLayer7Authorization,
  KEMERBET_READINESS_AUTHORIZER_HMAC_KEY_FILE,
  KEMERBET_READINESS_AUTHORIZER_RUN_NONCE_FILE,
  KEMERBET_READINESS_LAYER7_AUTHORIZATION_CONTRACT,
  KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE,
  KEMERBET_READINESS_LAYER7_RELEASE_SHA_FILE,
  KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE,
  KemerBetReadinessLayer7AuthorizationUnavailableError,
  loadKemerBetReadinessAuthorizerSigningMaterial,
  loadKemerBetReadinessLayer7AuthorizationMaterial,
  type KemerBetReadinessLayer7AuthorizationFileSystem,
} from './kemerbet-readiness-layer7-authorization.js';

const HMAC_KEY_HEX = '11'.repeat(32);
const RUN_NONCE_HEX = '22'.repeat(16);
const RELEASE_SHA = 'a'.repeat(40);
const HMAC_KEY = Buffer.from(HMAC_KEY_HEX, 'hex');
const RUN_NONCE = Buffer.from(RUN_NONCE_HEX, 'hex');
const PLAYER_ONE = 'PLAYER-ALPHA';
const PLAYER_TWO = 'PLAYER-BRAVO';
const LOOKUP_PATH = '/Player/GeneralInfoByExternalId';
const LOOKUP_HOST = 'admin-api.agt-digi.com';

interface FakeEntry {
  content: string;
  dev: number;
  gid: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
}

function fakeAuthorizationFileSystem(
  options: {
    readonly mutateDuringReadPath?: string;
    readonly overridePath?: string;
    readonly override?: Partial<FakeEntry>;
  } = {},
): {
  readonly fileSystem: KemerBetReadinessLayer7AuthorizationFileSystem;
  readonly observedOpenFlags: number[];
} {
  const entry = (content: string, ino: number, uid: number): FakeEntry => ({
    content,
    dev: 1,
    gid: uid,
    ino,
    mode: 0o100400,
    nlink: 1,
    uid,
    ...(options.overridePath === undefined ? options.override : {}),
  });
  const entries = new Map<string, FakeEntry>([
    [KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE, entry(`${HMAC_KEY_HEX}\n`, 1, 10003)],
    [KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE, entry(`${RUN_NONCE_HEX}\n`, 2, 10003)],
    [KEMERBET_READINESS_LAYER7_RELEASE_SHA_FILE, entry(`${RELEASE_SHA}\n`, 3, 10003)],
    [KEMERBET_READINESS_AUTHORIZER_HMAC_KEY_FILE, entry(`${HMAC_KEY_HEX}\n`, 4, 10004)],
    [KEMERBET_READINESS_AUTHORIZER_RUN_NONCE_FILE, entry(`${RUN_NONCE_HEX}\n`, 5, 10004)],
  ]);
  if (options.overridePath !== undefined) {
    const target = entries.get(options.overridePath);
    if (target !== undefined) Object.assign(target, options.override);
  }
  const observedOpenFlags: number[] = [];
  const stat = (value: FakeEntry) => ({
    dev: value.dev,
    gid: value.gid,
    ino: value.ino,
    mode: value.mode,
    nlink: value.nlink,
    size: Buffer.byteLength(value.content, 'utf8'),
    uid: value.uid,
    isFile: () => true,
    isSymbolicLink: () => false,
  });
  const fileSystem: KemerBetReadinessLayer7AuthorizationFileSystem = {
    lstat: async (path) => {
      const value = entries.get(path);
      if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return stat(value);
    },
    open: async (path, flags) => {
      observedOpenFlags.push(flags);
      const value = entries.get(path);
      if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return {
        close: async () => undefined,
        readFile: async () => {
          const content = value.content;
          if (options.mutateDuringReadPath === path) value.ino += 100;
          return content;
        },
        stat: async () => stat(value),
      } as unknown as Awaited<ReturnType<typeof open>>;
    },
    realpath: async (path) => path,
  };
  return { fileSystem, observedOpenFlags };
}

function verifier() {
  return createKemerBetReadinessLayer7AuthorizationVerifier({
    hmacKey: HMAC_KEY,
    releaseSha: RELEASE_SHA,
    runNonce: RUN_NONCE,
  });
}

function token(sequence: number, playerId: string): string {
  return createKemerBetReadinessLayer7LookupAuthorization({
    hmacKey: HMAC_KEY,
    playerId,
    runNonce: RUN_NONCE,
    sequence,
  });
}

describe('KemerBet readiness Layer-7 authorization', () => {
  it('uses the frozen canonical request and compact token contract', () => {
    expect(KEMERBET_READINESS_LAYER7_AUTHORIZATION_CONTRACT).toMatchObject({
      authorizerHmacKeyFile: '/run/secrets/kemerbet_readiness_authorizer_hmac_key',
      authorizerOwnerUserId: 10004,
      authorizerRunNonceFile: '/run/secrets/kemerbet_readiness_authorizer_run_nonce',
      domain: 'fetanagent-kemerbet-readiness-proxy-v1',
      header: 'x-fetanagent-readiness-authorization',
      hmacKeyFile: '/run/secrets/kemerbet_readiness_proxy_hmac_key',
      lookupHostname: LOOKUP_HOST,
      lookupPath: LOOKUP_PATH,
      maximumSequence: 5,
      proxyOwnerUserId: 10003,
      releaseShaFile: '/run/secrets/kemerbet_readiness_release_sha',
      runNonceFile: '/run/secrets/kemerbet_readiness_proxy_run_nonce',
    });
    const path = `${LOOKUP_PATH}?externalId=${PLAYER_ONE}`;
    const canonical = `fetanagent-kemerbet-readiness-proxy-v1\n${RUN_NONCE_HEX}\n1\nGET\n${LOOKUP_HOST}\n${path}`;
    const expectedMac = createHmac('sha256', HMAC_KEY).update(canonical, 'utf8').digest('hex');
    expect(token(1, PLAYER_ONE)).toBe(`v1.${RUN_NONCE_HEX}.1.${expectedMac}`);
    expect(isKemerBetReadinessLayer7Authorization(token(1, PLAYER_ONE))).toBe(true);
  });

  it('serializes reservations by validated completion and binds the exact path and ID', () => {
    const state = verifier();
    expect(state.releaseSha).toBe(RELEASE_SHA);
    expect(state.runNonceSha256).toBe(createHash('sha256').update(RUN_NONCE).digest('hex'));
    const first = state.reserve({
      authorization: token(1, PLAYER_ONE),
      hostname: LOOKUP_HOST,
      method: 'GET',
      path: `${LOOKUP_PATH}?externalId=${PLAYER_ONE}`,
    });
    expect(first).toEqual({ playerId: PLAYER_ONE, sequence: 1 });
    expect(state.complete(first!)).toEqual({ allCompleted: false, completedSequence: 1 });
    const second = state.reserve({
      authorization: token(2, PLAYER_TWO),
      hostname: LOOKUP_HOST,
      method: 'GET',
      path: `${LOOKUP_PATH}?externalId=${PLAYER_TWO}`,
    });
    expect(second).toEqual({ playerId: PLAYER_TWO, sequence: 2 });
  });

  it('becomes sticky-fatal on an in-flight second request, abort, mismatch, or duplicate', () => {
    for (const corrupt of ['parallel', 'abort', 'mismatch'] as const) {
      const state = verifier();
      const first = state.reserve({
        authorization: token(1, PLAYER_ONE),
        hostname: LOOKUP_HOST,
        method: 'GET',
        path: `${LOOKUP_PATH}?externalId=${PLAYER_ONE}`,
      });
      expect(first).not.toBeNull();
      if (corrupt === 'parallel') {
        expect(
          state.reserve({
            authorization: token(2, PLAYER_TWO),
            hostname: LOOKUP_HOST,
            method: 'GET',
            path: `${LOOKUP_PATH}?externalId=${PLAYER_TWO}`,
          }),
        ).toBeNull();
      } else if (corrupt === 'abort') {
        state.abort(first!);
      } else {
        expect(state.complete({ playerId: PLAYER_ONE, sequence: 1 })).toBeNull();
      }
      expect(state.complete(first!)).toBeNull();
      expect(
        state.reserve({
          authorization: token(1, PLAYER_ONE),
          hostname: LOOKUP_HOST,
          method: 'GET',
          path: `${LOOKUP_PATH}?externalId=${PLAYER_ONE}`,
        }),
      ).toBeNull();
    }
  });

  it('makes one malformed or out-of-order token terminal and destroy is terminal', () => {
    for (const authorization of ['', token(2, PLAYER_TWO)]) {
      const state = verifier();
      expect(
        state.reserve({
          authorization,
          hostname: LOOKUP_HOST,
          method: 'GET',
          path: `${LOOKUP_PATH}?externalId=${PLAYER_TWO}`,
        }),
      ).toBeNull();
      expect(
        state.reserve({
          authorization: token(1, PLAYER_ONE),
          hostname: LOOKUP_HOST,
          method: 'GET',
          path: `${LOOKUP_PATH}?externalId=${PLAYER_ONE}`,
        }),
      ).toBeNull();
      state.destroy();
    }
  });

  it('loads distinct 10003 proxy and 10004 authorizer 0400 one-link material with O_NOFOLLOW', async () => {
    const fixture = fakeAuthorizationFileSystem();
    const proxy = await loadKemerBetReadinessLayer7AuthorizationMaterial({
      fileSystem: fixture.fileSystem,
    });
    expect(proxy.hmacKey.equals(HMAC_KEY)).toBe(true);
    expect(proxy.runNonce.equals(RUN_NONCE)).toBe(true);
    expect(proxy.releaseSha).toBe(RELEASE_SHA);
    const authorizer = await loadKemerBetReadinessAuthorizerSigningMaterial({
      fileSystem: fixture.fileSystem,
    });
    expect(authorizer.hmacKey.equals(HMAC_KEY)).toBe(true);
    expect(authorizer.runNonce.equals(RUN_NONCE)).toBe(true);
    expect(fixture.observedOpenFlags).toHaveLength(5);
    for (const flags of fixture.observedOpenFlags) {
      if (constants.O_NOFOLLOW !== undefined) {
        expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      }
    }
    proxy.hmacKey.fill(0);
    proxy.runNonce.fill(0);
    authorizer.hmacKey.fill(0);
    authorizer.runNonce.fill(0);
  });

  it('fails closed on unsafe metadata or a read-time inode replacement', async () => {
    await expect(
      loadKemerBetReadinessLayer7AuthorizationMaterial({
        fileSystem: fakeAuthorizationFileSystem({
          overridePath: KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE,
          override: { mode: 0o100444 },
        }).fileSystem,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessLayer7AuthorizationUnavailableError);
    await expect(
      loadKemerBetReadinessLayer7AuthorizationMaterial({
        fileSystem: fakeAuthorizationFileSystem({
          mutateDuringReadPath: KEMERBET_READINESS_LAYER7_RELEASE_SHA_FILE,
        }).fileSystem,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessLayer7AuthorizationUnavailableError);
  });
});
