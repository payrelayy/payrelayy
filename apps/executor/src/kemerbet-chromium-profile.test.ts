import { constants } from 'node:fs';
import { resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertKemerBetChromiumProfileCleanlyClosed,
  type KemerBetCleanExitFileSystem,
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

interface CleanExitMemoryFileSystemOptions {
  readonly closeError?: Error;
  readonly defaultGid?: number;
  readonly defaultMode?: number;
  readonly openError?: Error;
  readonly preferences?: string;
  readonly preferencesKind?: 'directory' | 'file' | 'symlink';
  readonly preferencesGid?: number;
  readonly preferencesLstatDriftAtCall?: number;
  readonly preferencesMode?: number;
  readonly preferencesNlink?: number;
  readonly preferencesRealpathMismatch?: boolean;
  readonly preferencesUid?: number;
  readonly profileGid?: number;
  readonly profileMode?: number;
  readonly singleton?: boolean;
}

function cleanExitMemoryFileSystem(
  profile: string,
  options: CleanExitMemoryFileSystemOptions = {},
) {
  const defaultRoot = resolve(profile, 'Default');
  const preferencesPath = resolve(defaultRoot, 'Preferences');
  const preferences = Buffer.from(
    options.preferences ?? JSON.stringify({ profile: { exit_type: 'Normal' } }),
    'utf8',
  );
  const lstatCalls = new Map<string, number>();
  const openedBuffers: Buffer[] = [];
  const openFlags: number[] = [];
  const openPaths: string[] = [];
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const stat = (
    kind: 'directory' | 'file' | 'symlink',
    overrides: {
      readonly dev?: number | undefined;
      readonly gid?: number | undefined;
      readonly mode?: number | undefined;
      readonly nlink?: number | undefined;
      readonly size?: number | undefined;
      readonly uid?: number | undefined;
    } = {},
  ) => ({
    ctimeMs: 1,
    dev: overrides.dev ?? 1,
    gid: overrides.gid ?? 10_001,
    ino: kind === 'directory' ? 10 : 20,
    mode:
      overrides.mode ?? (kind === 'directory' ? 0o40_700 : kind === 'file' ? 0o100_600 : 0o120_777),
    mtimeMs: 1,
    nlink: overrides.nlink ?? 1,
    size: overrides.size ?? (kind === 'file' ? preferences.byteLength : 0),
    uid: overrides.uid ?? 10_001,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'symlink',
  });
  const statForPath = (path: string, call: number) => {
    if (path === profile) {
      return stat('directory', { gid: options.profileGid, mode: options.profileMode });
    }
    if (path === defaultRoot) {
      return stat('directory', { gid: options.defaultGid, mode: options.defaultMode });
    }
    if (path === preferencesPath) {
      return stat(options.preferencesKind ?? 'file', {
        dev: options.preferencesLstatDriftAtCall === call ? 2 : 1,
        gid: options.preferencesGid,
        mode: options.preferencesMode,
        nlink: options.preferencesNlink,
        uid: options.preferencesUid,
      });
    }
    if (
      options.singleton === true &&
      ['SingletonCookie', 'SingletonLock', 'SingletonSocket'].some(
        (name) => path === resolve(profile, name),
      )
    ) {
      return stat('symlink');
    }
    throw missing();
  };
  const fileSystem: KemerBetCleanExitFileSystem = {
    lstat: async (path) => {
      const call = lstatCalls.get(path) ?? 0;
      lstatCalls.set(path, call + 1);
      return statForPath(path, call);
    },
    open: async (path, flags) => {
      openPaths.push(path);
      openFlags.push(flags);
      if (options.openError !== undefined) throw options.openError;
      return {
        close: async () => {
          if (options.closeError !== undefined) throw options.closeError;
        },
        readFile: async () => {
          const opened = Buffer.from(preferences);
          openedBuffers.push(opened);
          return opened;
        },
        stat: async () => statForPath(preferencesPath, 0),
      };
    },
    realpath: async (path) =>
      options.preferencesRealpathMismatch === true && path === preferencesPath
        ? `${preferencesPath}-other`
        : path,
  };
  return { fileSystem, openedBuffers, openFlags, openPaths, preferencesPath };
}

async function expectCleanExitUnavailable(
  action: Promise<void>,
  redactedValues: readonly string[] = [],
): Promise<void> {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KemerBetChromiumProfileUnavailableError);
  expect((caught as Error).message).toBe(
    'The private KemerBet Chromium profile boundary is unavailable.',
  );
  for (const value of redactedValues) {
    expect(String(caught)).not.toContain(value);
  }
}

