import { describe, expect, it } from 'vitest';

import {
  assertKemerBetBrowserExecutable,
  KemerBetExecutorIsolationUnavailableError,
  loadKemerBetAgentIdentityBindings,
  loadKemerBetSelectorContract,
  parseKemerBetAgentIdentityBindings,
  type ExecutorIsolationFileSystem,
} from './executor-runtime-isolation.js';

const FIRST_ACCOUNT = '99999999-9999-4999-8999-999999999991';
const SECOND_ACCOUNT = '99999999-9999-4999-8999-999999999992';
const FIRST_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'a'.repeat(64)}`;
const SECOND_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'b'.repeat(64)}`;

function fakeFileSystem(
  path: string,
  content: string,
  options: {
    readonly mode?: number;
    readonly uid?: number;
    readonly symbolicLink?: boolean;
    readonly realPath?: string;
    readonly openedDevice?: number;
    readonly afterReadMtimeMs?: number;
    readonly observeReadBuffer?: (buffer: Buffer) => void;
  } = {},
): ExecutorIsolationFileSystem {
  const bytes = Buffer.from(content, 'utf8');
  const stat = {
    size: bytes.length,
    mode: options.mode ?? 0o600,
    uid: options.uid ?? 0,
    dev: 1,
    ino: 2,
    mtimeMs: 1_000,
    isFile: () => true,
    isSymbolicLink: () => options.symbolicLink === true,
  };
  return {
    async lstat(received) {
      expect(received).toBe(path);
      return stat;
    },
    async realpath(received) {
      expect(received).toBe(path);
      return options.realPath ?? path;
    },
    async open(received) {
      expect(received).toBe(path);
      let statCalls = 0;
      return {
        async stat() {
          statCalls += 1;
          return {
            ...stat,
            dev: options.openedDevice ?? stat.dev,
            mtimeMs:
              statCalls > 1 && options.afterReadMtimeMs !== undefined
                ? options.afterReadMtimeMs
                : stat.mtimeMs,
          };
        },
        async readFile() {
          const loaded = Buffer.from(bytes);
          options.observeReadBuffer?.(loaded);
          return loaded;
        },
        async close() {},
      };
    },
    async access(received) {
      expect(received).toBe(path);
    },
  };
}

