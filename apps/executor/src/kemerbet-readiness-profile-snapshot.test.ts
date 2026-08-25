import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  assertKemerBetReadinessProfileMountInfo,
  createKemerBetReadinessProfileTreeDigest,
  hashKemerBetReadinessProfileOpenedFile,
  inspectTree,
  KEMERBET_READINESS_PROFILE_SNAPSHOT_LIMITS,
  KEMERBET_READINESS_PROFILE_SNAPSHOT_RUNTIME_CONTRACT,
  KemerBetReadinessProfileSnapshotUnavailableError,
  parseKemerBetReadinessProfileManifest,
  runKemerBetReadinessProfileSnapshot,
  serializeKemerBetReadinessProfileManifest,
  type KemerBetReadinessProfileTreeRecord,
} from './kemerbet-readiness-profile-snapshot.js';

const ACCOUNT_ID = '44444444-4444-4444-8444-444444444441';
const CONTENT_SHA = createHash('sha256').update('session bytes').digest('hex');
const RECORDS: readonly KemerBetReadinessProfileTreeRecord[] = Object.freeze([
  {
    contentSha256: CONTENT_SHA,
    gid: 10001,
    mode: 0o600,
    relativePath: 'Default/Cookies',
    size: 13,
    type: 'file',
    uid: 10001,
  },
  {
    contentSha256: null,
    gid: 10001,
    mode: 0o700,
    relativePath: 'Default',
    size: 0,
    type: 'directory',
    uid: 10001,
  },
  {
    contentSha256: null,
    gid: 10001,
    mode: 0o700,
    relativePath: '',
    size: 0,
    type: 'directory',
    uid: 10001,
  },
]);

