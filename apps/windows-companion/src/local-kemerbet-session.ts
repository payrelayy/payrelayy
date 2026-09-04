import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL,
  KEMERBET_AGENT_LOGIN_URL,
  KEMERBET_AGENT_LOGIN_RETRY_URL,
  KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS,
  KEMERBET_MAX_LOGIN_LIFETIME_SECONDS,
} from '@fetanagent/agent-platform-kemerbet';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

import type { WindowsCompanionConfig } from './config.js';
import { verifyLocalKemerBetIdentity } from './local-kemerbet-identity.js';
import { installProviderMutationBoundary } from './provider-route.js';
import { isLocalKemerBetProviderUrl, type LocalKemerBetGuardPhase } from './request-guard.js';
import { acquireSessionLock, releaseSessionLock, type SessionLock } from './session-lock.js';

export type LocalKemerBetSessionState =
  | 'starting'
  | 'login_required'
  | 'signed_in_candidate'
  | 'verifying_identity'
  | 'signed_in_verified'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface LocalKemerBetSessionEvent {
  readonly state: LocalKemerBetSessionState;
  readonly transferDisabled: true;
  readonly detailsRedacted: true;
  readonly reason?:
    | 'candidate_lifetime_complete'
    | 'browser_closed'
    | 'identity_binding_created'
    | 'identity_binding_unavailable'
    | 'identity_confirmation_required'
    | 'identity_mismatch'
    | 'login_lifetime_expired'
    | 'mutation_attempt_blocked'
    | 'profile_in_use'
    | 'profile_path_unsafe'
    | 'provider_request_failed'
    | 'shutdown_unconfirmed'
    | 'session_lifetime_complete'
    | 'startup_failed'
    | 'unexpected_page';
}

export interface LocalKemerBetSession {
  readonly done: Promise<void>;
  stop(): Promise<void>;
}

function classifyPageUrl(
  rawUrl: string,
): 'authenticated_candidate' | 'login' | 'provider_other' | 'unsupported' {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'unsupported';
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') return 'unsupported';
  if (
    url.origin === new URL(KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL).origin &&
    (url.pathname === '/agents' || url.pathname === '/agents/') &&
    url.search === ''
  ) {
    return 'authenticated_candidate';
  }
  if (url.href === KEMERBET_AGENT_LOGIN_URL || url.href === KEMERBET_AGENT_LOGIN_RETRY_URL) {
    return 'login';
  }
  if (url.origin === new URL(KEMERBET_AGENT_LOGIN_URL).origin) return 'provider_other';
  return 'unsupported';
}

async function assertStableProfilePath(profileRoot: string): Promise<void> {
  const expected = resolve(profileRoot).toLocaleLowerCase('en-US');
  const actual = (await realpath(profileRoot)).toLocaleLowerCase('en-US');
  if (expected !== actual) {
    throw Object.assign(new Error('The companion profile path is redirected.'), {
      code: 'FETANAGENT_PROFILE_PATH_UNSAFE',
    });
  }
}

