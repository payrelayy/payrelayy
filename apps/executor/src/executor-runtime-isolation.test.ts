import { describe, expect, it } from 'vitest';
import { dirname } from 'node:path';

import {
  assertKemerBetBrowserExecutable,
  KemerBetExecutorIsolationUnavailableError,
  loadKemerBetAgentIdentityBindings,
  loadExactKemerBetImportedReadinessPlayerIds,
  loadExactKemerBetStandaloneReadinessPlayerIds,
  loadKemerBetNoTransferReadinessPlayerIds,
  loadKemerBetSessionIdentityAuthorization,
  loadKemerBetSelectorContract,
  parseKemerBetAgentIdentityBindings,
  parseKemerBetNoTransferReadinessPlayerIds,
  parseKemerBetSessionIdentityAuthorization,
  type ExecutorIsolationFileSystem,
} from './executor-runtime-isolation.js';

const FIRST_ACCOUNT = '99999999-9999-4999-8999-999999999991';
const SECOND_ACCOUNT = '99999999-9999-4999-8999-999999999992';
const FIRST_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'a'.repeat(64)}`;
const SECOND_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'b'.repeat(64)}`;
const FIRST_AGENT_PROFILE_PIN = `hmac-sha256-agent-profile-pin-v3:${'a'.repeat(64)}`;
const SECOND_AGENT_PROFILE_PIN = `hmac-sha256-agent-profile-pin-v3:${'b'.repeat(64)}`;
const FIRST_BINDING = `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT} ${FIRST_AGENT_PROFILE_PIN}`;
const SECOND_BINDING = `${SECOND_ACCOUNT} ${SECOND_FINGERPRINT} ${SECOND_AGENT_PROFILE_PIN}`;
const RECOVERY_AUTHORIZATION = [
  'version=1',
  'contract=fetanagent-kemerbet-quarantine-recovery-identity-authorization-v1',
  `old_profile_id=${FIRST_ACCOUNT}`,
  `old_identity_fingerprint=${FIRST_FINGERPRINT}`,
  `new_profile_id=${SECOND_ACCOUNT}`,
  'configuration_reason=security_recovery',
  'transfer_disabled=true',
  'money_moved=false',
  '',
].join('\n');

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
    gid: 0,
    nlink: 1,
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

interface ExactImportedStageState {
  readonly content: string;
  readonly gid: number;
  readonly ino: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly realPath: string;
  readonly symbolicLink: boolean;
  readonly uid: number;
}

interface ExactImportedStageParentState {
  readonly gid: number;
  readonly ino: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly realPath: string;
  readonly symbolicLink: boolean;
  readonly uid: number;
}

