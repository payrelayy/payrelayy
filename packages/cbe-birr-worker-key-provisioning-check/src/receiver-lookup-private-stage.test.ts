import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT,
  CbeBirrReceiverPrivateStageError,
  prepareCbeBirrReceiverDeliveryBundle,
  prepareCbeBirrReceiverProvisioningCandidate,
  stageCbeBirrReceiverDeliveryBundle,
  type CbeBirrReceiverPrivateStageInput,
  type CbeBirrReceiverStageFileSystem,
  type CbeBirrReceiverStageStat,
} from './index.js';

const actorAuthUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef';
const receiverRevisionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const receiverVersion = 3;
const workerUid = 10_001;
const root = CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT;

type MemoryNode = {
  kind: 'directory' | 'file' | 'symlink';
  uid: number;
  gid: number;
  mode: number;
  ino: number;
  bytes: Buffer;
  target?: string;
};

function stat(node: MemoryNode): CbeBirrReceiverStageStat {
  return {
    dev: 7,
    ino: node.ino,
    uid: node.uid,
    gid: node.gid,
    mode: node.mode,
    nlink: node.kind === 'directory' ? 2 : 1,
    size: node.kind === 'directory' ? 4096 : node.bytes.length,
    isDirectory: () => node.kind === 'directory',
    isFile: () => node.kind === 'file',
    isSymbolicLink: () => node.kind === 'symlink',
  };
}

class MemoryStageFileSystem implements CbeBirrReceiverStageFileSystem {
  readonly noFollowFlag = 0o400000;
  readonly directoryFlag = 0o200000;
  readonly nodes = new Map<string, MemoryNode>([
    [
      root,
      {
        kind: 'directory',
        uid: 0,
        gid: 0,
        mode: 0o040700,
        ino: 1,
        bytes: Buffer.alloc(0),
      },
    ],
  ]);
  readonly openFlags: number[] = [];
  failWriteNumber?: number;
  corruptReadPath?: string;
  private nextInode = 2;
  private writeNumber = 0;

  async lstat(path: string): Promise<CbeBirrReceiverStageStat> {
    const node = this.nodes.get(path);
    if (!node) throw new Error('Missing synthetic path');
    return stat(node);
  }

  async realpath(path: string): Promise<string> {
    const node = this.nodes.get(path);
    if (!node) throw new Error('Missing synthetic path');
    return node.target ?? path;
  }

  async readdir(path: string): Promise<string[]> {
    if (path !== root || !this.nodes.has(root)) throw new Error('Missing synthetic directory');
    return [...this.nodes.keys()]
      .filter((key) => key !== root)
      .map((key) => key.slice(root.length + 1));
  }

  async open(path: string, flags: number, mode?: number) {
    this.openFlags.push(flags);
    if ((flags & this.noFollowFlag) === 0) throw new Error('No-follow required');
    let node = this.nodes.get(path);
    if ((flags & constants.O_CREAT) !== 0) {
      if (node || path === root || mode !== 0o600 || (flags & constants.O_EXCL) === 0) {
        throw new Error('Invalid synthetic exclusive create');
      }
      node = {
        kind: 'file',
        uid: 0,
        gid: 0,
        mode: 0o100600,
        ino: this.nextInode++,
        bytes: Buffer.alloc(0),
      };
      this.nodes.set(path, node);
    }
    if (!node || node.kind === 'symlink') throw new Error('Missing or linked synthetic path');
    const selected = node;
    return {
      stat: async () => stat(selected),
      write: async (buffer: Buffer, offset: number, length: number, position: number) => {
        this.writeNumber += 1;
        if (this.writeNumber === this.failWriteNumber) throw new Error('Synthetic write failure');
        if (selected.kind !== 'file') throw new Error('Cannot write directory');
        const next = Buffer.alloc(Math.max(selected.bytes.length, position + length));
        selected.bytes.copy(next);
        buffer.copy(next, position, offset, offset + length);
        selected.bytes = next;
        return { bytesWritten: length };
      },
      read: async (buffer: Buffer, offset: number, length: number, position: number) => {
        const bytesRead = selected.bytes.copy(buffer, offset, position, position + length);
        if (path === this.corruptReadPath && bytesRead > 0) buffer[offset] = buffer[offset]! ^ 1;
        return { bytesRead };
      },
      chown: async (uid: number, gid: number) => {
        selected.uid = uid;
        selected.gid = gid;
      },
      chmod: async (nextMode: number) => {
        selected.mode = (selected.mode & 0o170000) | nextMode;
      },
      sync: async () => undefined,
      close: async () => undefined,
    };
  }

