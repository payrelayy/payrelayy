import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  KEMERBET_AGENT_PROFILES_ROOT,
  KEMERBET_BROWSER_EXECUTABLE_PATH,
} from '@fetanagent/config/executor';
import { describe, expect, it, vi } from 'vitest';

import {
  KemerBetSessionProvisionUnavailableError,
  provisionKemerBetAgentSession,
  runKemerBetSessionProvisionMain,
  type KemerBetSessionProvisionContext,
  type KemerBetSessionProvisionFileSystem,
  type KemerBetSessionProvisionLauncher,
  type KemerBetSessionProvisionSignalSource,
} from './kemerbet-session-provision.js';

const ACCOUNT_ID = '99999999-9999-4999-8999-999999999991';
const PROFILE_PATH = resolve(KEMERBET_AGENT_PROFILES_ROOT, ACCOUNT_ID);

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DISPLAY: ':9',
    XAUTHORITY: '/run/secrets/kemerbet_session_xauthority',
    KEMERBET_SESSION_PROVISION_ACCOUNT_ID: ACCOUNT_ID,
    ...overrides,
  };
}

function stat(options: {
  readonly device: number;
  readonly inode: number;
  readonly mode: number;
  readonly uid: number;
  readonly symbolicLink?: boolean;
}) {
  return {
    dev: options.device,
    ino: options.inode,
    mode: options.mode,
    uid: options.uid,
    isDirectory: () => true,
    isSymbolicLink: () => options.symbolicLink === true,
  };
}

function missing(): NodeJS.ErrnoException {
  return Object.assign(new Error('missing-sensitive-path'), { code: 'ENOENT' });
}

function fileSystem(
  options: {
    readonly profileExists?: boolean;
    readonly rootMode?: number;
    readonly rootUid?: number;
    readonly profileMode?: number;
    readonly profileUid?: number;
    readonly profileSymbolicLink?: boolean;
    readonly profileRealpath?: string;
    readonly driftProfileInode?: boolean;
  } = {},
): KemerBetSessionProvisionFileSystem & { readonly created: string[] } {
  let profileExists = options.profileExists === true;
  let profileReads = 0;
  const created: string[] = [];
  return {
    created,
    async lstat(path) {
      if (path === KEMERBET_AGENT_PROFILES_ROOT) {
        return stat({
          device: 1,
          inode: 10,
          mode: options.rootMode ?? 0o700,
          uid: options.rootUid ?? 10_001,
        });
      }
      if (path !== PROFILE_PATH || !profileExists) throw missing();
      profileReads += 1;
      return stat({
        device: 1,
        inode: options.driftProfileInode === true && profileReads > 1 ? 21 : 20,
        mode: options.profileMode ?? 0o700,
        uid: options.profileUid ?? 10_001,
        ...(options.profileSymbolicLink === undefined
          ? {}
          : { symbolicLink: options.profileSymbolicLink }),
      });
    },
    async mkdir(path, mkdirOptions) {
      expect(path).toBe(PROFILE_PATH);
      expect(mkdirOptions).toEqual({ mode: 0o700 });
      if (profileExists) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      profileExists = true;
      created.push(path);
    },
    async realpath(path) {
      if (path === PROFILE_PATH) return options.profileRealpath ?? path;
      return path;
    },
  };
}

function signalSource(): KemerBetSessionProvisionSignalSource & {
  readonly listeners: Map<string, Set<() => void>>;
} {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    on(signal, listener) {
      const entries = listeners.get(signal) ?? new Set<() => void>();
      entries.add(listener);
      listeners.set(signal, entries);
    },
    off(signal, listener) {
      listeners.get(signal)?.delete(listener);
    },
  };
}

function launcher(): KemerBetSessionProvisionLauncher & {
  readonly calls: Array<{ readonly directory: string; readonly options: unknown }>;
  readonly context: KemerBetSessionProvisionContext & { readonly closeCalls: number };
} {
  const calls: Array<{ directory: string; options: unknown }> = [];
  let closeCalls = 0;
  const context = {
    get closeCalls() {
      return closeCalls;
    },
    async close() {
      closeCalls += 1;
    },
    once(_event: 'close', listener: () => void) {
      queueMicrotask(listener);
    },
  };
  return {
    calls,
    context,
    async launchPersistentContext(directory, options) {
      calls.push({ directory, options });
      return context;
    },
  };
}

