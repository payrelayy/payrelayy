import { constants, type Stats } from 'node:fs';
import { dirname } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeNodeKind = 'directory' | 'file' | 'symlink';

interface FakeNode {
  readonly dev: number;
  gid: number;
  readonly ino: number;
  kind: FakeNodeKind;
  mode: number;
  nlink: number;
  data: Buffer;
  realPath: string;
  uid: number;
}

interface FakeDescriptor {
  readonly node: FakeNode;
  readonly openedPath: string;
}

class FakeFixedStageFileSystem {
  readonly operations: string[] = [];
  readonly nodes = new Map<string, FakeNode>();
  failFileFsync = false;
  maxWriteBytes = Number.POSITIVE_INFINITY;
  swapStagePathAfterRead = false;

  private readonly descriptors = new Map<number, FakeDescriptor>();
  private nextDescriptor = 20;
  private nextInode = 100;

  constructor(
    readonly effectiveUserId: number,
    readonly stagePath: string,
    initialStage: string,
  ) {
    const outputRoot = dirname(stagePath);
    this.nodes.set(
      outputRoot,
      this.createNode('directory', effectiveUserId, 0o700, Buffer.alloc(0), outputRoot),
    );
    this.nodes.set(
      stagePath,
      this.createNode(
        'file',
        effectiveUserId,
        0o400,
        Buffer.from(`${initialStage}\n`, 'ascii'),
        stagePath,
      ),
    );
  }

  currentNode(): FakeNode {
    return this.requireNode(this.stagePath);
  }

  installExistingInstallingFile(): void {
    const installingPath = `${this.stagePath}.installing`;
    this.nodes.set(
      installingPath,
      this.createNode('file', this.effectiveUserId, 0o600, Buffer.alloc(0), installingPath),
    );
  }

  closeSync(descriptor: number): void {
    this.operations.push(`close:${descriptor}`);
    if (!this.descriptors.delete(descriptor)) this.fail('EBADF');
  }

  fchmodSync(descriptor: number, mode: number): void {
    this.operations.push(`fchmod:${descriptor}:${mode.toString(8)}`);
    this.requireDescriptor(descriptor).node.mode =
      this.typeBits(this.requireDescriptor(descriptor).node.kind) | mode;
  }

  fstatSync(descriptor: number): Stats {
    this.operations.push(`fstat:${descriptor}`);
    return this.stats(this.requireDescriptor(descriptor).node);
  }

  fsyncSync(descriptor: number): void {
    const opened = this.requireDescriptor(descriptor);
    this.operations.push(`fsync:${opened.node.kind}:${opened.openedPath}`);
    if (this.failFileFsync && opened.node.kind === 'file') this.fail('EIO');
  }

  lstatSync(filePath: string): Stats {
    this.operations.push(`lstat:${filePath}`);
    return this.stats(this.requireNode(filePath));
  }

  openSync(filePath: string, flags: number, mode?: number): number {
    this.operations.push(`open:${filePath}:${flags}:${mode ?? ''}`);
    let node = this.nodes.get(filePath);
    if ((flags & constants.O_CREAT) !== 0) {
      if (node !== undefined && (flags & constants.O_EXCL) !== 0) this.fail('EEXIST');
      if (node === undefined) {
        node = this.createNode('file', this.effectiveUserId, mode ?? 0, Buffer.alloc(0), filePath);
        this.nodes.set(filePath, node);
      }
    }
    if (node === undefined) this.fail('ENOENT');
    if (node.kind === 'symlink' && (flags & (constants.O_NOFOLLOW ?? 0)) !== 0) {
      this.fail('ELOOP');
    }
    const descriptor = this.nextDescriptor;
    this.nextDescriptor += 1;
    this.descriptors.set(descriptor, { node, openedPath: filePath });
    return descriptor;
  }

  readFileSync(descriptor: number): Buffer {
    const opened = this.requireDescriptor(descriptor);
    this.operations.push(`read:${descriptor}`);
    const result = Buffer.from(opened.node.data);
    if (this.swapStagePathAfterRead && opened.openedPath === this.stagePath) {
      this.swapStagePathAfterRead = false;
      this.nodes.set(
        this.stagePath,
        this.createNode(
          'file',
          this.effectiveUserId,
          0o400,
          Buffer.from(opened.node.data),
          this.stagePath,
        ),
      );
      this.operations.push(`swap:${this.stagePath}`);
    }
    return result;
  }

