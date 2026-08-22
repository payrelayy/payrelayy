import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

import {
  createKemerBetDepositBrowser,
  type KemerBetDepositBrowser,
} from './kemerbet-deposit-browser-adapter.js';
import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import type { KemerBetHistoryReferenceFingerprinter } from './kemerbet-history-reference-fingerprint.js';
import {
  createPlaywrightKemerBetAgentPage,
  KEMERBET_AGENT_DEPOSIT_URL,
  KEMERBET_AGENT_HISTORY_URL,
  type KemerBetAgentPageSelectorContractV2,
  type PlaywrightKemerBetAgentPage,
  type PlaywrightPagePort,
} from './playwright-kemerbet-agent-page.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTITY_FINGERPRINT_PATTERN = /^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u;
const MAXIMUM_AGENT_ACCOUNTS = 64;

interface RegistryFileStat {
  readonly size: number;
  readonly mode: number;
  readonly uid: number;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetAgentSessionRegistryFileSystem {
  lstat(path: string): Promise<RegistryFileStat>;
  realpath(path: string): Promise<string>;
}

export interface KemerBetPersistentContextPort {
  pages(): readonly (Page | PlaywrightPagePort)[];
  newPage(): Promise<Page | PlaywrightPagePort>;
  close(): Promise<void>;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'page', listener: (page: Page | PlaywrightPagePort) => void): unknown;
}

export interface KemerBetPersistentContextLauncher {
  launchPersistentContext(
    userDataDirectory: string,
    options: KemerBetPersistentContextLaunchOptions,
  ): Promise<BrowserContext | KemerBetPersistentContextPort>;
}

export interface KemerBetPersistentContextLaunchOptions {
  readonly executablePath: string;
  readonly headless: boolean;
  readonly chromiumSandbox: true;
  readonly acceptDownloads: false;
  readonly bypassCSP: false;
  readonly ignoreHTTPSErrors: false;
  readonly serviceWorkers: 'block';
}

export type KemerBetAgentSessionReadiness =
  | { readonly ready: true; readonly reason: 'ready' }
  | {
      readonly ready: false;
      readonly reason:
        | 'invalid_account_id'
        | 'profile_missing'
        | 'unsafe_profile'
        | 'authenticated_session_unavailable'
        | 'registry_closed';
    };

export interface KemerBetAgentSessionRegistry {
  probeReadiness(platformAgentAccountId: string): Promise<KemerBetAgentSessionReadiness>;
  probePlayerLookup(
    platformAgentAccountId: string,
    target: { readonly playerId: string; readonly currencyCode: 'ETB' },
  ): Promise<{
    readonly exactPlayerMatch: true;
    readonly exactCurrencyMatch: true;
    readonly transferDisabled: true;
  } | null>;
  resolveBrowser(platformAgentAccountId: string): Promise<KemerBetDepositBrowser | null>;
  close(): Promise<void>;
}

export interface KemerBetAgentSessionRegistryOptions {
  readonly profilesRoot: string;
  readonly browserExecutablePath: string;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
  readonly expectedAgentIdentityBindings: ReadonlyMap<string, string>;
  readonly fingerprintExternalReference: KemerBetHistoryReferenceFingerprinter;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly now: () => Date;
  readonly launcher?: KemerBetPersistentContextLauncher;
  readonly fileSystem?: KemerBetAgentSessionRegistryFileSystem;
  readonly headless?: boolean;
  readonly pageTimeoutMs?: number;
  readonly maxHistoryPages?: number;
  readonly maxHistoryRows?: number;
  readonly agentTimeZone?: string;
  readonly platform?: NodeJS.Platform;
  readonly effectiveUserId?: number;
}

interface ActiveSession {
  readonly context: KemerBetPersistentContextPort;
  readonly bindingFingerprint: string;
  readonly profileMetadata: ReadyProfileMetadata;
  readonly agentPage: PlaywrightKemerBetAgentPage;
  readonly lane: SerialLane;
  readonly browser: KemerBetDepositBrowser;
}

