import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core';

import {
  assertKemerBetChromiumProfileCleanlyClosed,
  KemerBetChromiumProfileUnavailableError,
} from './kemerbet-chromium-profile.js';

const BROWSER_DISCONNECT_TIMEOUT_MS = 60_000;
const PROFILE_ATTESTATION_ATTEMPTS = 20;
const PROFILE_ATTESTATION_INTERVAL_MS = 250;

export interface KemerBetPersistentBrowserCheckpointDependencies {
  readonly assertProfileCleanlyClosed?: (
    profilePath: string,
    effectiveUserId: number,
  ) => Promise<void>;
  readonly clearTimer?: typeof clearTimeout;
  readonly disconnectTimeoutMs?: number;
  readonly profileAttestationAttempts?: number;
  readonly profileAttestationIntervalMs?: number;
  readonly setTimer?: typeof setTimeout;
}

export class KemerBetPersistentBrowserCheckpointUnavailableError extends Error {
  constructor() {
    super('The private KemerBet persistent-browser checkpoint is unavailable.');
    this.name = 'KemerBetPersistentBrowserCheckpointUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetPersistentBrowserCheckpointUnavailableError();
}

function exactLiveTopology(browser: Browser, context: BrowserContext, page: Page): boolean {
  try {
    const contexts = browser.contexts();
    return (
      browser.isConnected() &&
      !context.isClosed() &&
      !page.isClosed() &&
      page.context() === context &&
      contexts.length === 1 &&
      contexts[0] === context &&
      context.pages().length === 1 &&
      context.pages()[0] === page
    );
  } catch {
    return false;
  }
}

function exactClosedTopology(browser: Browser, context: BrowserContext, page: Page): boolean {
  try {
    return !browser.isConnected() && context.isClosed() && page.isClosed();
  } catch {
    return false;
  }
}

async function waitForBrowserDisconnect(options: {
  readonly browser: Browser;
  readonly closeSession: CDPSession;
  readonly clearTimer: typeof clearTimeout;
  readonly setTimer: typeof setTimeout;
  readonly timeoutMs: number;
}): Promise<void> {
  const { browser, closeSession, clearTimer, setTimer, timeoutMs } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeListener = (): void => undefined;
  const disconnected = new Promise<void>((resolvePromise, rejectPromise) => {
    const onDisconnected = (): void => resolvePromise();
    removeListener = () => browser.off('disconnected', onDisconnected);
    browser.once('disconnected', onDisconnected);
    timer = setTimer(
      () => rejectPromise(new KemerBetPersistentBrowserCheckpointUnavailableError()),
      timeoutMs,
    );
  });
  // Sending Browser.close directly avoids Playwright's internal 30-second close-or-SIGKILL timer.
  // The promise can reject only because the accepted command closed its own transport, so the
  // independently awaited disconnected event and on-disk attestation remain authoritative.
  const command = closeSession.send('Browser.close').then(
    () => 'accepted' as const,
    () => (browser.isConnected() ? ('rejected_live' as const) : ('transport_closed' as const)),
  );
  try {
    const first = await Promise.race([disconnected.then(() => 'disconnected' as const), command]);
    if (first === 'rejected_live') unavailable();
    await disconnected;
  } finally {
    if (timer !== undefined) clearTimer(timer);
    removeListener();
  }
}

async function waitForCleanProfile(options: {
  readonly assertProfileCleanlyClosed: (
    profilePath: string,
    effectiveUserId: number,
  ) => Promise<void>;
  readonly attempts: number;
  readonly effectiveUserId: number;
  readonly intervalMs: number;
  readonly profilePath: string;
  readonly setTimer: typeof setTimeout;
}): Promise<void> {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      await options.assertProfileCleanlyClosed(options.profilePath, options.effectiveUserId);
      return;
    } catch (error) {
      if (
        !(error instanceof KemerBetChromiumProfileUnavailableError) ||
        attempt === options.attempts - 1
      ) {
        return unavailable();
      }
      await new Promise<void>((resolvePromise) => {
        options.setTimer(resolvePromise, options.intervalMs);
      });
    }
  }
  return unavailable();
}

/**
 * Terminally close one exact persistent Chromium context without Playwright's silent force-kill
 * fallback, then accept the checkpoint only after Chromium itself records an orderly profile exit.
 * Callers must install their irreversible input latch before invoking this function.
 */
export async function closeKemerBetPersistentBrowserForRestorableCheckpoint(
  input: {
    readonly context: BrowserContext;
    readonly effectiveUserId: number;
    readonly page: Page;
    readonly profilePath: string;
  },
  dependencies: KemerBetPersistentBrowserCheckpointDependencies = {},
): Promise<void> {
  if (input.effectiveUserId !== 10_001) unavailable();
  const browser = input.context.browser();
  if (browser === null || !exactLiveTopology(browser, input.context, input.page)) unavailable();

  let closeSession: CDPSession;
  try {
    closeSession = await browser.newBrowserCDPSession();
  } catch {
    return unavailable();
  }
  if (!exactLiveTopology(browser, input.context, input.page)) {
    await closeSession.detach().catch(() => undefined);
    return unavailable();
  }

  const timeoutMs = dependencies.disconnectTimeoutMs ?? BROWSER_DISCONNECT_TIMEOUT_MS;
  const attempts = dependencies.profileAttestationAttempts ?? PROFILE_ATTESTATION_ATTEMPTS;
  const intervalMs = dependencies.profileAttestationIntervalMs ?? PROFILE_ATTESTATION_INTERVAL_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > BROWSER_DISCONNECT_TIMEOUT_MS ||
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > PROFILE_ATTESTATION_ATTEMPTS ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 0 ||
    intervalMs > PROFILE_ATTESTATION_INTERVAL_MS
  ) {
    await closeSession.detach().catch(() => undefined);
    return unavailable();
  }

  await waitForBrowserDisconnect({
    browser,
    closeSession,
    clearTimer: dependencies.clearTimer ?? clearTimeout,
    setTimer: dependencies.setTimer ?? setTimeout,
    timeoutMs,
  });
  if (!exactClosedTopology(browser, input.context, input.page)) unavailable();

  await waitForCleanProfile({
    assertProfileCleanlyClosed:
      dependencies.assertProfileCleanlyClosed ?? assertKemerBetChromiumProfileCleanlyClosed,
    attempts,
    effectiveUserId: input.effectiveUserId,
    intervalMs,
    profilePath: input.profilePath,
    setTimer: dependencies.setTimer ?? setTimeout,
  });
  if (!exactClosedTopology(browser, input.context, input.page)) unavailable();
}

export const KEMERBET_PERSISTENT_BROWSER_CHECKPOINT_CONTRACT = Object.freeze({
  browserDisconnectTimeoutMs: BROWSER_DISCONNECT_TIMEOUT_MS,
  profileAttestationAttempts: PROFILE_ATTESTATION_ATTEMPTS,
  profileAttestationIntervalMs: PROFILE_ATTESTATION_INTERVAL_MS,
});