  async unlink(path: string): Promise<void> {
    if (!this.nodes.delete(path)) throw new Error('Missing synthetic path');
  }
}

function snapshot() {
  return {
    receiverRevisionId,
    receiverVersion,
    protectionProfileVersion: 2 as const,
    encryptionKeyVersion: 2 as const,
    fingerprintKeyVersion: 2 as const,
  };
}

function fingerprint(secret: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex')}`;
}

async function input(
  reader: CbeBirrReceiverPrivateStageInput['readActiveSnapshot'] = async () => snapshot(),
) {
  const candidate = await prepareCbeBirrReceiverProvisioningCandidate({
    actorAuthUserId,
    approvedReceiverRevision: { receiverRevisionId, receiverVersion },
    approvedRootProfile: {
      version: 2,
      purpose: 'cbe_birr_receiver_lookup',
      encryptionMasterFingerprint: fingerprint('a'.repeat(64)),
      fingerprintMasterFingerprint: fingerprint('b'.repeat(64)),
    },
    ownerSecrets: {
      encryptionMasterSecret: 'a'.repeat(64),
      fingerprintMasterSecret: 'b'.repeat(64),
    },
    deploymentTarget: 'production',
    readActiveSnapshot: async () => snapshot(),
  });
  const bundle = await prepareCbeBirrReceiverDeliveryBundle({
    candidate,
    actorAuthUserId,
    approvedPins: { ...candidate.proposedPins },
    readActiveSnapshot: async () => snapshot(),
  });
  return {
    bundle,
    approvedPins: { ...bundle.approvedPins },
    approvedWorkerUserId: workerUid,
    actorAuthUserId,
    readActiveSnapshot: reader,
  };
}

const linuxRoot = { platform: 'linux' as const, effectiveUserId: 0 };