  realpathSync(filePath: string): string {
    this.operations.push(`realpath:${filePath}`);
    return this.requireNode(filePath).realPath;
  }

  renameSync(fromPath: string, toPath: string): void {
    this.operations.push(`rename:${fromPath}:${toPath}`);
    const node = this.requireNode(fromPath);
    this.nodes.delete(fromPath);
    node.realPath = toPath;
    this.nodes.set(toPath, node);
  }

  unlinkSync(filePath: string): void {
    this.operations.push(`unlink:${filePath}`);
    if (!this.nodes.delete(filePath)) this.fail('ENOENT');
  }

  writeSync(
    descriptor: number,
    serialized: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number {
    const opened = this.requireDescriptor(descriptor);
    const written = Math.min(length, this.maxWriteBytes);
    this.operations.push(`write:${descriptor}:${offset}:${written}:${position}`);
    const requiredLength = Math.max(opened.node.data.length, position + written);
    const next = Buffer.alloc(requiredLength);
    opened.node.data.copy(next);
    Buffer.from(serialized).copy(next, position, offset, offset + written);
    opened.node.data = next;
    return written;
  }

  private createNode(
    kind: FakeNodeKind,
    userId: number,
    permissions: number,
    data: Buffer,
    realPath: string,
  ): FakeNode {
    const node: FakeNode = {
      data,
      dev: 1,
      gid: userId,
      ino: this.nextInode,
      kind,
      mode: this.typeBits(kind) | permissions,
      nlink: 1,
      realPath,
      uid: userId,
    };
    this.nextInode += 1;
    return node;
  }

  private fail(code: string): never {
    throw Object.assign(new Error(code), { code });
  }

  private requireDescriptor(descriptor: number): FakeDescriptor {
    const opened = this.descriptors.get(descriptor);
    if (opened === undefined) this.fail('EBADF');
    return opened;
  }

  private requireNode(filePath: string): FakeNode {
    const node = this.nodes.get(filePath);
    if (node === undefined) this.fail('ENOENT');
    return node;
  }

  private stats(node: FakeNode): Stats {
    return {
      dev: node.dev,
      gid: node.gid,
      ino: node.ino,
      isDirectory: () => node.kind === 'directory',
      isFile: () => node.kind === 'file',
      isSymbolicLink: () => node.kind === 'symlink',
      mode: node.mode,
      nlink: node.nlink,
      size: node.data.length,
      uid: node.uid,
    } as Stats;
  }

  private typeBits(kind: FakeNodeKind): number {
    if (kind === 'directory') return 0o040000;
    if (kind === 'symlink') return 0o120000;
    return 0o100000;
  }
}

const fsHarness = vi.hoisted(() => ({
  current: undefined as unknown as FakeFixedStageFileSystem,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    closeSync: (descriptor: number) => fsHarness.current.closeSync(descriptor),
    fchmodSync: (descriptor: number, mode: number) =>
      fsHarness.current.fchmodSync(descriptor, mode),
    fstatSync: (descriptor: number) => fsHarness.current.fstatSync(descriptor),
    fsyncSync: (descriptor: number) => fsHarness.current.fsyncSync(descriptor),
    lstatSync: (filePath: string) => fsHarness.current.lstatSync(filePath),
    openSync: (filePath: string, flags: number, mode?: number) =>
      fsHarness.current.openSync(filePath, flags, mode),
    readFileSync: (descriptor: number) => fsHarness.current.readFileSync(descriptor),
    realpathSync: (filePath: string) => fsHarness.current.realpathSync(filePath),
    renameSync: (fromPath: string, toPath: string) =>
      fsHarness.current.renameSync(fromPath, toPath),
    unlinkSync: (filePath: string) => fsHarness.current.unlinkSync(filePath),
    writeSync: (
      descriptor: number,
      serialized: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ) => fsHarness.current.writeSync(descriptor, serialized, offset, length, position),
  };
});

import {
  KEMERBET_READINESS_BROWSER_STAGE_FILE,
  KEMERBET_READINESS_BROWSER_STAGES,
  KEMERBET_READINESS_CONTROLLER_STAGE_FILE,
  KEMERBET_READINESS_CONTROLLER_STAGES,
  KEMERBET_READINESS_FIXED_STAGE_CONTRACT,
  KEMERBET_READINESS_PROXY_STAGE_FILE,
  KEMERBET_READINESS_PROXY_STAGES,
  KemerBetReadinessFixedStageUnavailableError,
  recordKemerBetReadinessControllerStage,
} from './kemerbet-readiness-fixed-stage.js';

const CONTROLLER_USER_ID = 10002;
let originalGetEffectiveUserId: PropertyDescriptor | undefined;

function setEffectiveUserId(userId: number): void {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => userId,
  });
}