async function createPortableTestSymlink(
  targetRoot: string,
  linkPath: string,
  targetName: string,
): Promise<void> {
  const target = join(targetRoot, targetName);
  await mkdir(target, { recursive: true });
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

describe('KemerBet offline profile snapshot', () => {
  it('omits only the three exact top-level stale Chromium singleton symlinks from source inspection and manifest input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fetanagent-profile-singletons-'));
    const sourceAccount = join(directory, 'source', ACCOUNT_ID);
    const singletonNames = ['SingletonCookie', 'SingletonLock', 'SingletonSocket'] as const;
    await mkdir(join(sourceAccount, 'Default'), { recursive: true });
    await writeFile(join(sourceAccount, 'Default', 'Cookies'), 'session bytes');
    for (const singletonName of singletonNames) {
      await createPortableTestSymlink(
        join(directory, 'targets'),
        join(sourceAccount, singletonName),
        singletonName,
      );
    }

    try {
      const sourceRecords = await inspectTree({
        ignoreTopLevelChromiumSingletonSymlinks: true,
        root: sourceAccount,
      });
      const sourceAfterRecords = await inspectTree({
        ignoreTopLevelChromiumSingletonSymlinks: true,
        root: sourceAccount,
      });

      expect(sourceAfterRecords).toEqual(sourceRecords);
      expect(sourceRecords.map(({ relativePath }) => relativePath)).toEqual([
        'Default/Cookies',
        'Default',
        '',
      ]);

      const serialized = serializeKemerBetReadinessProfileManifest({
        accountIdSha256: createHash('sha256').update(ACCOUNT_ID).digest('hex'),
        contract: 'fetanagent-kemerbet-readiness-profile-snapshot-v1',
        directoryCount: sourceRecords.filter(({ type }) => type === 'directory').length,
        fileCount: sourceRecords.filter(({ type }) => type === 'file').length,
        treeSha256: createKemerBetReadinessProfileTreeDigest(sourceRecords),
        version: 1,
      });
      for (const singletonName of singletonNames) expect(serialized).not.toContain(singletonName);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'copies no stale singleton into the snapshot and requires all three absent during target verification',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'fetanagent-profile-singleton-copy-'));
      const sourceAccount = join(directory, 'source', ACCOUNT_ID);
      const snapshotRoot = join(directory, 'snapshot');
      const targetAccount = join(snapshotRoot, ACCOUNT_ID);
      const singletonNames = ['SingletonCookie', 'SingletonLock', 'SingletonSocket'] as const;
      await mkdir(join(sourceAccount, 'Default'), { recursive: true });
      await mkdir(snapshotRoot);
      await writeFile(join(sourceAccount, 'Default', 'Cookies'), 'session bytes');
      for (const singletonName of singletonNames) {
        await createPortableTestSymlink(
          join(directory, 'targets'),
          join(sourceAccount, singletonName),
          singletonName,
        );
      }

      try {
        const sourceRecords = await inspectTree({
          copyToRoot: snapshotRoot,
          ignoreTopLevelChromiumSingletonSymlinks: true,
          root: sourceAccount,
        });
        const targetRecords = await inspectTree({ root: targetAccount });
        expect(targetRecords).toEqual(sourceRecords);
        for (const singletonName of singletonNames) {
          await expect(lstat(join(targetAccount, singletonName))).rejects.toMatchObject({
            code: 'ENOENT',
          });
        }
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  it('rejects singleton replacement types plus every nested, other, or target-side symlink', async () => {
    const cases = [
      {
        arrange: async (root: string, _targetRoot: string) =>
          writeFile(join(root, 'SingletonLock'), 'replacement'),
        name: 'top-level singleton regular file',
        sourcePolicy: true,
      },
      {
        arrange: async (root: string, _targetRoot: string) => mkdir(join(root, 'SingletonCookie')),
        name: 'top-level singleton directory',
        sourcePolicy: true,
      },
      {
        arrange: async (root: string, targetRoot: string) => {
          await mkdir(join(root, 'Default'));
          await createPortableTestSymlink(
            targetRoot,
            join(root, 'Default', 'SingletonSocket'),
            'nested-singleton',
          );
        },
        name: 'nested singleton symlink',
        sourcePolicy: true,
      },
      {
        arrange: async (root: string, targetRoot: string) =>
          createPortableTestSymlink(targetRoot, join(root, 'SingletonOther'), 'other'),
        name: 'other top-level symlink',
        sourcePolicy: true,
      },
      {
        arrange: async (root: string, targetRoot: string) =>
          createPortableTestSymlink(targetRoot, join(root, 'SingletonSocket'), 'target-singleton'),
        name: 'target-side singleton symlink',
        sourcePolicy: false,
      },
    ] as const;

    for (const testCase of cases) {
      const directory = await mkdtemp(join(tmpdir(), 'fetanagent-profile-reject-'));
      const root = join(directory, ACCOUNT_ID);
      await mkdir(root);
      try {
        await testCase.arrange(root, join(directory, 'targets'));
        await expect(
          inspectTree({
            ignoreTopLevelChromiumSingletonSymlinks: testCase.sourcePolicy,
            root,
          }),
          testCase.name,
        ).rejects.toBeInstanceOf(KemerBetReadinessProfileSnapshotUnavailableError);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  });

  it('creates a deterministic metadata-and-content tree digest independent of traversal order', () => {
    const digest = createKemerBetReadinessProfileTreeDigest(RECORDS);
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(createKemerBetReadinessProfileTreeDigest([...RECORDS].reverse())).toBe(digest);
    expect(
      createKemerBetReadinessProfileTreeDigest([
        ...RECORDS.slice(0, 1).map((record) => ({ ...record, mode: 0o400 })),
        ...RECORDS.slice(1),
      ]),
    ).not.toBe(digest);
    expect(
      createKemerBetReadinessProfileTreeDigest([
        { ...RECORDS[0]!, contentSha256: 'b'.repeat(64) },
        ...RECORDS.slice(1),
      ]),
    ).not.toBe(digest);
  });

  it('rejects a per-file or cumulative logical-byte budget overflow without allocating content', () => {
    const { maximumFileBytes, maximumTreeBytes } = KEMERBET_READINESS_PROFILE_SNAPSHOT_LIMITS;
    const file = RECORDS[0]!;
    expect(() =>
      createKemerBetReadinessProfileTreeDigest([
        { ...file, size: maximumFileBytes + 1 },
        ...RECORDS.slice(1),
      ]),
    ).toThrow(KemerBetReadinessProfileSnapshotUnavailableError);
    expect(() =>
      createKemerBetReadinessProfileTreeDigest([
        ...Array.from({ length: maximumTreeBytes / maximumFileBytes + 1 }, (_, index) => ({
          ...file,
          relativePath: `Default/${index}`,
          size: maximumFileBytes,
        })),
        ...RECORDS.slice(1),
      ]),
    ).toThrow(KemerBetReadinessProfileSnapshotUnavailableError);
  });

  it('enforces the streaming read ceiling before hashing or writing an overflow byte', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fetanagent-profile-budget-'));
    const sourcePath = join(directory, 'source');
    const exactPath = join(directory, 'exact');
    const overflowPath = join(directory, 'overflow');
    await writeFile(sourcePath, Buffer.from('abcd'));
    let source = await open(sourcePath, 'r');
    let destination = await open(exactPath, 'wx+');
    try {
      await expect(
        hashKemerBetReadinessProfileOpenedFile(source, destination, 4),
      ).resolves.toMatchObject({
        bytes: 4,
        digest: createHash('sha256').update('abcd').digest('hex'),
      });
    } finally {
      await destination.close();
      await source.close();
    }

    source = await open(sourcePath, 'r');
    destination = await open(overflowPath, 'wx+');
    try {
      await expect(
        hashKemerBetReadinessProfileOpenedFile(source, destination, 3),
      ).rejects.toBeInstanceOf(KemerBetReadinessProfileSnapshotUnavailableError);
      expect((await destination.stat()).size).toBe(0);
    } finally {
      await destination.close();
      await source.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('serializes only aggregate hashes/counts and round-trips the canonical root-only manifest', () => {
    const manifest = {
      accountIdSha256: createHash('sha256').update(ACCOUNT_ID).digest('hex'),
      contract: 'fetanagent-kemerbet-readiness-profile-snapshot-v1' as const,
      directoryCount: 2,
      fileCount: 1,
      treeSha256: createKemerBetReadinessProfileTreeDigest(RECORDS),
      version: 1 as const,
    };
    const serialized = serializeKemerBetReadinessProfileManifest(manifest);
    expect(parseKemerBetReadinessProfileManifest(serialized)).toEqual(manifest);
    expect(serialized).not.toContain(ACCOUNT_ID);
    expect(serialized).not.toContain('Cookies');
    expect(serialized).not.toContain('Default');
    expect(serialized).not.toContain('session bytes');
  });

  it('requires read-write snapshot output only while creating and read-only output while verifying', () => {
    const valid = [
      '30 20 0:1 / /run/source ro,nosuid,nodev - ext4 /dev/x ro',
      '31 20 0:2 / /run/snapshot rw,nosuid,nodev - tmpfs tmpfs rw',
      '32 20 0:3 / /run/output rw,nosuid,nodev - tmpfs tmpfs rw',
      '',
    ].join('\n');
    expect(() => assertKemerBetReadinessProfileMountInfo(valid)).not.toThrow();
    const validVerify = valid
      .split('\n')
      .filter((line) => !line.includes('/run/snapshot'))
      .join('\n')
      .replace('output rw', 'output ro')
      .replace('tmpfs rw', 'tmpfs ro');
    expect(() => assertKemerBetReadinessProfileMountInfo(validVerify, 'verify')).not.toThrow();
    expect(() =>
      assertKemerBetReadinessProfileMountInfo(validVerify, 'verify-original'),
    ).not.toThrow();
    expect(() => assertKemerBetReadinessProfileMountInfo(valid, 'verify')).toThrow(
      KemerBetReadinessProfileSnapshotUnavailableError,
    );
    expect(() =>
      assertKemerBetReadinessProfileMountInfo(valid.replace('source ro', 'source rw')),
    ).toThrow(KemerBetReadinessProfileSnapshotUnavailableError);
    expect(() =>
      assertKemerBetReadinessProfileMountInfo(valid.replace('snapshot rw', 'snapshot ro')),
    ).toThrow(KemerBetReadinessProfileSnapshotUnavailableError);
    expect(() =>
      assertKemerBetReadinessProfileMountInfo(valid.replace('output rw', 'output ro')),
    ).toThrow(KemerBetReadinessProfileSnapshotUnavailableError);
  });

  it('runs snapshot and verify only as root, offline, for the secret-loaded exact account', async () => {
    const snapshot = vi.fn(async () => undefined);
    const verify = vi.fn(async () => undefined);
    const verifyOriginal = vi.fn(async () => undefined);
    const mountModes: string[] = [];
    const common = {
      assertMountContract: async (mode: 'snapshot' | 'verify' | 'verify-original') => {
        mountModes.push(mode);
      },
      assertOfflineNetwork: vi.fn(),
      effectiveGroupId: 0,
      effectiveUserId: 0,
      loadAccountId: async () => ACCOUNT_ID,
      snapshot,
      verify,
      verifyOriginal,
    };
    await runKemerBetReadinessProfileSnapshot('snapshot', common);
    await runKemerBetReadinessProfileSnapshot('verify', common);
    await runKemerBetReadinessProfileSnapshot('verify-original', common);
    expect(snapshot).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(verify).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(verifyOriginal).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(mountModes).toEqual(['snapshot', 'verify', 'verify-original']);
    expect(common.assertOfflineNetwork).toHaveBeenCalledTimes(3);
  });

  it('rejects non-root execution before reading the account secret', async () => {
    const loadAccountId = vi.fn(async () => ACCOUNT_ID);
    await expect(
      runKemerBetReadinessProfileSnapshot('snapshot', {
        assertMountContract: async () => undefined,
        assertOfflineNetwork: vi.fn(),
        effectiveGroupId: 0,
        effectiveUserId: 10001,
        loadAccountId,
        snapshot: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(KemerBetReadinessProfileSnapshotUnavailableError);
    expect(loadAccountId).not.toHaveBeenCalled();
  });

  it('exports no-network, secret-file-only account selection and exact mount contract', () => {
    expect(KEMERBET_READINESS_PROFILE_SNAPSHOT_RUNTIME_CONTRACT).toMatchObject({
      commands: {
        snapshot: ['node', 'apps/executor/dist/kemerbet-readiness-profile-snapshot.js', 'snapshot'],
        verify: ['node', 'apps/executor/dist/kemerbet-readiness-profile-snapshot.js', 'verify'],
        verifyOriginal: [
          'node',
          'apps/executor/dist/kemerbet-readiness-profile-snapshot.js',
          'verify-original',
        ],
      },
      environment: [],
      groupId: 0,
      manifest: { file: '/run/output/profile-manifest', mode: 0o400 },
      mountsByCommand: {
        snapshot: {
          accountId: {
            file: '/run/secrets/kemerbet_readiness_account_id',
            mode: 0o400,
            readOnly: true,
          },
          output: { path: '/run/output', readOnly: false },
          snapshot: { path: '/run/snapshot', readOnly: false },
          source: { path: '/run/source', readOnly: true },
        },
        verify: {
          accountId: {
            file: '/run/secrets/kemerbet_readiness_account_id',
            mode: 0o400,
            readOnly: true,
          },
          forbiddenPath: '/run/snapshot',
          output: { path: '/run/output', readOnly: true },
          source: { path: '/run/source', readOnly: true },
        },
        verifyOriginal: {
          accountId: {
            file: '/run/secrets/kemerbet_readiness_account_id',
            mode: 0o400,
            readOnly: true,
          },
          forbiddenPath: '/run/snapshot',
          output: { path: '/run/output', readOnly: true },
          source: { path: '/run/source', readOnly: true },
        },
      },
      networkMode: 'none',
      resourceLimits: {
        maximumFileBytes: 256 * 1024 * 1024,
        maximumTreeBytes: 1024 * 1024 * 1024,
      },
      postVerifyHandoff: {
        browserRootGroupId: 10001,
        browserRootMode: 0o700,
        browserRootUserId: 10001,
      },
      userId: 0,
    });
  });
});