describe('private CBE receiver file staging', () => {
  it('stages exactly three one-use files and preserves the loader ownership contract', async () => {
    const fileSystem = new MemoryStageFileSystem();
    const readActiveSnapshot = vi.fn(async () => snapshot());
    const prepared = await input(readActiveSnapshot);
    const result = await stageCbeBirrReceiverDeliveryBundle(prepared, {
      ...linuxRoot,
      fileSystem,
    });
    expect(result.disposition).toBe('private_files_staged_only');
    expect(result.approvedPins).toEqual(prepared.approvedPins);
    expect(readActiveSnapshot).toHaveBeenCalledTimes(2);
    expect(fileSystem.nodes.size).toBe(4);
    const key = fileSystem.nodes.get(join(root, 'receiver-child-key.v1.json'))!;
    const workerProfile = fileSystem.nodes.get(join(root, 'receiver-opening-profile.v1.json'))!;
    const ownerProfile = fileSystem.nodes.get(join(root, 'owner-root-profile.v2.json'))!;
    expect([key.uid, key.gid, key.mode & 0o7777]).toEqual([workerUid, workerUid, 0o400]);
    expect([workerProfile.uid, workerProfile.mode & 0o7777]).toEqual([0, 0o444]);
    expect([ownerProfile.uid, ownerProfile.mode & 0o7777]).toEqual([0, 0o444]);
    expect(JSON.parse(key.bytes.toString('utf8')).keyId).toBe(prepared.approvedPins.workerKeyId);
    expect(fileSystem.openFlags.every((flags) => (flags & fileSystem.noFollowFlag) !== 0)).toBe(
      true,
    );
    expect(prepared.bundle.files.every((file) => file.bytes.every((byte) => byte === 0))).toBe(
      true,
    );
  });

  it('refuses a retired revision after writing and removes its staged files', async () => {
    const fileSystem = new MemoryStageFileSystem();
    const readActiveSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce({ ...snapshot(), receiverVersion: receiverVersion + 1 });
    const prepared = await input(readActiveSnapshot);
    await expect(
      stageCbeBirrReceiverDeliveryBundle(prepared, {
        ...linuxRoot,
        fileSystem,
      }),
    ).rejects.toThrow(CbeBirrReceiverPrivateStageError);
    expect(fileSystem.nodes.size).toBe(1);
    expect(prepared.bundle.files.every((file) => file.bytes.every((byte) => byte === 0))).toBe(
      true,
    );
  });

  it('cleans up a partial write and never overwrites a nonempty or linked root', async () => {
    const failing = new MemoryStageFileSystem();
    failing.failWriteNumber = 2;
    await expect(
      stageCbeBirrReceiverDeliveryBundle(await input(), {
        ...linuxRoot,
        fileSystem: failing,
      }),
    ).rejects.toThrow(CbeBirrReceiverPrivateStageError);
    expect(failing.nodes.size).toBe(1);

    const nonempty = new MemoryStageFileSystem();
    nonempty.nodes.set(join(root, 'unexpected'), {
      kind: 'file',
      uid: 0,
      gid: 0,
      mode: 0o100600,
      ino: 9,
      bytes: Buffer.from('x'),
    });
    await expect(
      stageCbeBirrReceiverDeliveryBundle(await input(), {
        ...linuxRoot,
        fileSystem: nonempty,
      }),
    ).rejects.toThrow(CbeBirrReceiverPrivateStageError);
    expect(nonempty.nodes.size).toBe(2);

    const linked = new MemoryStageFileSystem();
    linked.nodes.get(root)!.kind = 'symlink';
    linked.nodes.get(root)!.target = '/tmp/redirected';
    await expect(
      stageCbeBirrReceiverDeliveryBundle(await input(), {
        ...linuxRoot,
        fileSystem: linked,
      }),
    ).rejects.toThrow(CbeBirrReceiverPrivateStageError);
    expect(linked.nodes.size).toBe(1);
  });

  it('rejects altered material before writing and detects corruption after writing', async () => {
    const altered = await input();
    altered.bundle.files[0]!.bytes[0] = altered.bundle.files[0]!.bytes[0]! ^ 1;
    const untouched = new MemoryStageFileSystem();
    await expect(
      stageCbeBirrReceiverDeliveryBundle(altered, { ...linuxRoot, fileSystem: untouched }),
    ).rejects.toThrow(CbeBirrReceiverPrivateStageError);
    expect(untouched.nodes.size).toBe(1);
    expect(altered.bundle.files.every((file) => file.bytes.every((byte) => byte === 0))).toBe(true);

    const corrupt = new MemoryStageFileSystem();
    corrupt.corruptReadPath = join(root, 'receiver-child-key.v1.json');
    await expect(
      stageCbeBirrReceiverDeliveryBundle(await input(), {
        ...linuxRoot,
        fileSystem: corrupt,
      }),
    ).rejects.toThrow(CbeBirrReceiverPrivateStageError);
    expect(corrupt.nodes.size).toBe(1);
  });

  it('rejects a copied bundle, a different release pin, and an unapproved worker UID', async () => {
    for (const change of [
      (prepared: Awaited<ReturnType<typeof input>>) => ({
        ...prepared,
        bundle: { ...prepared.bundle } as typeof prepared.bundle,
      }),
      (prepared: Awaited<ReturnType<typeof input>>) => ({
        ...prepared,
        approvedPins: { ...prepared.approvedPins, workerKeyId: `sha256:${'0'.repeat(64)}` },
      }),
      (prepared: Awaited<ReturnType<typeof input>>) => ({
        ...prepared,
        approvedWorkerUserId: 0,
      }),
    ]) {
      const fileSystem = new MemoryStageFileSystem();
      await expect(
        stageCbeBirrReceiverDeliveryBundle(change(await input()), {
          ...linuxRoot,
          fileSystem,
        }),
      ).rejects.toThrow(CbeBirrReceiverPrivateStageError);
      expect(fileSystem.nodes.size).toBe(1);
    }
  });
});
