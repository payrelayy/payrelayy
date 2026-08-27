import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  acquireKemerBetSessionProfileGenerationLease,
  KEMERBET_SESSION_PROFILE_GENERATION_LEASE_CONTRACT,
  KemerBetSessionProfileGenerationLeaseUnavailableError,
  type KemerBetSessionProfileGenerationLeaseFileSystem,
} from './kemerbet-session-profile-generation-lease.js';

function fakeLeaseFileSystem(): {
  readonly fileSystem: KemerBetSessionProfileGenerationLeaseFileSystem;
  readonly markerPresent: () => boolean;
  readonly replaceMarker: () => void;
  readonly writes: () => number;
} {
  const profile = resolve('kemerbet-profile');
  const marker = resolve(profile, KEMERBET_SESSION_PROFILE_GENERATION_LEASE_CONTRACT.markerName);
  let markerExists = false;
  let markerInode = 2;
  let writeCount = 0;
  const directoryStat = () => ({
    dev: 1,
    gid: 10_001,
    ino: 1,
    mode: 0o700,
    nlink: 1,
    uid: 10_001,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  });
  const markerStat = () => ({
    dev: 1,
    gid: 10_001,
    ino: markerInode,
    mode: 0o600,
    nlink: 1,
    uid: 10_001,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  });
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const fileSystem: KemerBetSessionProfileGenerationLeaseFileSystem = {
    lstat: async (path) => {
      if (path === profile) return directoryStat();
      if (path === marker && markerExists) return markerStat();
      throw missing();
    },
    open: async (path) => {
      if (path === profile) {
        return {
          close: async () => undefined,
          stat: async () => directoryStat(),
          sync: async () => undefined,
          writeFile: async () => {
            throw new Error('directory_write');
          },
        };
      }
      if (path !== marker || markerExists) {
        throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      }
      markerExists = true;
      return {
        close: async () => undefined,
        stat: async () => markerStat(),
        sync: async () => undefined,
        writeFile: async () => {
          writeCount += 1;
        },
      };
    },
    realpath: async (path) => {
      if (path === profile || (path === marker && markerExists)) return path;
      throw missing();
    },
    unlink: async (path) => {
      if (path !== marker || !markerExists) throw missing();
      markerExists = false;
    },
  };
  return {
    fileSystem,
    markerPresent: () => markerExists,
    replaceMarker: () => {
      if (!markerExists) throw new Error('missing marker');
      markerInode += 1;
    },
    writes: () => writeCount,
  };
}

describe('KemerBet persistent-session profile generation lease', () => {
  it('blocks every fresh process until the current generation proves a clean checkpoint', async () => {
    const profile = resolve('kemerbet-profile');
    const fake = fakeLeaseFileSystem();
    const lease = await acquireKemerBetSessionProfileGenerationLease(
      profile,
      10_001,
      fake.fileSystem,
    );

    expect(fake.markerPresent()).toBe(true);
    expect(fake.writes()).toBe(1);
    await expect(
      acquireKemerBetSessionProfileGenerationLease(profile, 10_001, fake.fileSystem),
    ).rejects.toBeInstanceOf(KemerBetSessionProfileGenerationLeaseUnavailableError);

    await lease.releaseAfterCleanCheckpoint();
    expect(fake.markerPresent()).toBe(false);
    await expect(lease.releaseAfterCleanCheckpoint()).rejects.toBeInstanceOf(
      KemerBetSessionProfileGenerationLeaseUnavailableError,
    );
    await expect(
      acquireKemerBetSessionProfileGenerationLease(profile, 10_001, fake.fileSystem),
    ).resolves.toBeDefined();
  });

  it('never removes a replaced or ambiguous marker during clean release', async () => {
    const profile = resolve('kemerbet-profile');
    const fake = fakeLeaseFileSystem();
    const lease = await acquireKemerBetSessionProfileGenerationLease(
      profile,
      10_001,
      fake.fileSystem,
    );
    fake.replaceMarker();

    await expect(lease.releaseAfterCleanCheckpoint()).rejects.toBeInstanceOf(
      KemerBetSessionProfileGenerationLeaseUnavailableError,
    );
    expect(fake.markerPresent()).toBe(true);
  });
});
