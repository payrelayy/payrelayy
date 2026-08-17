import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createKemerBetHistoryReferenceFingerprinter,
  KEMERBET_HISTORY_REFERENCE_FINGERPRINT_DOMAIN,
  KemerBetHistoryReferenceFingerprintUnavailableError,
  type KemerBetHistoryReferenceSecretFileSystem,
} from './kemerbet-history-reference-fingerprint.js';

const secretPath = resolve('test-history-reference-hmac.key');
const secretHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const secretFileBytes = Buffer.from(secretHex, 'ascii');
const decodedSecret = Buffer.from(secretHex, 'hex');

interface FakeFileSystemOptions {
  readonly symlink?: boolean;
  readonly mode?: number;
  readonly openedDevice?: number;
  readonly openedInode?: number;
  readonly readError?: boolean;
  readonly realPath?: string;
  readonly contents?: Buffer;
  readonly uid?: number;
  readonly afterReadMtimeMs?: number;
}

function fakeFileSystem(options: FakeFileSystemOptions = {}) {
  const loaded = Buffer.from(options.contents ?? secretFileBytes);
  let opens = 0;
  let closes = 0;
  const stat = (device: number, inode: number, symlink = false) => ({
    size: loaded.length,
    mode: options.mode ?? 0o600,
    uid: options.uid ?? 1_000,
    dev: device,
    ino: inode,
    mtimeMs: 1_000,
    isFile: () => !symlink,
    isSymbolicLink: () => symlink,
  });
  const fileSystem: KemerBetHistoryReferenceSecretFileSystem = {
    async lstat() {
      return stat(1, 2, options.symlink);
    },
    async realpath() {
      return options.realPath ?? secretPath;
    },
    async open() {
      opens += 1;
      let statCalls = 0;
      return {
        async stat() {
          statCalls += 1;
          const value = stat(options.openedDevice ?? 1, options.openedInode ?? 2);
          return statCalls > 1 && options.afterReadMtimeMs !== undefined
            ? { ...value, mtimeMs: options.afterReadMtimeMs }
            : value;
        },
        async readFile() {
          if (options.readError) throw new Error('contains-sensitive-path-or-key');
          return loaded;
        },
        async close() {
          closes += 1;
        },
      };
    },
  };
  return {
    fileSystem,
    loaded,
    get opens() {
      return opens;
    },
    get closes() {
      return closes;
    },
  };
}

