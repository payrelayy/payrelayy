import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  KEMERBET_AGENT_PROFILES_ROOT,
  KEMERBET_BROWSER_EXECUTABLE_PATH,
} from '@fetanagent/config/executor';
import { chromium, type BrowserContext } from 'playwright-core';

import { assertKemerBetBrowserExecutable } from './executor-runtime-isolation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FIXED_XAUTHORITY_PATH = '/run/secrets/kemerbet_session_xauthority';
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

interface ProvisionDirectoryStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly uid: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetSessionProvisionFileSystem {
  lstat(path: string): Promise<ProvisionDirectoryStat>;
  mkdir(path: string, options: { readonly mode: number }): Promise<unknown>;
  realpath(path: string): Promise<string>;
}

export interface KemerBetSessionProvisionContext {
  close(): Promise<void>;
  once(event: 'close', listener: () => void): unknown;
}

export interface KemerBetSessionProvisionLauncher {
  launchPersistentContext(
    userDataDirectory: string,
    options: {
      readonly acceptDownloads: false;
      readonly bypassCSP: false;
      readonly chromiumSandbox: true;
      readonly executablePath: typeof KEMERBET_BROWSER_EXECUTABLE_PATH;
      readonly headless: false;
      readonly ignoreHTTPSErrors: false;
      readonly serviceWorkers: 'block';
    },
  ): Promise<BrowserContext | KemerBetSessionProvisionContext>;
}

export interface KemerBetSessionProvisionSignalSource {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

export interface KemerBetSessionProvisionDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly fileSystem?: KemerBetSessionProvisionFileSystem;
  readonly launcher?: KemerBetSessionProvisionLauncher;
  readonly signalSource?: KemerBetSessionProvisionSignalSource;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
  readonly assertBrowserExecutable?: () => Promise<void>;
  readonly log?: (event: 'started' | 'stopped') => void;
}

interface DirectoryMetadata {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly uid: number;
}

const nodeFileSystem: KemerBetSessionProvisionFileSystem = { lstat, mkdir, realpath };
const nodeSignalSource: KemerBetSessionProvisionSignalSource = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener),
};

export class KemerBetSessionProvisionUnavailableError extends Error {
  constructor() {
    super('The KemerBet agent session provision boundary is unavailable.');
    this.name = 'KemerBetSessionProvisionUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetSessionProvisionUnavailableError();
}

function validAccountId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    UUID_PATTERN.test(value) &&
    value !== '00000000-0000-0000-0000-000000000000'
  );
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

function metadata(stat: ProvisionDirectoryStat): DirectoryMetadata {
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode, uid: stat.uid };
}

function sameMetadata(left: DirectoryMetadata, right: DirectoryMetadata): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid
  );
}

function safeRoot(stat: ProvisionDirectoryStat, effectiveUserId: number): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    (stat.uid === 0 || stat.uid === effectiveUserId) &&
    (stat.mode & 0o022) === 0
  );
}

function safeProfile(stat: ProvisionDirectoryStat, effectiveUserId: number): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === effectiveUserId &&
    (stat.mode & 0o777) === 0o700
  );
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === expectedCode
  );
}

function assertProvisionEnvironment(environment: NodeJS.ProcessEnv): string {
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE === 'live' ||
    environment.KEMERBET_EXECUTOR_ENABLED === 'true' ||
    environment.KEMERBET_FINAL_ACTION_ENABLED === 'true' ||
    environment.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED === 'true' ||
    !validAccountId(environment.KEMERBET_SESSION_PROVISION_ACCOUNT_ID) ||
    typeof environment.DISPLAY !== 'string' ||
    environment.DISPLAY.length < 1 ||
    environment.DISPLAY.length > 256 ||
    environment.DISPLAY !== environment.DISPLAY.trim() ||
    /[\r\n\0]/u.test(environment.DISPLAY) ||
    environment.XAUTHORITY !== FIXED_XAUTHORITY_PATH
  ) {
    return unavailable();
  }
  return environment.KEMERBET_SESSION_PROVISION_ACCOUNT_ID;
}

async function assertStableRoot(
  fileSystem: KemerBetSessionProvisionFileSystem,
  platform: NodeJS.Platform,
  effectiveUserId: number,
): Promise<void> {
  const before = await fileSystem.lstat(KEMERBET_AGENT_PROFILES_ROOT);
  if (
    !safeRoot(before, effectiveUserId) ||
    !samePath(
      await fileSystem.realpath(KEMERBET_AGENT_PROFILES_ROOT),
      KEMERBET_AGENT_PROFILES_ROOT,
      platform,
    )
  ) {
    return unavailable();
  }
  const after = await fileSystem.lstat(KEMERBET_AGENT_PROFILES_ROOT);
  if (!safeRoot(after, effectiveUserId) || !sameMetadata(metadata(before), metadata(after))) {
    return unavailable();
  }
}