describe('KemerBet executor runtime isolation', () => {
  it('parses exact unique UUID-to-agent-identity bindings and derives the account list', () => {
    const parsed = parseKemerBetAgentIdentityBindings(
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT}\n${SECOND_ACCOUNT} ${SECOND_FINGERPRINT}\n`,
    );
    expect(parsed.platformAgentAccountIds).toEqual([FIRST_ACCOUNT, SECOND_ACCOUNT]);
    expect([...parsed.expectedAgentIdentityBindings]).toEqual([
      [FIRST_ACCOUNT, FIRST_FINGERPRINT],
      [SECOND_ACCOUNT, SECOND_FINGERPRINT],
    ]);
    for (const invalid of [
      '',
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT}\n\n${SECOND_ACCOUNT} ${SECOND_FINGERPRINT}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT}\n${FIRST_ACCOUNT} ${SECOND_FINGERPRINT}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT}\n${SECOND_ACCOUNT} ${FIRST_FINGERPRINT}`,
      `AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1 ${FIRST_FINGERPRINT}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT}\r\n`,
      `${FIRST_ACCOUNT}  ${FIRST_FINGERPRINT}`,
      `${FIRST_ACCOUNT}\t${FIRST_FINGERPRINT}`,
      `${FIRST_ACCOUNT} hmac-sha256-v1:${'a'.repeat(64)}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT.toUpperCase()}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT}\n\n`,
      'not-a-uuid',
    ]) {
      expect(() => parseKemerBetAgentIdentityBindings(invalid)).toThrow(
        KemerBetExecutorIsolationUnavailableError,
      );
    }
  });

  it('loads bindings from an immutable root/effective-user-owned non-symlink regular file', async () => {
    const path = '/run/secrets/kemerbet_agent_identity_bindings';
    const content = `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT}\n`;
    await expect(
      loadKemerBetAgentIdentityBindings({
        filePath: path,
        fileSystem: fakeFileSystem(path, content, { mode: 0o444, uid: 0 }),
        platform: 'linux',
        effectiveUserId: 1000,
      }),
    ).resolves.toMatchObject({ platformAgentAccountIds: [FIRST_ACCOUNT] });
    await expect(
      loadKemerBetAgentIdentityBindings({
        filePath: path,
        fileSystem: fakeFileSystem(path, content, { mode: 0o400, uid: 1000 }),
        platform: 'linux',
        effectiveUserId: 1000,
      }),
    ).resolves.toMatchObject({ platformAgentAccountIds: [FIRST_ACCOUNT] });

    for (const options of [
      { mode: 0o664, uid: 0 },
      { mode: 0o444, uid: 2000 },
      { mode: 0o444, uid: 0, symbolicLink: true },
      { mode: 0o444, uid: 0, realPath: '/run/secrets/replaced' },
      { mode: 0o444, uid: 0, openedDevice: 9 },
      { mode: 0o444, uid: 0, afterReadMtimeMs: 2_000 },
    ]) {
      await expect(
        loadKemerBetAgentIdentityBindings({
          filePath: path,
          fileSystem: fakeFileSystem(path, content, options),
          platform: 'linux',
          effectiveUserId: 1000,
        }),
      ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    }
    let observed: unknown;
    try {
      await loadKemerBetAgentIdentityBindings({
        filePath: path,
        fileSystem: fakeFileSystem(path, content, {
          mode: 0o444,
          uid: 0,
          realPath: '/private/repointed-binding',
        }),
        platform: 'linux',
        effectiveUserId: 1000,
      });
    } catch (error) {
      observed = error;
    }
    expect(String(observed)).toBe(
      'KemerBetExecutorIsolationUnavailableError: The KemerBet executor runtime isolation boundary is unavailable.',
    );
    expect(String(observed)).not.toContain(path);
    expect(String(observed)).not.toContain(FIRST_FINGERPRINT);

    let racedBuffer: Buffer | null = null;
    await expect(
      loadKemerBetAgentIdentityBindings({
        filePath: path,
        fileSystem: fakeFileSystem(path, content, {
          mode: 0o444,
          uid: 0,
          afterReadMtimeMs: 3_000,
          observeReadBuffer: (buffer) => {
            racedBuffer = buffer;
          },
        }),
        platform: 'linux',
        effectiveUserId: 1000,
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    expect(racedBuffer).not.toBeNull();
    expect([...(racedBuffer as unknown as Buffer)]).toEqual(new Array(content.length).fill(0));
  });

  it('loads selector JSON through an injected exhaustive validator and rejects unsafe files', async () => {
    const path = '/etc/fetanagent/kemerbet-selector-contract.v2.json';
    const contract = { version: 1, marker: 'reviewed' };
    await expect(
      loadKemerBetSelectorContract({
        filePath: path,
        fileSystem: fakeFileSystem(path, JSON.stringify(contract), { mode: 0o644 }),
        platform: 'linux',
        effectiveUserId: 1000,
        validate(value) {
          if (
            typeof value !== 'object' ||
            value === null ||
            (value as { version?: unknown }).version !== 1
          ) {
            throw new Error('invalid');
          }
          return value as typeof contract;
        },
      }),
    ).resolves.toEqual(contract);

    await expect(
      loadKemerBetSelectorContract({
        filePath: path,
        fileSystem: fakeFileSystem(path, '{', { mode: 0o644 }),
        platform: 'linux',
        effectiveUserId: 1000,
        validate: () => contract,
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    await expect(
      loadKemerBetSelectorContract({
        filePath: path,
        fileSystem: fakeFileSystem(path, JSON.stringify(contract), {
          mode: 0o644,
          afterReadMtimeMs: 2_000,
        }),
        platform: 'linux',
        effectiveUserId: 1000,
        validate: () => contract,
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    await expect(
      loadKemerBetSelectorContract({
        filePath: path,
        fileSystem: fakeFileSystem(path, JSON.stringify(contract), { mode: 0o666 }),
        platform: 'linux',
        effectiveUserId: 1000,
        validate: () => contract,
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    await expect(
      loadKemerBetSelectorContract({
        filePath: path,
        fileSystem: fakeFileSystem(path, JSON.stringify(contract), {
          mode: 0o644,
          uid: 2000,
        }),
        platform: 'linux',
        effectiveUserId: 1000,
        validate: () => contract,
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
  });

  it('requires an exact non-symlink executable file before startup', async () => {
    const path = '/usr/bin/chromium';
    await expect(
      assertKemerBetBrowserExecutable({
        executablePath: path,
        fileSystem: fakeFileSystem(path, 'binary', { mode: 0o755 }),
        platform: 'linux',
        effectiveUserId: 1000,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertKemerBetBrowserExecutable({
        executablePath: path,
        fileSystem: fakeFileSystem(path, 'binary', { mode: 0o755, symbolicLink: true }),
        platform: 'linux',
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    for (const unsafe of [
      { mode: 0o775, uid: 0 },
      { mode: 0o755, uid: 2_000 },
      { mode: 0o755, uid: 0, afterReadMtimeMs: 2_000 },
      { mode: 0o755, uid: 0, openedDevice: 9 },
    ]) {
      await expect(
        assertKemerBetBrowserExecutable({
          executablePath: path,
          fileSystem: fakeFileSystem(path, 'binary', unsafe),
          platform: 'linux',
          effectiveUserId: 1_000,
        }),
      ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    }
    await expect(
      assertKemerBetBrowserExecutable({
        executablePath: 'relative-browser',
        fileSystem: fakeFileSystem('relative-browser', 'binary'),
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
  });
});