describe('KemerBet history-reference fingerprint', () => {
  it('uses a domain-separated HMAC-SHA256 key loaded from a file', async () => {
    const fixture = fakeFileSystem();
    const fingerprint = await createKemerBetHistoryReferenceFingerprinter({
      secretFilePath: secretPath,
      fileSystem: fixture.fileSystem,
      platform: 'win32',
    });
    const rawReference = 'provider-reference-alpha';
    const expected = createHmac('sha256', decodedSecret)
      .update(KEMERBET_HISTORY_REFERENCE_FINGERPRINT_DOMAIN, 'utf8')
      .update(rawReference, 'utf8')
      .digest('hex');

    expect(fingerprint(rawReference)).toBe(`hmac-sha256-v1:${expected}`);
    expect(fingerprint.keyFingerprint).toBe(
      createHash('sha256').update(decodedSecret).digest('hex'),
    );
    expect(fingerprint(rawReference)).not.toBe(
      `hmac-sha256-v1:${createHmac('sha256', decodedSecret).update(rawReference).digest('hex')}`,
    );
    expect(fixture.opens).toBe(1);
    expect(fixture.closes).toBe(1);
    expect([...fixture.loaded]).toEqual(new Array(secretFileBytes.length).fill(0));
  });

  it.each([
    Buffer.from(secretHex.toUpperCase(), 'ascii'),
    Buffer.from(`${secretHex.slice(0, -1)}\n`, 'ascii'),
    Buffer.from([0xb0, ...secretFileBytes.subarray(1)]),
  ])('rejects a key that is not exactly 64 lowercase ASCII hex bytes', async (contents) => {
    const fixture = fakeFileSystem({ contents });
    await expect(
      createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'win32',
      }),
    ).rejects.toBeInstanceOf(KemerBetHistoryReferenceFingerprintUnavailableError);
    expect([...fixture.loaded]).toEqual(new Array(contents.length).fill(0));
  });

  it('is deterministic for one reference and separates different references', async () => {
    const fixture = fakeFileSystem();
    const fingerprint = await createKemerBetHistoryReferenceFingerprinter({
      secretFilePath: secretPath,
      fileSystem: fixture.fileSystem,
      platform: 'win32',
    });

    expect(fingerprint('reference-one')).toBe(fingerprint('reference-one'));
    expect(fingerprint('reference-one')).not.toBe(fingerprint('reference-two'));
    expect(fingerprint('reference-one')).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
  });

  it.each(['', ' leading-space', 'trailing-space ', 'line\nbreak', 'x'.repeat(257)])(
    'rejects an empty, untrimmed, multiline, or byte-oversized reference',
    async (rawReference) => {
      const fixture = fakeFileSystem();
      const fingerprint = await createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'win32',
      });
      expect(() => fingerprint(rawReference)).toThrow(
        KemerBetHistoryReferenceFingerprintUnavailableError,
      );
    },
  );

  it('measures the reference bound in UTF-8 bytes', async () => {
    const fixture = fakeFileSystem();
    const fingerprint = await createKemerBetHistoryReferenceFingerprinter({
      secretFilePath: secretPath,
      fileSystem: fixture.fileSystem,
      platform: 'win32',
    });
    expect(() => fingerprint('የ'.repeat(86))).toThrow(
      KemerBetHistoryReferenceFingerprintUnavailableError,
    );
  });

  it('rejects a symlink and never opens it', async () => {
    const fixture = fakeFileSystem({ symlink: true });
    await expect(
      createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'win32',
      }),
    ).rejects.toBeInstanceOf(KemerBetHistoryReferenceFingerprintUnavailableError);
    expect(fixture.opens).toBe(0);
  });

  it('rejects a key path whose real path escapes through a symlinked parent', async () => {
    const fixture = fakeFileSystem({ realPath: resolve('different-parent', 'secret.key') });
    await expect(
      createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'win32',
      }),
    ).rejects.toBeInstanceOf(KemerBetHistoryReferenceFingerprintUnavailableError);
    expect(fixture.opens).toBe(0);
  });

  it('accepts an euid-owned POSIX key that is group-readable but not writable', async () => {
    const fixture = fakeFileSystem({ mode: 0o640 });
    await expect(
      createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'linux',
        effectiveUserId: 1_000,
      }),
    ).resolves.toHaveProperty('keyFingerprint');
  });

  it.each([
    ['foreign owner', 2_000, 0o400],
    ['group writable', 1_000, 0o620],
    ['world writable', 0, 0o402],
  ] as const)('rejects a %s key file on POSIX', async (_caseName, uid, mode) => {
    const fixture = fakeFileSystem({ uid, mode });
    await expect(
      createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'linux',
        effectiveUserId: 1_000,
      }),
    ).rejects.toBeInstanceOf(KemerBetHistoryReferenceFingerprintUnavailableError);
  });

  it('accepts a root-owned, read-only Docker secret on POSIX', async () => {
    const fixture = fakeFileSystem({ uid: 0, mode: 0o444 });
    await expect(
      createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'linux',
        effectiveUserId: 1_000,
      }),
    ).resolves.toHaveProperty('keyFingerprint');
  });

  it('detects a file-swap race between lstat and the opened handle', async () => {
    const fixture = fakeFileSystem({ openedInode: 99 });
    await expect(
      createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'win32',
      }),
    ).rejects.toBeInstanceOf(KemerBetHistoryReferenceFingerprintUnavailableError);
    expect(fixture.closes).toBe(1);
  });

  it('rejects a same-inode key mutation after read, zeros bytes, and reports only redacted failure', async () => {
    const fixture = fakeFileSystem({ afterReadMtimeMs: 2_000 });
    let observed: unknown;
    try {
      await createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'win32',
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(KemerBetHistoryReferenceFingerprintUnavailableError);
    expect(String(observed)).not.toContain(secretPath);
    expect(String(observed)).not.toContain(secretHex);
    expect([...fixture.loaded]).toEqual(new Array(secretFileBytes.length).fill(0));
    expect(fixture.closes).toBe(1);
  });

  it('never logs or includes the raw reference, key path, or file error in failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fixture = fakeFileSystem({ readError: true });

    let observed: unknown;
    try {
      await createKemerBetHistoryReferenceFingerprinter({
        secretFilePath: secretPath,
        fileSystem: fixture.fileSystem,
        platform: 'win32',
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(KemerBetHistoryReferenceFingerprintUnavailableError);
    expect(String(observed)).not.toContain(secretPath);
    expect(String(observed)).not.toContain('contains-sensitive-path-or-key');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