describe('manual KemerBet agent session provisioning', () => {
  it('creates only the exact account profile and opens one headed sandboxed browser', async () => {
    const fs = fileSystem();
    const browser = launcher();
    const signals = signalSource();
    const assertBrowserExecutable = vi.fn(async () => undefined);
    const log = vi.fn();

    await provisionKemerBetAgentSession({
      environment: environment(),
      fileSystem: fs,
      launcher: browser,
      signalSource: signals,
      platform: 'linux',
      effectiveUserId: 10_001,
      assertBrowserExecutable,
      log,
    });

    expect(fs.created).toEqual([PROFILE_PATH]);
    expect(assertBrowserExecutable).toHaveBeenCalledOnce();
    expect(browser.calls).toEqual([
      {
        directory: PROFILE_PATH,
        options: {
          executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH,
          headless: false,
          chromiumSandbox: true,
          acceptDownloads: false,
          bypassCSP: false,
          ignoreHTTPSErrors: false,
          serviceWorkers: 'block',
        },
      },
    ]);
    expect(browser.context.closeCalls).toBe(1);
    expect(log.mock.calls.map(([event]) => event)).toEqual(['started', 'stopped']);
    expect([...signals.listeners.values()].every((entries) => entries.size === 0)).toBe(true);
  });

  it('reuses an existing exact 0700 profile without creating or automating a page', async () => {
    const fs = fileSystem({ profileExists: true });
    const browser = launcher();
    await provisionKemerBetAgentSession({
      environment: environment(),
      fileSystem: fs,
      launcher: browser,
      signalSource: signalSource(),
      platform: 'linux',
      effectiveUserId: 10_001,
      assertBrowserExecutable: async () => undefined,
      log: () => undefined,
    });
    expect(fs.created).toEqual([]);
    expect(browser.calls).toHaveLength(1);
  });

  it.each([
    ['non-production', { NODE_ENV: 'test' }],
    ['live mode', { FINANCIAL_ACTIONS_MODE: 'live' }],
    ['executor gate', { KEMERBET_EXECUTOR_ENABLED: 'true' }],
    ['final-action gate', { KEMERBET_FINAL_ACTION_ENABLED: 'true' }],
    ['runtime gate', { INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true' }],
    ['invalid account', { KEMERBET_SESSION_PROVISION_ACCOUNT_ID: '../escape' }],
    [
      'zero account',
      { KEMERBET_SESSION_PROVISION_ACCOUNT_ID: '00000000-0000-0000-0000-000000000000' },
    ],
    ['missing display', { DISPLAY: '' }],
    ['wrong Xauthority', { XAUTHORITY: '/tmp/unsafe' }],
  ])('rejects %s before filesystem or browser access', async (_name, override) => {
    const browser = launcher();
    const assertBrowserExecutable = vi.fn(async () => undefined);
    await expect(
      provisionKemerBetAgentSession({
        environment: environment(override),
        fileSystem: fileSystem(),
        launcher: browser,
        signalSource: signalSource(),
        platform: 'linux',
        effectiveUserId: 10_001,
        assertBrowserExecutable,
      }),
    ).rejects.toBeInstanceOf(KemerBetSessionProvisionUnavailableError);
    expect(assertBrowserExecutable).not.toHaveBeenCalled();
    expect(browser.calls).toHaveLength(0);
  });

  it.each([
    ['root execution', { effectiveUserId: 0 }],
    ['unsafe root mode', { effectiveUserId: 10_001, rootMode: 0o770 }],
    ['foreign profile owner', { effectiveUserId: 10_001, profileUid: 2_000 }],
    ['non-0700 profile', { effectiveUserId: 10_001, profileMode: 0o750 }],
    ['profile symlink', { effectiveUserId: 10_001, profileSymbolicLink: true }],
    [
      'profile realpath escape',
      { effectiveUserId: 10_001, profileRealpath: '/tmp/escaped-profile' },
    ],
    ['profile metadata drift', { effectiveUserId: 10_001, driftProfileInode: true }],
  ] as const)('fails closed for %s without launching Chromium', async (_name, fixture) => {
    const browser = launcher();
    await expect(
      provisionKemerBetAgentSession({
        environment: environment(),
        fileSystem: fileSystem({ profileExists: true, ...fixture }),
        launcher: browser,
        signalSource: signalSource(),
        platform: 'linux',
        effectiveUserId: fixture.effectiveUserId,
        assertBrowserExecutable: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(KemerBetSessionProvisionUnavailableError);
    expect(browser.calls).toHaveLength(0);
  });

  it('reports only a generic failure and a nonzero exit status', async () => {
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();
    await runKemerBetSessionProvisionMain({
      environment: environment({ DISPLAY: 'sensitive-invalid\nvalue' }),
      reportFailure,
      setExitCode,
    });
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(reportFailure.mock.calls.flat().join(' ')).not.toContain('sensitive-invalid');
    expect(setExitCode).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('contains no database/financial-runtime configuration loader or page automation command', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision.ts', import.meta.url),
      'utf8',
    );
    for (const forbidden of [
      'loadExecutorConfig',
      'KEMERBET_EXECUTOR_DATABASE_URL_FILE',
      'KEMERBET_AGENT_IDENTITY_BINDINGS_FILE',
      'KEMERBET_SELECTOR_CONTRACT_FILE',
      'KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE',
      'KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE',
      '.goto(',
      '.click(',
      '.fill(',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