function expectUnavailable(action: () => void): void {
  let failure: unknown;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(KemerBetReadinessFixedStageUnavailableError);
  expect((failure as Error).message).toBe(
    'The fixed KemerBet readiness stage output is unavailable.',
  );
}

beforeEach(() => {
  originalGetEffectiveUserId = Object.getOwnPropertyDescriptor(process, 'geteuid');
  fsHarness.current = new FakeFixedStageFileSystem(
    CONTROLLER_USER_ID,
    KEMERBET_READINESS_CONTROLLER_STAGE_FILE,
    'controller_not_started',
  );
  setEffectiveUserId(CONTROLLER_USER_ID);
});

afterEach(() => {
  if (originalGetEffectiveUserId === undefined) {
    Reflect.deleteProperty(process, 'geteuid');
  } else {
    Object.defineProperty(process, 'geteuid', originalGetEffectiveUserId);
  }
  vi.restoreAllMocks();
});

describe('KemerBet readiness fixed stage output', () => {
  it('exposes only fixed bounded identifier-free stage values', () => {
    const stages = [
      ...KEMERBET_READINESS_CONTROLLER_STAGES,
      ...KEMERBET_READINESS_BROWSER_STAGES,
      ...KEMERBET_READINESS_PROXY_STAGES,
    ];
    expect(new Set(stages).size).toBe(stages.length);
    for (const stage of stages) {
      expect(stage).toMatch(/^[a-z][a-z0-9_]{1,62}$/u);
      expect(Buffer.byteLength(`${stage}\n`, 'ascii')).toBeLessThanOrEqual(
        KEMERBET_READINESS_FIXED_STAGE_CONTRACT.maxBytes,
      );
    }
    expect(JSON.stringify(stages)).not.toMatch(
      /https?:|\/Account\/|\/Player\/|token|identity_sha|digest|player_id/u,
    );
  });

  it('uses three separate role-owned output paths', () => {
    expect([
      KEMERBET_READINESS_CONTROLLER_STAGE_FILE,
      KEMERBET_READINESS_BROWSER_STAGE_FILE,
      KEMERBET_READINESS_PROXY_STAGE_FILE,
    ]).toEqual([
      '/run/fetanagent-kemerbet-readiness-controller-stage-output/stage-v1',
      '/run/fetanagent-kemerbet-readiness-browser-stage-output/stage-v1',
      '/run/fetanagent-kemerbet-readiness-proxy-stage-output/stage-v1',
    ]);
    expect(
      new Set([
        KEMERBET_READINESS_CONTROLLER_STAGE_FILE,
        KEMERBET_READINESS_BROWSER_STAGE_FILE,
        KEMERBET_READINESS_PROXY_STAGE_FILE,
      ]).size,
    ).toBe(3);
  });

  it('covers restored startup, refresh, first lookup, finalize, and cleanup checkpoints', () => {
    expect(KEMERBET_READINESS_BROWSER_STAGES).toContain('browser_restored_navigation');
    expect(KEMERBET_READINESS_BROWSER_STAGES).toContain('browser_refresh_admitted');
    expect(KEMERBET_READINESS_PROXY_STAGES).toContain('browser_refresh_forwarded');
    expect(KEMERBET_READINESS_PROXY_STAGES).toContain('browser_refresh_response_complete');
    expect(KEMERBET_READINESS_CONTROLLER_STAGES).toContain('controller_lookup_1');
    expect(KEMERBET_READINESS_CONTROLLER_STAGES).toContain('controller_finalize');
    expect(KEMERBET_READINESS_CONTROLLER_STAGES).toContain('controller_cleanup');
  });

  it('atomically writes, seals, synchronizes, renames, and revalidates a fixed stage', () => {
    fsHarness.current.maxWriteBytes = 4;

    recordKemerBetReadinessControllerStage('controller_bootstrap');

    const current = fsHarness.current.currentNode();
    expect(current.data.toString('ascii')).toBe('controller_bootstrap\n');
    expect(current.mode & 0o7777).toBe(0o400);
    expect(current.nlink).toBe(1);
    expect(
      fsHarness.current.nodes.has(`${KEMERBET_READINESS_CONTROLLER_STAGE_FILE}.installing`),
    ).toBe(false);
    expect(fsHarness.current.operations.filter((entry) => entry.startsWith('write:'))).toHaveLength(
      6,
    );

    const fileSync = fsHarness.current.operations.findIndex((entry) =>
      entry.startsWith('fsync:file:'),
    );
    const seal = fsHarness.current.operations.findIndex((entry) => entry.startsWith('fchmod:'));
    const rename = fsHarness.current.operations.findIndex((entry) => entry.startsWith('rename:'));
    const directorySync = fsHarness.current.operations.findIndex((entry) =>
      entry.startsWith('fsync:directory:'),
    );
    const finalRead = fsHarness.current.operations.findLastIndex((entry) =>
      entry.startsWith('read:'),
    );
    expect(fileSync).toBeGreaterThan(-1);
    expect(seal).toBeGreaterThan(fileSync);
    expect(rename).toBeGreaterThan(seal);
    expect(directorySync).toBeGreaterThan(rename);
    expect(finalRead).toBeGreaterThan(directorySync);
  });

  it.each([
    [
      'wrong owner',
      (node: FakeNode) => {
        node.uid += 1;
      },
    ],
    [
      'wrong group',
      (node: FakeNode) => {
        node.gid += 1;
      },
    ],
    [
      'writable mode',
      (node: FakeNode) => {
        node.mode = 0o100600;
      },
    ],
    [
      'hard link',
      (node: FakeNode) => {
        node.nlink = 2;
      },
    ],
    [
      'symbolic link',
      (node: FakeNode) => {
        node.kind = 'symlink';
        node.mode = 0o120777;
      },
    ],
  ] as const)('fails closed before writing when the current stage has a %s', (_label, mutate) => {
    mutate(fsHarness.current.currentNode());

    expectUnavailable(() => recordKemerBetReadinessControllerStage('controller_bootstrap'));

    expect(fsHarness.current.operations.some((entry) => entry.startsWith('rename:'))).toBe(false);
    expect(
      fsHarness.current.nodes.has(`${KEMERBET_READINESS_CONTROLLER_STAGE_FILE}.installing`),
    ).toBe(false);
  });

  it('fails closed when the stage path is exchanged after its descriptor is opened', () => {
    fsHarness.current.swapStagePathAfterRead = true;

    expectUnavailable(() => recordKemerBetReadinessControllerStage('controller_bootstrap'));

    expect(fsHarness.current.operations).toContain(
      `swap:${KEMERBET_READINESS_CONTROLLER_STAGE_FILE}`,
    );
    expect(fsHarness.current.operations.some((entry) => entry.startsWith('rename:'))).toBe(false);
  });

  it('refuses a pre-existing installing path without replacing the current stage', () => {
    fsHarness.current.installExistingInstallingFile();
    const before = Buffer.from(fsHarness.current.currentNode().data);

    expectUnavailable(() => recordKemerBetReadinessControllerStage('controller_bootstrap'));

    expect(fsHarness.current.currentNode().data).toEqual(before);
    expect(fsHarness.current.operations.some((entry) => entry.startsWith('rename:'))).toBe(false);
  });

  it('removes the installing file and preserves the prior stage when file fsync fails', () => {
    fsHarness.current.failFileFsync = true;
    const before = Buffer.from(fsHarness.current.currentNode().data);

    expectUnavailable(() => recordKemerBetReadinessControllerStage('controller_bootstrap'));

    expect(fsHarness.current.currentNode().data).toEqual(before);
    expect(fsHarness.current.operations).toContain(
      `unlink:${KEMERBET_READINESS_CONTROLLER_STAGE_FILE}.installing`,
    );
    expect(fsHarness.current.operations.some((entry) => entry.startsWith('rename:'))).toBe(false);
  });

  it('fails closed before filesystem access when the effective user is not the fixed role owner', () => {
    setEffectiveUserId(CONTROLLER_USER_ID + 1);

    expectUnavailable(() => recordKemerBetReadinessControllerStage('controller_bootstrap'));

    expect(fsHarness.current.operations).toEqual([]);
  });
});