async function prepareProfile(
  accountId: string,
  fileSystem: KemerBetSessionProvisionFileSystem,
  platform: NodeJS.Platform,
  effectiveUserId: number,
): Promise<string> {
  if (!isAbsolute(KEMERBET_AGENT_PROFILES_ROOT)) return unavailable();
  await assertStableRoot(fileSystem, platform, effectiveUserId);
  const profilePath = resolve(KEMERBET_AGENT_PROFILES_ROOT, accountId);
  if (
    relative(KEMERBET_AGENT_PROFILES_ROOT, profilePath) !== accountId ||
    !samePath(resolve(profilePath, '..'), KEMERBET_AGENT_PROFILES_ROOT, platform)
  ) {
    return unavailable();
  }
  try {
    await fileSystem.mkdir(profilePath, { mode: 0o700 });
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) return unavailable();
  }
  const before = await fileSystem.lstat(profilePath);
  if (
    !safeProfile(before, effectiveUserId) ||
    !samePath(await fileSystem.realpath(profilePath), profilePath, platform)
  ) {
    return unavailable();
  }
  const after = await fileSystem.lstat(profilePath);
  if (!safeProfile(after, effectiveUserId) || !sameMetadata(metadata(before), metadata(after))) {
    return unavailable();
  }
  await assertStableRoot(fileSystem, platform, effectiveUserId);
  return profilePath;
}

function defaultLog(event: 'started' | 'stopped'): void {
  console.info(
    {
      component: 'kemerbet_session_provision',
      event,
      accountDetailsRedacted: true,
      financialActionAvailable: false,
    },
    event === 'started'
      ? 'The isolated KemerBet agent session browser is open.'
      : 'The isolated KemerBet agent session browser is closed.',
  );
}

/**
 * Open one manual, headed browser profile. This command never loads a database URL, selector,
 * identity binding, HMAC key, final-action gate, or browser page automation.
 */
export async function provisionKemerBetAgentSession(
  dependencies: KemerBetSessionProvisionDependencies = {},
): Promise<void> {
  const environment = dependencies.environment ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  if (platform === 'win32') return unavailable();
  const effectiveUserId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (!Number.isSafeInteger(effectiveUserId) || effectiveUserId <= 0) return unavailable();
  const accountId = assertProvisionEnvironment(environment);
  const fileSystem = dependencies.fileSystem ?? nodeFileSystem;
  const signalSource = dependencies.signalSource ?? nodeSignalSource;
  const launcher = dependencies.launcher ?? (chromium as KemerBetSessionProvisionLauncher);
  const log = dependencies.log ?? defaultLog;
  let shutdownRequested = false;
  let resolveShutdown!: () => void;
  const shutdown = new Promise<void>((resolvePromise) => {
    resolveShutdown = resolvePromise;
  });
  const onShutdown = () => {
    shutdownRequested = true;
    resolveShutdown();
  };
  for (const signal of SHUTDOWN_SIGNALS) signalSource.on(signal, onShutdown);

  let context: KemerBetSessionProvisionContext | null = null;
  try {
    await (
      dependencies.assertBrowserExecutable ??
      (() => assertKemerBetBrowserExecutable({ executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH }))
    )();
    const profilePath = await prepareProfile(accountId, fileSystem, platform, effectiveUserId);
    if (shutdownRequested) return;
    context = (await launcher.launchPersistentContext(profilePath, {
      executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH,
      headless: false,
      chromiumSandbox: true,
      acceptDownloads: false,
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      serviceWorkers: 'block',
    })) as KemerBetSessionProvisionContext;
    log('started');
    if (!shutdownRequested) {
      const closed = new Promise<void>((resolvePromise) => context?.once('close', resolvePromise));
      await Promise.race([closed, shutdown]);
    }
  } catch {
    return unavailable();
  } finally {
    for (const signal of SHUTDOWN_SIGNALS) signalSource.off(signal, onShutdown);
    if (context !== null) {
      try {
        await context.close();
      } catch {
        // The caller receives only the generic provision-boundary failure above.
      }
      log('stopped');
    }
  }
}

export interface KemerBetSessionProvisionMainDependencies extends KemerBetSessionProvisionDependencies {
  readonly reportFailure?: () => void;
  readonly setExitCode?: (exitCode: number) => void;
}

export async function runKemerBetSessionProvisionMain(
  dependencies: KemerBetSessionProvisionMainDependencies = {},
): Promise<void> {
  try {
    await provisionKemerBetAgentSession(dependencies);
  } catch {
    (
      dependencies.reportFailure ??
      (() => console.error('FetanAgent agent-session provisioning failed closed.'))
    )();
    (dependencies.setExitCode ?? ((exitCode) => (process.exitCode = exitCode)))(1);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runKemerBetSessionProvisionMain();
}