export async function startLocalKemerBetSession(
  config: WindowsCompanionConfig,
  report: (event: LocalKemerBetSessionEvent) => void,
): Promise<LocalKemerBetSession> {
  report({ state: 'starting', transferDisabled: true, detailsRedacted: true });

  let phase: LocalKemerBetGuardPhase = 'manual_login';
  let expectedAgentIdentity = config.takeExpectedAgentIdentity();
  let signedInCandidate = false;
  let signedInVerified = false;
  let stopping = false;
  let terminal = false;
  let identityVerificationEpoch = 0;
  let identityVerificationPromise: Promise<void> | undefined;
  let loginTimer: NodeJS.Timeout | undefined;
  let candidateTimer: NodeJS.Timeout | undefined;
  let sessionTimer: NodeJS.Timeout | undefined;
  let context: BrowserContext | undefined;
  let lock: SessionLock | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveDone = resolvePromise;
    rejectDone = rejectPromise;
  });
  // A blocked request can stop startup before startLocalKemerBetSession returns to its caller.
  // The returned promise still rejects, without an unhandled rejection in that startup window.
  void done.catch(() => undefined);

  const finish = async (
    state: 'failed' | 'stopped',
    reason?: LocalKemerBetSessionEvent['reason'],
  ): Promise<void> => {
    if (terminal) return;
    terminal = true;
    stopping = true;
    identityVerificationEpoch += 1;
    if (loginTimer) clearTimeout(loginTimer);
    if (candidateTimer) clearTimeout(candidateTimer);
    if (sessionTimer) clearTimeout(sessionTimer);
    let browserClosed = context === undefined;
    try {
      await context?.close();
      browserClosed = true;
    } catch {
      // Keep the mutation boundary attached if shutdown cannot be confirmed.
    }
    if (browserClosed) {
      try {
        await releaseSessionLock(lock);
        lock = undefined;
      } catch {
        // A subsequent start still verifies the lock owner before recovering a stale lock.
      }
    }
    const finalState = browserClosed ? state : 'failed';
    const finalReason = browserClosed ? reason : 'shutdown_unconfirmed';
    report({
      state: finalState,
      transferDisabled: true,
      detailsRedacted: true,
      ...(finalReason === undefined ? {} : { reason: finalReason }),
    });
    if (finalState === 'failed') rejectDone(new Error('The local KemerBet session failed closed.'));
    else resolveDone();
  };

  const armLoginDeadline = (): void => {
    if (terminal || loginTimer !== undefined) return;
    loginTimer = setTimeout(() => {
      void finish('failed', 'login_lifetime_expired');
    }, KEMERBET_MAX_LOGIN_LIFETIME_SECONDS * 1_000);
    loginTimer.unref();
  };

  try {
    await mkdir(config.profileRoot, { recursive: true });
    await assertStableProfilePath(config.profileRoot);
    lock = await acquireSessionLock(config.dataRoot);
    context = await chromium.launchPersistentContext(config.profileRoot, {
      acceptDownloads: false,
      channel: 'chrome',
      chromiumSandbox: true,
      headless: false,
      offline: true,
      serviceWorkers: 'block',
      viewport: null,
      args: ['--no-first-run', '--no-default-browser-check'],
    });

    // The enrollment slice has no provider WebSocket capability. Blocking the two provider
    // origins closes a transport that cannot express the reviewed read/login HTTP contract and
    // therefore cannot be allowed to bypass its method-and-path guard.
    await context.routeWebSocket(isLocalKemerBetProviderUrl, (route) =>
      route.close({ code: 1008, reason: 'Enrollment transport disabled' }),
    );

    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    for (const extra of pages.slice(1)) await extra.close();

    await installProviderMutationBoundary(
      context,
      () => phase,
      (reason) => {
        if (!stopping) {
          // A refused notification or other unapproved request must not destroy the login
          // window. Its network operation stays blocked while the owner retains visible feedback.
          report({
            state: signedInVerified
              ? 'signed_in_verified'
              : signedInCandidate
                ? 'signed_in_candidate'
                : 'login_required',
            transferDisabled: true,
            detailsRedacted: true,
            reason,
          });
        }
      },
    );

    const beginIdentityVerification = async (): Promise<void> => {
      if (terminal || signedInVerified) return;
      if (identityVerificationPromise !== undefined) {
        await identityVerificationPromise;
        if (
          !terminal &&
          !signedInVerified &&
          classifyPageUrl(page.url()) === 'authenticated_candidate'
        ) {
          await beginIdentityVerification();
        }
        return;
      }
      const verificationEpoch = ++identityVerificationEpoch;
      report({ state: 'verifying_identity', transferDisabled: true, detailsRedacted: true });
      const task = (async () => {
        try {
          const result = await verifyLocalKemerBetIdentity({
            dataRoot: config.dataRoot,
            ...(expectedAgentIdentity === undefined ? {} : { expectedAgentIdentity }),
            page,
            releaseSha: config.releaseSha,
          });
          if (
            terminal ||
            verificationEpoch !== identityVerificationEpoch ||
            classifyPageUrl(page.url()) !== 'authenticated_candidate'
          ) {
            return;
          }
          expectedAgentIdentity = undefined;
          signedInVerified = true;
          report({
            state: 'signed_in_verified',
            transferDisabled: true,
            detailsRedacted: true,
            ...(result.bindingCreated ? { reason: 'identity_binding_created' as const } : {}),
          });
          candidateTimer = setTimeout(() => {
            void finish('stopped', 'candidate_lifetime_complete');
          }, KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS * 1_000);
          candidateTimer.unref();
        } catch (error) {
          if (terminal || verificationEpoch !== identityVerificationEpoch) return;
          throw error;
        }
      })();
      const trackedTask = task.finally(() => {
        if (identityVerificationPromise === trackedTask) identityVerificationPromise = undefined;
      });
      identityVerificationPromise = trackedTask;
      return trackedTask;
    };

    const markSignedInCandidate = async (): Promise<void> => {
      if (terminal) return;
      if (!signedInCandidate) {
        signedInCandidate = true;
        if (loginTimer) clearTimeout(loginTimer);
        loginTimer = undefined;
        report({ state: 'signed_in_candidate', transferDisabled: true, detailsRedacted: true });
      }
      await beginIdentityVerification();
    };

    const identityFailureReason = (error: unknown): LocalKemerBetSessionEvent['reason'] => {
      const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
      if (code === 'FETANAGENT_IDENTITY_CONFIRMATION_REQUIRED') {
        return 'identity_confirmation_required';
      }
      if (code === 'FETANAGENT_IDENTITY_MISMATCH') return 'identity_mismatch';
      return 'identity_binding_unavailable';
    };

    const observePage = async (candidate: Page): Promise<void> => {
      const kind = classifyPageUrl(candidate.url());
      if (kind === 'unsupported' && candidate.url() !== 'about:blank' && !stopping) {
        void finish('failed', 'unexpected_page');
        return;
      }
      if (kind === 'authenticated_candidate') {
        phase = 'signed_in_read_only';
        // This route is only a candidate. The local identity verifier must still reject visible
        // signed-out state and match the exact reviewed header to its protected local binding.
        await markSignedInCandidate();
        return;
      }
      if (kind === 'login') {
        identityVerificationEpoch += 1;
        signedInCandidate = false;
        signedInVerified = false;
        if (candidateTimer) clearTimeout(candidateTimer);
        candidateTimer = undefined;
        phase = 'manual_login';
        armLoginDeadline();
        report({ state: 'login_required', transferDisabled: true, detailsRedacted: true });
      }
    };

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        void observePage(page).catch((error: unknown) =>
          finish('failed', identityFailureReason(error)),
        );
      }
    });
    context.on('page', (candidate) => {
      if (candidate !== page && !stopping) {
        void candidate
          .close()
          .catch(() => undefined)
          .finally(() => finish('failed', 'unexpected_page'));
      }
    });
    context.on('close', () => {
      if (!terminal) {
        terminal = true;
        if (loginTimer) clearTimeout(loginTimer);
        if (candidateTimer) clearTimeout(candidateTimer);
        if (sessionTimer) clearTimeout(sessionTimer);
        void releaseSessionLock(lock)
          .catch(() => undefined)
          .finally(() => {
            lock = undefined;
            report({
              state: 'stopped',
              transferDisabled: true,
              detailsRedacted: true,
              reason: 'browser_closed',
            });
            resolveDone();
          });
      }
    });

    armLoginDeadline();
    // Reauthentication cannot extend one browser process indefinitely.
    sessionTimer = setTimeout(
      () => {
        void finish('stopped', 'session_lifetime_complete');
      },
      (KEMERBET_MAX_LOGIN_LIFETIME_SECONDS + KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS) * 1_000,
    );
    sessionTimer.unref();

    await context.setOffline(false);

    // Try the authenticated surface first. A valid persisted KemerBet session stays there; an
    // expired or absent session follows KemerBet's normal redirect to its local sign-in page.
    await page.goto(KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL, {
      // Commit is enough to establish the guarded provider page. Waiting for every bootstrap
      // asset made a slow provider response look like a failed local launch.
      waitUntil: 'commit',
      timeout: 45_000,
    });
    await observePage(page);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
    const reason =
      code === 'FETANAGENT_PROFILE_IN_USE'
        ? 'profile_in_use'
        : code === 'FETANAGENT_PROFILE_PATH_UNSAFE'
          ? 'profile_path_unsafe'
          : code === 'FETANAGENT_IDENTITY_CONFIRMATION_REQUIRED'
            ? 'identity_confirmation_required'
            : code === 'FETANAGENT_IDENTITY_MISMATCH'
              ? 'identity_mismatch'
              : code === 'FETANAGENT_IDENTITY_BINDING_UNAVAILABLE'
                ? 'identity_binding_unavailable'
                : 'startup_failed';
    await finish('failed', reason);
    await done.catch(() => undefined);
    throw new Error('The protected local KemerBet browser could not start.');
  }

  return Object.freeze({
    done,
    stop: () => finish('stopped'),
  });
}
