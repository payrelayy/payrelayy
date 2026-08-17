import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createKemerBetAgentIdentityFingerprinter,
  KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN,
  KemerBetAgentIdentityFingerprintUnavailableError,
  type KemerBetAgentIdentitySecretFileSystem,
} from './kemerbet-agent-identity-fingerprint.js';
import { KEMERBET_HISTORY_REFERENCE_FINGERPRINT_DOMAIN } from './kemerbet-history-reference-fingerprint.js';

const secretPath = resolve('identity.key');
const secretHex = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const secretFileBytes = Buffer.from(secretHex, 'ascii');
const decodedSecret = Buffer.from(secretHex, 'hex');
const ACCOUNT_ONE = '44444444-4444-4444-8444-444444444441';
const ACCOUNT_TWO = '44444444-4444-4444-8444-444444444442';

function fixture(
  contents: Buffer = secretFileBytes,
  uid = 1_000,
  mode = 0o600,
  afterReadMtimeMs?: number,
) {
  const loaded = Buffer.from(contents);
  const stat = {
    size: loaded.length,
    mode,
    uid,
    dev: 1,
    ino: 2,
    mtimeMs: 1_000,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  const fileSystem: KemerBetAgentIdentitySecretFileSystem = {
    async lstat() {
      return stat;
    },
    async realpath() {
      return secretPath;
    },
    async open() {
      let statCalls = 0;
      return {
        async stat() {
          statCalls += 1;
          return statCalls > 1 && afterReadMtimeMs !== undefined
            ? { ...stat, mtimeMs: afterReadMtimeMs }
            : stat;
        },
        async readFile() {
          return loaded;
        },
        async close() {},
      };
    },
  };
  return { fileSystem, loaded };
}

describe('KemerBet signed-in agent identity fingerprint', () => {
  it('uses its own version and domain, distinct from history references', async () => {
    const test = fixture();
    const fingerprint = await createKemerBetAgentIdentityFingerprinter({
      secretFilePath: secretPath,
      fileSystem: test.fileSystem,
      platform: 'win32',
    });
    const rawIdentity = 'agent@example.invalid';
    const digest = createHmac('sha256', decodedSecret)
      .update(KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN)
      .update(ACCOUNT_ONE)
      .update('\0')
      .update(rawIdentity)
      .digest('hex');
    expect(fingerprint(ACCOUNT_ONE, rawIdentity)).toBe(`hmac-sha256-agent-identity-v1:${digest}`);
    expect(fingerprint(ACCOUNT_TWO, rawIdentity)).not.toBe(fingerprint(ACCOUNT_ONE, rawIdentity));
    expect(fingerprint.keyFingerprint).toBe(
      createHash('sha256').update(decodedSecret).digest('hex'),
    );
    expect(KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN).not.toBe(
      KEMERBET_HISTORY_REFERENCE_FINGERPRINT_DOMAIN,
    );
    expect([...test.loaded]).toEqual(new Array(secretFileBytes.length).fill(0));
  });

  it('rejects a copied profile identity under a different account UUID', async () => {
    const test = fixture();
    const fingerprint = await createKemerBetAgentIdentityFingerprinter({
      secretFilePath: secretPath,
      fileSystem: test.fileSystem,
      platform: 'win32',
    });
    const visibleIdentity = 'copied-profile@example.invalid';
    expect(fingerprint(ACCOUNT_ONE, visibleIdentity)).not.toBe(
      fingerprint(ACCOUNT_TWO, visibleIdentity),
    );
  });

  it.each([
    Buffer.from(secretHex.toUpperCase(), 'ascii'),
    Buffer.from(`${secretHex.slice(0, -1)}\n`, 'ascii'),
    Buffer.from([0xb0, ...secretFileBytes.subarray(1)]),
  ])('rejects a key that is not exactly 64 lowercase ASCII hex bytes', async (contents) => {
    const test = fixture(contents);
    await expect(
      createKemerBetAgentIdentityFingerprinter({
        secretFilePath: secretPath,
        fileSystem: test.fileSystem,
        platform: 'win32',
      }),
    ).rejects.toBeInstanceOf(KemerBetAgentIdentityFingerprintUnavailableError);
    expect([...test.loaded]).toEqual(new Array(contents.length).fill(0));
  });

  it.each(['', ' identity', 'identity ', 'line\nbreak', 'x'.repeat(257)])(
    'rejects malformed or oversized identity material',
    async (rawIdentity) => {
      const test = fixture();
      const fingerprint = await createKemerBetAgentIdentityFingerprinter({
        secretFilePath: secretPath,
        fileSystem: test.fileSystem,
        platform: 'win32',
      });
      expect(() => fingerprint(ACCOUNT_ONE, rawIdentity)).toThrow(
        KemerBetAgentIdentityFingerprintUnavailableError,
      );
    },
  );

  it.each([
    'not-a-uuid',
    'AAAAAAAA-4444-4444-8444-444444444441',
    '00000000-0000-0000-0000-000000000000',
  ])('rejects a noncanonical account identity binding', async (accountId) => {
    const test = fixture();
    const fingerprint = await createKemerBetAgentIdentityFingerprinter({
      secretFilePath: secretPath,
      fileSystem: test.fileSystem,
      platform: 'win32',
    });
    expect(() => fingerprint(accountId, 'agent@example.invalid')).toThrow(
      KemerBetAgentIdentityFingerprintUnavailableError,
    );
  });

  it.each([
    ['foreign owner', 2_000, 0o400],
    ['group writable', 1_000, 0o620],
    ['world writable', 0, 0o402],
  ] as const)('rejects a %s key file on POSIX', async (_caseName, uid, mode) => {
    const test = fixture(secretFileBytes, uid, mode);
    await expect(
      createKemerBetAgentIdentityFingerprinter({
        secretFilePath: secretPath,
        fileSystem: test.fileSystem,
        platform: 'linux',
        effectiveUserId: 1_000,
      }),
    ).rejects.toBeInstanceOf(KemerBetAgentIdentityFingerprintUnavailableError);
  });

  it('accepts a root-owned, read-only Docker secret on POSIX', async () => {
    const test = fixture(secretFileBytes, 0, 0o444);
    await expect(
      createKemerBetAgentIdentityFingerprinter({
        secretFilePath: secretPath,
        fileSystem: test.fileSystem,
        platform: 'linux',
        effectiveUserId: 1_000,
      }),
    ).resolves.toHaveProperty('keyFingerprint');
  });

  it('rejects a same-inode key mutation observed by fstat after read and zeros the buffer', async () => {
    const test = fixture(secretFileBytes, 1_000, 0o600, 2_000);
    let observed: unknown;
    try {
      await createKemerBetAgentIdentityFingerprinter({
        secretFilePath: secretPath,
        fileSystem: test.fileSystem,
        platform: 'linux',
        effectiveUserId: 1_000,
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(KemerBetAgentIdentityFingerprintUnavailableError);
    expect(String(observed)).not.toContain(secretPath);
    expect(String(observed)).not.toContain(secretHex);
    expect([...test.loaded]).toEqual(new Array(secretFileBytes.length).fill(0));
  });

  it('never logs or includes raw identity in an error', async () => {
    const test = fixture();
    const fingerprint = await createKemerBetAgentIdentityFingerprinter({
      secretFilePath: secretPath,
      fileSystem: test.fileSystem,
      platform: 'win32',
    });
    const rawIdentity = 'private-agent-identity';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let observed: unknown;
    try {
      fingerprint(ACCOUNT_ONE, `${rawIdentity}\n`);
    } catch (error) {
      observed = error;
    }
    expect(String(observed)).not.toContain(rawIdentity);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