function fakeExactImportedStageFileSystem(
  path: string,
  content: string,
  overrides: Partial<ExactImportedStageState> = {},
  parentOverrides: Partial<ExactImportedStageParentState> = {},
): {
  readonly fileSystem: ExecutorIsolationFileSystem;
  replace(next: Partial<ExactImportedStageState>): void;
  replaceDuringNextRead(next: Partial<ExactImportedStageState>): void;
  replaceParent(next: Partial<ExactImportedStageParentState>): void;
  replaceParentDuringNextRead(next: Partial<ExactImportedStageParentState>): void;
} {
  const parentPath = dirname(path);
  let state: ExactImportedStageState = {
    content,
    gid: 0,
    ino: 2,
    mode: 0o444,
    mtimeMs: 1_000,
    nlink: 1,
    realPath: path,
    symbolicLink: false,
    uid: 0,
    ...overrides,
  };
  let parentState: ExactImportedStageParentState = {
    gid: 10_001,
    ino: 10,
    mode: 0o700,
    mtimeMs: 1_000,
    nlink: 2,
    realPath: parentPath,
    symbolicLink: false,
    uid: 10_001,
    ...parentOverrides,
  };
  let replacementDuringRead: Partial<ExactImportedStageState> | undefined;
  let parentReplacementDuringRead: Partial<ExactImportedStageParentState> | undefined;
  const replace = (next: Partial<ExactImportedStageState>): void => {
    state = { ...state, ...next };
  };
  const replaceParent = (next: Partial<ExactImportedStageParentState>): void => {
    parentState = { ...parentState, ...next };
  };
  const fileStat = (snapshot: ExactImportedStageState) => ({
    dev: 1,
    gid: snapshot.gid,
    ino: snapshot.ino,
    mode: snapshot.mode,
    mtimeMs: snapshot.mtimeMs,
    nlink: snapshot.nlink,
    size: Buffer.byteLength(snapshot.content, 'utf8'),
    uid: snapshot.uid,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => snapshot.symbolicLink,
  });
  const parentStat = (snapshot: ExactImportedStageParentState) => ({
    dev: 1,
    gid: snapshot.gid,
    ino: snapshot.ino,
    mode: snapshot.mode,
    mtimeMs: snapshot.mtimeMs,
    nlink: snapshot.nlink,
    size: 4_096,
    uid: snapshot.uid,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => snapshot.symbolicLink,
  });
  return {
    fileSystem: {
      async lstat(received) {
        if (received === path) return fileStat(state);
        expect(received).toBe(parentPath);
        return parentStat(parentState);
      },
      async realpath(received) {
        if (received === path) return state.realPath;
        expect(received).toBe(parentPath);
        return parentState.realPath;
      },
      async open(received) {
        if (received === parentPath) {
          const openedParent = parentState;
          return {
            async stat() {
              return parentStat(openedParent);
            },
            async readFile() {
              return Buffer.alloc(0);
            },
            async close() {},
          };
        }
        expect(received).toBe(path);
        const opened = state;
        return {
          async stat() {
            return fileStat(opened);
          },
          async readFile() {
            const loaded = Buffer.from(opened.content, 'utf8');
            if (replacementDuringRead) {
              replace(replacementDuringRead);
              replacementDuringRead = undefined;
            }
            if (parentReplacementDuringRead) {
              replaceParent(parentReplacementDuringRead);
              parentReplacementDuringRead = undefined;
            }
            return loaded;
          },
          async close() {},
        };
      },
      async access(received) {
        expect([path, parentPath]).toContain(received);
      },
    },
    replace,
    replaceDuringNextRead(next) {
      replacementDuringRead = next;
    },
    replaceParent,
    replaceParentDuringNextRead(next) {
      parentReplacementDuringRead = next;
    },
  };
}