describe('KemerBet Chromium clean-exit attestation', () => {
  it.each([
    ['an absent exited_cleanly marker', { profile: { exit_type: 'Normal' } }],
    [
      'an explicit true exited_cleanly marker',
      { profile: { exit_type: 'Normal', exited_cleanly: true } },
    ],
  ])('accepts a read-only Normal exit with %s', async (_label, document) => {
    const profile = resolve('C:/clean-profile');
    const test = cleanExitMemoryFileSystem(profile, {
      preferences: JSON.stringify(document),
    });

    await assertKemerBetChromiumProfileCleanlyClosed(profile, 10_001, test.fileSystem);

    expect(test.openPaths).toEqual([test.preferencesPath]);
    expect(test.openFlags).toEqual([constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)]);
    expect(test.openedBuffers).toHaveLength(1);
    expect([...test.openedBuffers[0]!]).toEqual(
      Array.from({ length: test.openedBuffers[0]!.byteLength }, () => 0),
    );
  });

  it.each([
    ['a crashed profile', { preferences: JSON.stringify({ profile: { exit_type: 'Crashed' } }) }],
    [
      'an explicitly unclean profile',
      {
        preferences: JSON.stringify({
          profile: { exit_type: 'Normal', exited_cleanly: false },
        }),
      },
    ],
    ['a missing profile record', { preferences: JSON.stringify({ opaque: true }) }],
    ['malformed Preferences JSON', { preferences: '{"profile":broken-json' }],
    ['a surviving Chromium singleton', { singleton: true }],
    ['a group-readable profile directory', { profileMode: 0o40_750 }],
    ['a sticky profile directory', { profileMode: 0o41_700 }],
    ['a profile group-ownership mismatch', { profileGid: 10_002 }],
    ['a group-readable Default directory', { defaultMode: 0o40_750 }],
    ['a Default group-ownership mismatch', { defaultGid: 10_002 }],
    ['a Preferences symlink', { preferencesKind: 'symlink' as const }],
    ['a Preferences ownership mismatch', { preferencesUid: 10_002 }],
    ['a Preferences group-ownership mismatch', { preferencesGid: 10_002 }],
    ['a hard-linked Preferences file', { preferencesNlink: 2 }],
    ['a group-readable Preferences file', { preferencesMode: 0o100_640 }],
    ['a set-group-ID Preferences file', { preferencesMode: 0o102_600 }],
    ['a Preferences realpath mismatch', { preferencesRealpathMismatch: true }],
    ['Preferences metadata drift while reading', { preferencesLstatDriftAtCall: 1 }],
    ['Preferences metadata drift after handle close', { preferencesLstatDriftAtCall: 2 }],
  ])('rejects %s', async (_label, options) => {
    const profile = resolve('C:/unclean-profile');
    const test = cleanExitMemoryFileSystem(profile, options);

    await expectCleanExitUnavailable(
      assertKemerBetChromiumProfileCleanlyClosed(profile, 10_001, test.fileSystem),
    );
  });

  it('redacts Preferences contents and underlying filesystem errors', async () => {
    const profile = resolve('C:/redacted-profile');
    const profileSecret = 'never-leak-profile-secret';
    const crashed = cleanExitMemoryFileSystem(profile, {
      preferences: JSON.stringify({
        profile: { exit_type: 'Crashed', opaque_session: profileSecret },
      }),
    });
    await expectCleanExitUnavailable(
      assertKemerBetChromiumProfileCleanlyClosed(profile, 10_001, crashed.fileSystem),
      [profileSecret],
    );

    const filesystemSecret = 'never-leak-filesystem-secret';
    const unreadable = cleanExitMemoryFileSystem(profile, {
      openError: new Error(filesystemSecret),
    });
    await expectCleanExitUnavailable(
      assertKemerBetChromiumProfileCleanlyClosed(profile, 10_001, unreadable.fileSystem),
      [filesystemSecret],
    );

    const closeSecret = 'never-leak-close-error-secret';
    const uncloseable = cleanExitMemoryFileSystem(profile, {
      closeError: new Error(closeSecret),
    });
    await expectCleanExitUnavailable(
      assertKemerBetChromiumProfileCleanlyClosed(profile, 10_001, uncloseable.fileSystem),
      [closeSecret],
    );
    expect(uncloseable.openedBuffers).toHaveLength(1);
    expect(uncloseable.openedBuffers[0]!.every((byte) => byte === 0)).toBe(true);
  });
});
