import { resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  KemerBetChromiumProfileUnavailableError,
  purgeKemerBetPersistedServiceWorkerState,
  type KemerBetServiceWorkerPurgeFileSystem,
} from './kemerbet-chromium-profile.js';

type Entry = { readonly kind: 'directory' | 'file' | 'symlink'; readonly nlink?: number };

function memoryFileSystem(profile: string, initial: Readonly<Record<string, Entry>>) {
  const entries = new Map<string, Entry>(
    Object.entries(initial).map(([relative, entry]) => [resolve(profile, relative), entry]),
  );
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const stat = (entry: Entry) => ({
    gid: 10001,
    mode: entry.kind === 'directory' ? 0o40700 : 0o100600,
    nlink: entry.nlink ?? 1,
    uid: 10001,
    isDirectory: () => entry.kind === 'directory',
    isFile: () => entry.kind === 'file',
    isSymbolicLink: () => entry.kind === 'symlink',
  });
  const fileSystem: KemerBetServiceWorkerPurgeFileSystem = {
    lstat: async (path) => {
      const entry = entries.get(path);
      if (entry === undefined) throw missing();
      return stat(entry);
    },
    open: async () => ({ close: async () => undefined, sync: async () => undefined }) as never,
    readdir: async (path) => {
      const prefix = `${path}${sep}`;
      return [
        ...new Set(
          [...entries.keys()]
            .filter((candidate) => candidate.startsWith(prefix))
            .map((candidate) => candidate.slice(prefix.length).split(sep)[0]!)
            .filter((name) => name !== ''),
        ),
      ];
    },
    realpath: async (path) => path,
    rename: async (from, to) => {
      const moving = [...entries.entries()].filter(
        ([path]) => path === from || path.startsWith(`${from}${sep}`),
      );
      if (moving.length === 0 || entries.has(to)) throw missing();
      for (const [path] of moving) entries.delete(path);
      for (const [path, entry] of moving) entries.set(`${to}${path.slice(from.length)}`, entry);
    },
    rmdir: async (path) => {
      if ([...entries.keys()].some((candidate) => candidate.startsWith(`${path}${sep}`))) {
        throw new Error('not empty');
      }
      if (!entries.delete(path)) throw missing();
    },
    unlink: async (path) => {
      if (!entries.delete(path)) throw missing();
    },
  };
  return { entries, fileSystem };
}

describe('KemerBet Chromium Service Worker purge', () => {
  it('atomically tombstones and removes only Default/Service Worker', async () => {
    const profile = resolve('C:/profile');
    const test = memoryFileSystem(profile, {
      Default: { kind: 'directory' },
      'Default/Local Storage': { kind: 'directory' },
      'Default/Service Worker': { kind: 'directory' },
      'Default/Service Worker/Database': { kind: 'directory' },
      'Default/Service Worker/Database/state': { kind: 'file' },
    });

    await purgeKemerBetPersistedServiceWorkerState(profile, 10001, test.fileSystem);

    expect(test.entries.has(resolve(profile, 'Default/Local Storage'))).toBe(true);
    expect([...test.entries.keys()].some((path) => path.includes(`${sep}Service Worker`))).toBe(
      false,
    );
    expect(
      [...test.entries.keys()].some((path) => path.includes('.Service Worker.fetanagent-purge-v1')),
    ).toBe(false);
  });

  it('resumes removal from the exact fixed tombstone after a crash', async () => {
    const profile = resolve('C:/profile');
    const test = memoryFileSystem(profile, {
      Default: { kind: 'directory' },
      'Default/.Service Worker.fetanagent-purge-v1': { kind: 'directory' },
      'Default/.Service Worker.fetanagent-purge-v1/state': { kind: 'file' },
    });

    await purgeKemerBetPersistedServiceWorkerState(profile, 10001, test.fileSystem);

    expect(test.entries.size).toBe(1);
    expect(test.entries.has(resolve(profile, 'Default'))).toBe(true);
  });

  it('rejects ambiguous live+tombstone state and hard-linked contents', async () => {
    const profile = resolve('C:/profile');
    const ambiguous = memoryFileSystem(profile, {
      Default: { kind: 'directory' },
      'Default/Service Worker': { kind: 'directory' },
      'Default/.Service Worker.fetanagent-purge-v1': { kind: 'directory' },
    });
    await expect(
      purgeKemerBetPersistedServiceWorkerState(profile, 10001, ambiguous.fileSystem),
    ).rejects.toBeInstanceOf(KemerBetChromiumProfileUnavailableError);

    const hardLink = memoryFileSystem(profile, {
      Default: { kind: 'directory' },
      'Default/Service Worker': { kind: 'directory' },
      'Default/Service Worker/state': { kind: 'file', nlink: 2 },
    });
    await expect(
      purgeKemerBetPersistedServiceWorkerState(profile, 10001, hardLink.fileSystem),
    ).rejects.toBeInstanceOf(KemerBetChromiumProfileUnavailableError);
  });
});