describe('KemerBet executor runtime isolation', () => {
  it('keeps ordinary v3 identity authorization bound to its one Profile UUID', () => {
    expect(parseKemerBetSessionIdentityAuthorization(`${FIRST_BINDING}\n`)).toEqual({
      expectedAgentIdentityFingerprint: FIRST_FINGERPRINT,
      kind: 'binding',
      platformAgentAccountId: FIRST_ACCOUNT,
      verificationPlatformAgentAccountId: FIRST_ACCOUNT,
    });
  });

  it('accepts one recovery-only old-digest-to-fresh-Profile authorization without making it a binding', async () => {
    expect(Buffer.byteLength(RECOVERY_AUTHORIZATION, 'utf8')).toBe(389);
    expect(parseKemerBetSessionIdentityAuthorization(RECOVERY_AUTHORIZATION)).toEqual({
      expectedAgentIdentityFingerprint: FIRST_FINGERPRINT,
      kind: 'security_recovery',
      platformAgentAccountId: SECOND_ACCOUNT,
      verificationPlatformAgentAccountId: FIRST_ACCOUNT,
    });
    expect(() => parseKemerBetAgentIdentityBindings(RECOVERY_AUTHORIZATION)).toThrow(
      KemerBetExecutorIsolationUnavailableError,
    );
    await expect(
      loadKemerBetSessionIdentityAuthorization({
        effectiveUserId: 10_001,
        filePath: '/run/secrets/kemerbet_agent_identity_bindings',
        fileSystem: fakeFileSystem(
          '/run/secrets/kemerbet_agent_identity_bindings',
          RECOVERY_AUTHORIZATION,
          { mode: 0o440 },
        ),
        platform: 'linux',
      }),
    ).resolves.toEqual({
      expectedAgentIdentityFingerprint: FIRST_FINGERPRINT,
      kind: 'security_recovery',
      platformAgentAccountId: SECOND_ACCOUNT,
      verificationPlatformAgentAccountId: FIRST_ACCOUNT,
    });
  });

  it('rejects recovery identity authorizations that could alias or gain money authority', () => {
    for (const invalid of [
      RECOVERY_AUTHORIZATION.replace(
        `new_profile_id=${SECOND_ACCOUNT}`,
        `new_profile_id=${FIRST_ACCOUNT}`,
      ),
      RECOVERY_AUTHORIZATION.replace('transfer_disabled=true', 'transfer_disabled=false'),
      RECOVERY_AUTHORIZATION.replace('money_moved=false', 'money_moved=true'),
      RECOVERY_AUTHORIZATION.replace(
        'configuration_reason=security_recovery',
        'configuration_reason=manual',
      ),
      RECOVERY_AUTHORIZATION.replace(
        'old_identity_fingerprint=',
        'username=agent\nold_identity_fingerprint=',
      ),
      RECOVERY_AUTHORIZATION.slice(0, -1),
    ]) {
      expect(() => parseKemerBetSessionIdentityAuthorization(invalid)).toThrow(
        KemerBetExecutorIsolationUnavailableError,
      );
    }
  });

  it('accepts only five distinct canonical private readiness Player IDs', async () => {
    const content = 'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5\n';
    expect(parseKemerBetNoTransferReadinessPlayerIds(content).playerIds).toEqual([
      'PLAYER-1',
      'PLAYER-2',
      'PLAYER-3',
      'PLAYER-4',
      'PLAYER-5',
    ]);
    for (const invalid of [
      '',
      'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4',
      'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5\nPLAYER-6',
      'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-4',
      'PLAYER-1\nPLAYER-2\nPLAYER 3\nPLAYER-4\nPLAYER-5',
      'PLAYER-1\r\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5',
      'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5\n\n',
    ]) {
      expect(() => parseKemerBetNoTransferReadinessPlayerIds(invalid)).toThrow(
        KemerBetExecutorIsolationUnavailableError,
      );
    }

    const path = '/run/secrets/kemerbet_no_transfer_readiness_player_ids';
    await expect(
      loadKemerBetNoTransferReadinessPlayerIds({
        filePath: path,
        fileSystem: fakeFileSystem(path, content, { mode: 0o400, uid: 1000 }),
        platform: 'linux',
        effectiveUserId: 1000,
      }),
    ).resolves.toEqual({ playerIds: ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'] });
  });

  it('loads and re-attests only the exact frozen root-owned imported readiness stage', async () => {
    const path = '/run/fetanagent-kemerbet-session-control/kemerbet-readiness-player-ids.stage-v1';
    const content = 'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5\n';
    const stage = fakeExactImportedStageFileSystem(path, content);
    const loaded = await loadExactKemerBetImportedReadinessPlayerIds({
      effectiveUserId: 10_001,
      filePath: path,
      fileSystem: stage.fileSystem,
      platform: 'linux',
    });

    expect(loaded.playerIds).toEqual(['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5']);
    await expect(loaded.reattest()).resolves.toBeUndefined();

    stage.replace({ content: 'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-6\n' });
    await expect(loaded.reattest()).rejects.toBeInstanceOf(
      KemerBetExecutorIsolationUnavailableError,
    );
  });

  it('keeps the standalone one-shot secret contract distinct and re-attested', async () => {
    const path = '/run/secrets/kemerbet_no_transfer_readiness_player_ids';
    const content = 'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5\n';
    const secret = fakeExactImportedStageFileSystem(path, content, {
      gid: 10_001,
      mode: 0o400,
      uid: 10_001,
    });
    const loaded = await loadExactKemerBetStandaloneReadinessPlayerIds({
      effectiveUserId: 10_001,
      filePath: path,
      fileSystem: secret.fileSystem,
      platform: 'linux',
    });

    expect(loaded.playerIds).toHaveLength(5);
    await expect(loaded.reattest()).resolves.toBeUndefined();
    secret.replace({ mode: 0o444 });
    await expect(loaded.reattest()).rejects.toBeInstanceOf(
      KemerBetExecutorIsolationUnavailableError,
    );

    const importedShape = fakeExactImportedStageFileSystem(path, content);
    await expect(
      loadExactKemerBetStandaloneReadinessPlayerIds({
        effectiveUserId: 10_001,
        filePath: path,
        fileSystem: importedShape.fileSystem,
        platform: 'linux',
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
  });

  it('rejects every noncanonical imported readiness-stage ownership and content shape', async () => {
    const path = '/run/fetanagent-kemerbet-session-control/kemerbet-readiness-player-ids.stage-v1';
    const content = 'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5\n';
    for (const [candidateContent, overrides] of [
      [content.slice(0, -1), {}],
      [content, { uid: 10_001 }],
      [content, { gid: 10_001 }],
      [content, { mode: 0o400 }],
      [content, { mode: 0o644 }],
      [content, { nlink: 2 }],
      [content, { symbolicLink: true }],
      [content, { realPath: `${path}.replaced` }],
    ] as const) {
      const stage = fakeExactImportedStageFileSystem(path, candidateContent, overrides);
      await expect(
        loadExactKemerBetImportedReadinessPlayerIds({
          effectiveUserId: 10_001,
          filePath: path,
          fileSystem: stage.fileSystem,
          platform: 'linux',
        }),
      ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    }
  });

  it('rejects every noncanonical imported readiness-stage parent boundary', async () => {
    const path = '/run/fetanagent-kemerbet-session-control/kemerbet-readiness-player-ids.stage-v1';
    const content = 'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5\n';
    for (const parentOverrides of [
      { uid: 0 },
      { gid: 0 },
      { mode: 0o755 },
      { nlink: 1 },
      { symbolicLink: true },
      { realPath: '/run/fetanagent-kemerbet-session-control-replaced' },
    ] as const) {
      const stage = fakeExactImportedStageFileSystem(path, content, {}, parentOverrides);
      await expect(
        loadExactKemerBetImportedReadinessPlayerIds({
          effectiveUserId: 10_001,
          filePath: path,
          fileSystem: stage.fileSystem,
          platform: 'linux',
        }),
      ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);
    }
  });

  it('rejects imported-stage path replacement during the initial read and before binding', async () => {
    const path = '/run/fetanagent-kemerbet-session-control/kemerbet-readiness-player-ids.stage-v1';
    const content = 'PLAYER-1\nPLAYER-2\nPLAYER-3\nPLAYER-4\nPLAYER-5\n';
    const duringRead = fakeExactImportedStageFileSystem(path, content);
    duringRead.replaceDuringNextRead({ ino: 3 });
    await expect(
      loadExactKemerBetImportedReadinessPlayerIds({
        effectiveUserId: 10_001,
        filePath: path,
        fileSystem: duringRead.fileSystem,
        platform: 'linux',
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);

    const beforeBinding = fakeExactImportedStageFileSystem(path, content);
    const loaded = await loadExactKemerBetImportedReadinessPlayerIds({
      effectiveUserId: 10_001,
      filePath: path,
      fileSystem: beforeBinding.fileSystem,
      platform: 'linux',
    });
    beforeBinding.replace({ ino: 4 });
    await expect(loaded.reattest()).rejects.toBeInstanceOf(
      KemerBetExecutorIsolationUnavailableError,
    );

    const parentDuringRead = fakeExactImportedStageFileSystem(path, content);
    parentDuringRead.replaceParentDuringNextRead({ ino: 11 });
    await expect(
      loadExactKemerBetImportedReadinessPlayerIds({
        effectiveUserId: 10_001,
        filePath: path,
        fileSystem: parentDuringRead.fileSystem,
        platform: 'linux',
      }),
    ).rejects.toBeInstanceOf(KemerBetExecutorIsolationUnavailableError);

    const movedIntoReplacementParent = fakeExactImportedStageFileSystem(path, content);
    const parentBound = await loadExactKemerBetImportedReadinessPlayerIds({
      effectiveUserId: 10_001,
      filePath: path,
      fileSystem: movedIntoReplacementParent.fileSystem,
      platform: 'linux',
    });
    movedIntoReplacementParent.replaceParent({ ino: 12 });
    await expect(parentBound.reattest()).rejects.toBeInstanceOf(
      KemerBetExecutorIsolationUnavailableError,
    );
  });

  it('parses exact unique UUID-to-agent-identity bindings and derives the account list', () => {
    const parsed = parseKemerBetAgentIdentityBindings(`${FIRST_BINDING}\n${SECOND_BINDING}\n`);
    expect(parsed.platformAgentAccountIds).toEqual([FIRST_ACCOUNT, SECOND_ACCOUNT]);
    expect([...parsed.expectedAgentIdentityBindings]).toEqual([
      [FIRST_ACCOUNT, FIRST_FINGERPRINT],
      [SECOND_ACCOUNT, SECOND_FINGERPRINT],
    ]);
    for (const invalid of [
      '',
      `${FIRST_BINDING}\n\n${SECOND_BINDING}`,
      `${FIRST_BINDING}\n${FIRST_ACCOUNT} ${SECOND_FINGERPRINT} ${SECOND_AGENT_PROFILE_PIN}`,
      `${FIRST_BINDING}\n${SECOND_ACCOUNT} ${FIRST_FINGERPRINT} ${FIRST_AGENT_PROFILE_PIN}`,
      `${FIRST_BINDING}\n${SECOND_ACCOUNT} ${SECOND_FINGERPRINT} ${FIRST_AGENT_PROFILE_PIN}`,
      `AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1 ${FIRST_FINGERPRINT} ${FIRST_AGENT_PROFILE_PIN}`,
      `${FIRST_BINDING}\r\n`,
      `${FIRST_ACCOUNT}  ${FIRST_FINGERPRINT} ${FIRST_AGENT_PROFILE_PIN}`,
      `${FIRST_ACCOUNT}\t${FIRST_FINGERPRINT} ${FIRST_AGENT_PROFILE_PIN}`,
      `${FIRST_ACCOUNT} hmac-sha256-v1:${'a'.repeat(64)} ${FIRST_AGENT_PROFILE_PIN}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT.toUpperCase()} ${FIRST_AGENT_PROFILE_PIN}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT} hmac-sha256-agent-profile-pin-v3:${'A'.repeat(64)}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT} hmac-sha256-agent-profile-pin-v3:${'c'.repeat(64)}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT} sha256-provider-authorization-v1:${'c'.repeat(64)}`,
      `${FIRST_ACCOUNT} ${FIRST_FINGERPRINT}`,
      `${FIRST_BINDING}\n\n`,
      'not-a-uuid',
    ]) {
      expect(() => parseKemerBetAgentIdentityBindings(invalid)).toThrow(
        KemerBetExecutorIsolationUnavailableError,
      );
    }
  });

  it('loads bindings from an immutable root/effective-user-owned non-symlink regular file', async () => {
    const path = '/run/secrets/kemerbet_agent_identity_bindings';
    const content = `${FIRST_BINDING}\n`;
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