interface ReadyProfile {
  readonly userDataDirectory: string;
  readonly bindingFingerprint: string;
  readonly profileMetadata: ReadyProfileMetadata;
}

interface ReadyProfileMetadata {
  readonly root: RegistryFileMetadata;
  readonly profile: RegistryFileMetadata;
}

interface RegistryFileMetadata {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly uid: number;
}

type UnreadyReason = Exclude<KemerBetAgentSessionReadiness['reason'], 'ready'>;

class SerialLane {
  #tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const predecessor = this.#tail;
    this.#tail = new Promise<void>((resolveTail) => {
      release = resolveTail;
    });
    return predecessor.then(operation).finally(release);
  }
}

function serializedBrowser(
  browser: KemerBetDepositBrowser,
  lane: SerialLane,
  assertCurrentProfile: () => Promise<void>,
  closeOnFailure: () => Promise<void>,
): KemerBetDepositBrowser {
  async function run<T>(operation: () => Promise<T>): Promise<T> {
    return lane.run(async () => {
      try {
        await assertCurrentProfile();
        return await operation();
      } catch (error) {
        await closeOnFailure();
        throw error;
      }
    });
  }
  return {
    platformAgentAccountId: browser.platformAgentAccountId,
    probePlayerLookup: (target) => run(async () => browser.probePlayerLookup(target)),
    prepare: (lease) => run(async () => browser.prepare(lease)),
    submitOnceAfterFence: (lease, fence) =>
      run(async () => browser.submitOnceAfterFence(lease, fence)),
    reconcile: (lease) => run(async () => browser.reconcile(lease)),
  };
}

const nodeFileSystem: KemerBetAgentSessionRegistryFileSystem = {
  lstat,
  realpath,
};

function validPlatformAgentAccountId(value: string): boolean {
  return UUID_PATTERN.test(value) && value !== '00000000-0000-0000-0000-000000000000';
}

function safeAbsolutePath(value: string): string {
  if (!isAbsolute(value) || /\0/u.test(value)) throw new Error('Unsafe executor configuration.');
  return resolve(value);
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

function metadata(stat: RegistryFileStat): RegistryFileMetadata {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    uid: stat.uid,
  };
}

function sameMetadata(left: RegistryFileMetadata, right: RegistryFileMetadata): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid
  );
}

function sameReadyProfile(left: ReadyProfileMetadata, right: ReadyProfileMetadata): boolean {
  return sameMetadata(left.root, right.root) && sameMetadata(left.profile, right.profile);
}

function expectedIdentityBindings(
  source: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const fingerprints = new Set<string>();
  try {
    for (const [accountId, fingerprint] of source.entries()) {
      if (
        !validPlatformAgentAccountId(accountId) ||
        !IDENTITY_FINGERPRINT_PATTERN.test(fingerprint) ||
        result.has(accountId) ||
        fingerprints.has(fingerprint)
      ) {
        throw new Error('Unsafe executor configuration.');
      }
      result.set(accountId, fingerprint);
      fingerprints.add(fingerprint);
    }
  } catch {
    throw new Error('Unsafe executor configuration.');
  }
  if (result.size < 1 || result.size > MAXIMUM_AGENT_ACCOUNTS) {
    throw new Error('Unsafe executor configuration.');
  }
  return result;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function asContextPort(context: BrowserContext | KemerBetPersistentContextPort) {
  return context as KemerBetPersistentContextPort;
}

function pageUrl(page: Page | PlaywrightPagePort): string {
  return (page as PlaywrightPagePort).url();
}

function isSafeInitialPageUrl(value: string): boolean {
  return (
    value === 'about:blank' ||
    value === KEMERBET_AGENT_DEPOSIT_URL ||
    value === KEMERBET_AGENT_HISTORY_URL
  );
}

function closePageSilently(page: Page | PlaywrightPagePort): void {
  const candidate = page as Page & { close?: () => Promise<void> };
  if (typeof candidate.close === 'function') void candidate.close().catch(() => undefined);
}

function launchOptions(
  options: KemerBetAgentSessionRegistryOptions,
): KemerBetPersistentContextLaunchOptions {
  return {
    executablePath: safeAbsolutePath(options.browserExecutablePath),
    headless: options.headless ?? true,
    chromiumSandbox: true,
    acceptDownloads: false,
    bypassCSP: false,
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
  };
}

/**
 * Resolve only pre-provisioned, UUID-bound agent profiles. This registry never creates a profile,
 * opens a customer KemerBet session, obtains credentials, or exposes a raw Playwright page.
 */
export function createKemerBetAgentSessionRegistry(
  options: KemerBetAgentSessionRegistryOptions,
): KemerBetAgentSessionRegistry {
  const profilesRoot = safeAbsolutePath(options.profilesRoot);
  const platform = options.platform ?? process.platform;
  const effectiveUserId =
    platform === 'win32'
      ? null
      : (options.effectiveUserId ??
        (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN));
  if (
    platform !== 'win32' &&
    (!Number.isSafeInteger(effectiveUserId) || effectiveUserId === null || effectiveUserId < 0)
  ) {
    throw new Error('Unsafe executor configuration.');
  }
  const identityBindings = expectedIdentityBindings(options.expectedAgentIdentityBindings);
  const browserOptions = launchOptions(options);
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const launcher = options.launcher ?? (chromium as unknown as KemerBetPersistentContextLauncher);
  const active = new Map<string, ActiveSession>();
  const launching = new Map<string, Promise<ActiveSession | null>>();
  let closed = false;

  function profilePath(platformAgentAccountId: string): string | null {
    if (!validPlatformAgentAccountId(platformAgentAccountId)) return null;
    const candidate = resolve(profilesRoot, platformAgentAccountId);
    const child = relative(profilesRoot, candidate);
    if (
      child !== platformAgentAccountId ||
      child.startsWith(`..`) ||
      isAbsolute(child) ||
      dirname(candidate) !== profilesRoot
    ) {
      return null;
    }
    return candidate;
  }

  async function readReadyProfile(
    platformAgentAccountId: string,
  ): Promise<ReadyProfile | { readonly reason: UnreadyReason }> {
    const candidate = profilePath(platformAgentAccountId);
    if (candidate === null) return { reason: 'invalid_account_id' };
    const bindingFingerprint = identityBindings.get(platformAgentAccountId);
    if (bindingFingerprint === undefined) return { reason: 'profile_missing' };
    try {
      const rootStat = await fileSystem.lstat(profilesRoot);
      if (
        !rootStat.isDirectory() ||
        rootStat.isSymbolicLink() ||
        !samePath(await fileSystem.realpath(profilesRoot), profilesRoot, platform) ||
        (platform !== 'win32' &&
          ((rootStat.uid !== 0 && rootStat.uid !== effectiveUserId) ||
            (rootStat.mode & 0o022) !== 0))
      ) {
        return { reason: 'unsafe_profile' };
      }
      const rootAfterRealpath = await fileSystem.lstat(profilesRoot);
      if (
        !rootAfterRealpath.isDirectory() ||
        rootAfterRealpath.isSymbolicLink() ||
        !sameMetadata(metadata(rootStat), metadata(rootAfterRealpath))
      ) {
        return { reason: 'unsafe_profile' };
      }
      const profileStat = await fileSystem.lstat(candidate);
      if (
        !profileStat.isDirectory() ||
        profileStat.isSymbolicLink() ||
        !samePath(await fileSystem.realpath(candidate), candidate, platform) ||
        (platform !== 'win32' &&
          (profileStat.uid !== effectiveUserId || (profileStat.mode & 0o777) !== 0o700))
      ) {
        return { reason: 'unsafe_profile' };
      }
      const profileAfterRealpath = await fileSystem.lstat(candidate);
      if (
        !profileAfterRealpath.isDirectory() ||
        profileAfterRealpath.isSymbolicLink() ||
        !sameMetadata(metadata(profileStat), metadata(profileAfterRealpath))
      ) {
        return { reason: 'unsafe_profile' };
      }
      return {
        userDataDirectory: candidate,
        bindingFingerprint,
        profileMetadata: {
          root: metadata(rootAfterRealpath),
          profile: metadata(profileAfterRealpath),
        },
      };
    } catch (error) {
      return { reason: isMissing(error) ? 'profile_missing' : 'unsafe_profile' };
    }
  }

  async function closeSession(platformAgentAccountId: string, session: ActiveSession) {
    if (active.get(platformAgentAccountId) === session) active.delete(platformAgentAccountId);
    try {
      await session.context.close();
    } catch {
      // Readiness remains false without exposing browser or identity details.
    }
  }

  async function launch(
    platformAgentAccountId: string,
    profile: ReadyProfile,
  ): Promise<ActiveSession | null> {
    if (closed) return null;
    let context: KemerBetPersistentContextPort | null = null;
    try {
      context = asContextPort(
        await launcher.launchPersistentContext(profile.userDataDirectory, browserOptions),
      );
      if (closed) {
        await context.close();
        return null;
      }
      let pages = context.pages();
      if (pages.some((page) => !isSafeInitialPageUrl(pageUrl(page)))) {
        await context.close();
        return null;
      }
      if (pages.length === 0) pages = [await context.newPage()];
      if (pages.length !== 1 || !isSafeInitialPageUrl(pageUrl(pages[0]!))) {
        await context.close();
        return null;
      }
      const primaryPage = pages[0]!;
      context.on('page', (openedPage) => {
        if (openedPage !== primaryPage) closePageSilently(openedPage);
      });
      const agentPage = createPlaywrightKemerBetAgentPage({
        page: primaryPage,
        platformAgentAccountId,
        sessionKey: `kemerbet-agent-session-v1:${platformAgentAccountId}`,
        selectorContract: options.selectorContract,
        expectedAgentIdentityFingerprint: profile.bindingFingerprint,
        fingerprintAgentIdentity: options.fingerprintAgentIdentity,
        ...(options.pageTimeoutMs === undefined ? {} : { timeoutMs: options.pageTimeoutMs }),
        ...(options.maxHistoryPages === undefined
          ? {}
          : { maxHistoryPages: options.maxHistoryPages }),
        ...(options.maxHistoryRows === undefined ? {} : { maxHistoryRows: options.maxHistoryRows }),
        ...(options.agentTimeZone === undefined ? {} : { agentTimeZone: options.agentTimeZone }),
      });
      const lane = new SerialLane();
      const unSerializedBrowser = createKemerBetDepositBrowser({
        platformAgentAccountId,
        agentPage,
        routes: {
          agentDepositUrl: KEMERBET_AGENT_DEPOSIT_URL,
          agentHistoryUrl: KEMERBET_AGENT_HISTORY_URL,
        },
        now: options.now,
        fingerprintExternalReference: options.fingerprintExternalReference,
      });
      let session: ActiveSession | null = null;
      const browser = serializedBrowser(
        unSerializedBrowser,
        lane,
        async () => {
          const currentProfile = await readReadyProfile(platformAgentAccountId);
          if (
            !('userDataDirectory' in currentProfile) ||
            currentProfile.bindingFingerprint !== profile.bindingFingerprint ||
            !sameReadyProfile(currentProfile.profileMetadata, profile.profileMetadata)
          ) {
            throw new Error('The authenticated agent session is unavailable.');
          }
        },
        async () => {
          if (session === null) {
            await context?.close().catch(() => undefined);
            return;
          }
          await closeSession(platformAgentAccountId, session);
        },
      );
      session = {
        context,
        bindingFingerprint: profile.bindingFingerprint,
        profileMetadata: profile.profileMetadata,
        agentPage,
        lane,
        browser,
      };
      const exactSession = session;
      context.on('close', () => {
        if (active.get(platformAgentAccountId) === exactSession)
          active.delete(platformAgentAccountId);
      });
      // A launch is not ready until the exact authenticated UI identity is observed on a
      // side-effect-free route. No financial browser can escape the same serialized lane.
      await lane.run(async () => agentPage.probeAuthenticatedSession());
      const currentProfile = await readReadyProfile(platformAgentAccountId);
      if (
        !('userDataDirectory' in currentProfile) ||
        currentProfile.bindingFingerprint !== profile.bindingFingerprint ||
        !sameReadyProfile(currentProfile.profileMetadata, profile.profileMetadata) ||
        closed
      ) {
        await context.close();
        return null;
      }
      active.set(platformAgentAccountId, exactSession);
      return exactSession;
    } catch {
      if (context !== null) {
        try {
          await context.close();
        } catch {
          // Resolution remains unavailable; no credential, path, or browser detail is surfaced.
        }
      }
      return null;
    }
  }

  async function ensureSession(
    platformAgentAccountId: string,
    checkedProfile?: ReadyProfile,
  ): Promise<ActiveSession | null> {
    if (closed || !validPlatformAgentAccountId(platformAgentAccountId)) return null;
    const profileResult = checkedProfile ?? (await readReadyProfile(platformAgentAccountId));
    if (!('userDataDirectory' in profileResult)) {
      const existing = active.get(platformAgentAccountId);
      if (existing !== undefined) await closeSession(platformAgentAccountId, existing);
      return null;
    }
    const existing = active.get(platformAgentAccountId);
    if (existing !== undefined) {
      if (
        existing.bindingFingerprint === profileResult.bindingFingerprint &&
        sameReadyProfile(existing.profileMetadata, profileResult.profileMetadata)
      ) {
        return existing;
      }
      await closeSession(platformAgentAccountId, existing);
    }
    const inFlight = launching.get(platformAgentAccountId);
    if (inFlight !== undefined) {
      const launched = await inFlight;
      return launched?.bindingFingerprint === profileResult.bindingFingerprint ? launched : null;
    }
    const pending = launch(platformAgentAccountId, profileResult).finally(() => {
      if (launching.get(platformAgentAccountId) === pending)
        launching.delete(platformAgentAccountId);
    });
    launching.set(platformAgentAccountId, pending);
    return pending;
  }

  async function probeReadiness(
    platformAgentAccountId: string,
  ): Promise<KemerBetAgentSessionReadiness> {
    if (closed) return { ready: false, reason: 'registry_closed' };
    const profile = await readReadyProfile(platformAgentAccountId);
    if (!('userDataDirectory' in profile)) {
      const existing = active.get(platformAgentAccountId);
      if (existing !== undefined) await closeSession(platformAgentAccountId, existing);
      return { ready: false, reason: profile.reason };
    }
    const session = await ensureSession(platformAgentAccountId, profile);
    if (session === null) return { ready: false, reason: 'authenticated_session_unavailable' };
    try {
      await session.lane.run(async () => {
        const currentProfile = await readReadyProfile(platformAgentAccountId);
        if (
          !('userDataDirectory' in currentProfile) ||
          currentProfile.bindingFingerprint !== session.bindingFingerprint ||
          !sameReadyProfile(currentProfile.profileMetadata, session.profileMetadata)
        ) {
          throw new Error('The authenticated agent session is unavailable.');
        }
        await session.agentPage.probeAuthenticatedSession();
      });
      return { ready: true, reason: 'ready' };
    } catch {
      await closeSession(platformAgentAccountId, session);
      return { ready: false, reason: 'authenticated_session_unavailable' };
    }
  }

  return {
    probeReadiness,

    async probePlayerLookup(platformAgentAccountId, target) {
      const session = await ensureSession(platformAgentAccountId);
      if (session === null) return null;
      try {
        return await session.browser.probePlayerLookup(target);
      } catch {
        return null;
      }
    },

    async resolveBrowser(platformAgentAccountId) {
      return (await ensureSession(platformAgentAccountId))?.browser ?? null;
    },

    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([...launching.values()]);
      const contexts = [...new Set([...active.values()].map((session) => session.context))];
      active.clear();
      await Promise.allSettled(contexts.map(async (context) => context.close()));
    },
  };
}
