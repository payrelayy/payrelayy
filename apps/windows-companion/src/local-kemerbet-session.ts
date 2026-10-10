import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL,
  KEMERBET_AGENT_LOGIN_URL,
  KEMERBET_AGENT_LOGIN_RETRY_URL,
  KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS,
  KEMERBET_MAX_LOGIN_LIFETIME_SECONDS,
} from '@fetanagent/agent-platform-kemerbet';
import type { ExactFivePlayerIds } from '@fetanagent/agent-platform-companion-contracts';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

import type { WindowsCompanionConfig } from './config.js';
import { verifyLocalKemerBetIdentity } from './local-kemerbet-identity.js';
import {
  createLocalKemerBetDepositAuthorization,
  executeExactOneUseLocalKemerBetDeposit,
  executeRoutineOneUseLocalKemerBetDeposit,
  type LocalKemerBetFinalAction,
  type LocalKemerBetRoutineDepositDispatchOutcome,
  type LocalKemerBetRoutineFinalAction,
  type LocalKemerBetRoutinePreflightReporter,
} from './local-kemerbet-deposit.js';
import {
  createLocalKemerBetLookupAuthorization,
  executeExactFiveLocalKemerBetLookup,
  type LocalKemerBetLookupOutcome,
} from './local-kemerbet-lookup.js';
import {
  installProviderMutationBoundary,
  type LocalKemerBetDepositDispatchOutcome,
} from './provider-route.js';
import type { LocalKemerBetGuardPhase } from './request-guard.js';
import {
  installProviderSessionPassiveDiagnostics,
  type ProviderSessionDiagnosticEvent,
} from './provider-session-diagnostic.js';
import { installProviderSessionWebSocketBoundary } from './provider-websocket.js';
import { acquireSessionLock, releaseSessionLock, type SessionLock } from './session-lock.js';

// KemerBet's agent client returns to login after 900 seconds without a page-level reset. Reload
// the same guarded page while its Chrome-held session is still valid, with four minutes to spare.
const KEMERBET_SIGNED_IN_RELOAD_MS = 11 * 60 * 1_000;
const KEMERBET_BUSY_RELOAD_RETRY_MS = 15 * 1_000;

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
  readonly verified: Promise<boolean>;
  isSignedInVerified(): boolean;
  executeExactFiveLookup(
    playerIds: ExactFivePlayerIds,
  ): Promise<
    readonly [
      LocalKemerBetLookupOutcome,
      LocalKemerBetLookupOutcome,
      LocalKemerBetLookupOutcome,
      LocalKemerBetLookupOutcome,
      LocalKemerBetLookupOutcome,
    ]
  >;
  executeExactOneUseDeposit(
    playerId: string,
    acquireFinalAction: () => Promise<LocalKemerBetFinalAction>,
  ): Promise<LocalKemerBetDepositDispatchOutcome>;
  executeRoutineOneUseDeposit(
    playerId: string,
    amountMinor: number,
    acquireFinalAction: () => Promise<LocalKemerBetRoutineFinalAction>,
  ): Promise<LocalKemerBetRoutineDepositDispatchOutcome>;
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
  reportDiagnostic: (event: ProviderSessionDiagnosticEvent) => void = () => undefined,
  reportRoutinePreflight: LocalKemerBetRoutinePreflightReporter = () => undefined,
): Promise<LocalKemerBetSession> {
  report({ state: 'starting', transferDisabled: true, detailsRedacted: true });

  let phase: LocalKemerBetGuardPhase = 'manual_login';
  let expectedAgentIdentity = config.takeExpectedAgentIdentity();
  const lookupAuthorization = createLocalKemerBetLookupAuthorization();
  const depositAuthorization = createLocalKemerBetDepositAuthorization();
  let operationInProgress = false;
  let signedInCandidate = false;
  let signedInVerified = false;
  let stopping = false;
  let terminal = false;
  let identityVerificationEpoch = 0;
  let loginDeadlineEpoch = 0;
  let candidateDeadlineEpoch = 0;
  let identityVerificationPromise: Promise<void> | undefined;
  let loginTimer: NodeJS.Timeout | undefined;
  let candidateTimer: NodeJS.Timeout | undefined;
  let sessionTimer: NodeJS.Timeout | undefined;
  let signedInReloadTimer: NodeJS.Timeout | undefined;
  let context: BrowserContext | undefined;
  let localPage: Page | undefined;
  let lock: SessionLock | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  let resolveVerified!: (verified: boolean) => void;
  let verifiedSettled = false;
  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveDone = resolvePromise;
    rejectDone = rejectPromise;
  });
  // A blocked request can stop startup before startLocalKemerBetSession returns to its caller.
  // The returned promise still rejects, without an unhandled rejection in that startup window.
  void done.catch(() => undefined);
  const verified = new Promise<boolean>((resolvePromise) => {
    resolveVerified = resolvePromise;
  });
  const settleVerified = (value: boolean): void => {
    if (verifiedSettled) return;
    verifiedSettled = true;
    resolveVerified(value);
  };

  const disarmLoginDeadline = (): void => {
    loginDeadlineEpoch += 1;
    if (loginTimer !== undefined) clearTimeout(loginTimer);
    loginTimer = undefined;
  };

  const disarmCandidateDeadline = (): void => {
    candidateDeadlineEpoch += 1;
    if (candidateTimer !== undefined) clearTimeout(candidateTimer);
    candidateTimer = undefined;
  };

  const disarmSignedInReload = (): void => {
    if (signedInReloadTimer !== undefined) clearTimeout(signedInReloadTimer);
    signedInReloadTimer = undefined;
  };

  const finish = async (
    state: 'failed' | 'stopped',
    reason?: LocalKemerBetSessionEvent['reason'],
  ): Promise<void> => {
    if (terminal) return;
    terminal = true;
    settleVerified(false);
    lookupAuthorization.clear();
    depositAuthorization.clear();
    stopping = true;
    identityVerificationEpoch += 1;
    disarmLoginDeadline();
    disarmCandidateDeadline();
    disarmSignedInReload();
    if (sessionTimer) clearTimeout(sessionTimer);
    let browserClosed = context === undefined;
    let lockReleased = lock === undefined;
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
        lockReleased = true;
      } catch {
        // A subsequent start still verifies the lock owner before recovering a stale lock.
      }
    }
    const shutdownConfirmed = browserClosed && lockReleased;
    const finalState = shutdownConfirmed ? state : 'failed';
    const finalReason = shutdownConfirmed ? reason : 'shutdown_unconfirmed';
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
    // A signed routine launch already has a persistent Owner policy and a short server lease.
    // After its first verified sign-in, leave Chrome open for manual reauthentication if the
    // provider ends its session; the queue remains unable to claim work while signed out.
    if (config.routineDepositsEnabled && verifiedSettled) return;
    if (terminal || loginTimer !== undefined) return;
    const deadlineEpoch = ++loginDeadlineEpoch;
    loginTimer = setTimeout(() => {
      if (deadlineEpoch !== loginDeadlineEpoch) return;
      loginTimer = undefined;
      if (terminal || signedInCandidate || signedInVerified || phase !== 'manual_login') {
        return;
      }
      void finish('failed', 'login_lifetime_expired');
    }, KEMERBET_MAX_LOGIN_LIFETIME_SECONDS * 1_000);
    loginTimer.unref();
  };

  const armCandidateDeadline = (): void => {
    // Non-routine enrollment/execution windows retain their original non-sliding 12-hour cap.
    // Routine mode is separately proof-bound, re-verifies the local account on every refresh,
    // and loses its server lease when the process or verified provider session is unavailable.
    if (config.routineDepositsEnabled) return;
    if (terminal || candidateTimer !== undefined) return;
    const deadlineEpoch = ++candidateDeadlineEpoch;
    candidateTimer = setTimeout(() => {
      if (deadlineEpoch !== candidateDeadlineEpoch) return;
      candidateTimer = undefined;
      if (terminal || phase !== 'signed_in_read_only') {
        return;
      }
      void finish('stopped', 'candidate_lifetime_complete');
    }, KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS * 1_000);
    candidateTimer.unref();
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

    // KemerBet's admin hub requests a refresh token when its session needs renewal. Admit only
    // that exact socket and its non-financial UpdateSession invocation; all other sockets close.
    // The separate HTTP guard still confines the resulting refresh to /Account/RefreshToken.
    await installProviderSessionWebSocketBoundary(context, () => phase, reportDiagnostic);

    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    localPage = page;
    for (const extra of pages.slice(1)) await extra.close();
    installProviderSessionPassiveDiagnostics(context, page, reportDiagnostic);

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
      lookupAuthorization,
      depositAuthorization,
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
          settleVerified(true);
          report({
            state: 'signed_in_verified',
            transferDisabled: true,
            detailsRedacted: true,
            ...(result.bindingCreated ? { reason: 'identity_binding_created' as const } : {}),
          });
          armCandidateDeadline();
          armSignedInReload();
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
        disarmLoginDeadline();
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
        lookupAuthorization.clear();
        depositAuthorization.clear();
        disarmCandidateDeadline();
        disarmSignedInReload();
        phase = 'manual_login';
        armLoginDeadline();
        report({ state: 'login_required', transferDisabled: true, detailsRedacted: true });
      }
    };

    const armSignedInReload = (delayMs = KEMERBET_SIGNED_IN_RELOAD_MS): void => {
      disarmSignedInReload();
      if (terminal || stopping || !signedInVerified || phase !== 'signed_in_read_only') return;
      signedInReloadTimer = setTimeout(() => {
        signedInReloadTimer = undefined;
        if (terminal || stopping || !signedInVerified || phase !== 'signed_in_read_only') return;
        if (operationInProgress) {
          armSignedInReload(KEMERBET_BUSY_RELOAD_RETRY_MS);
          return;
        }
        // Stop new Player work before changing the provider page. The same bound account must
        // become visible and pass identity verification again before the queue can resume.
        signedInVerified = false;
        identityVerificationEpoch += 1;
        lookupAuthorization.clear();
        depositAuthorization.clear();
        report({ state: 'verifying_identity', transferDisabled: true, detailsRedacted: true });
        void page
          .reload({ waitUntil: 'commit', timeout: 45_000 })
          .then(() => observePage(page))
          .catch(() => finish('failed', 'provider_request_failed'));
      }, delayMs);
      signedInReloadTimer.unref();
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
        settleVerified(false);
        lookupAuthorization.clear();
        depositAuthorization.clear();
        disarmLoginDeadline();
        disarmCandidateDeadline();
        disarmSignedInReload();
        if (sessionTimer) clearTimeout(sessionTimer);
        void releaseSessionLock(lock)
          .then(() => {
            lock = undefined;
            report({
              state: 'stopped',
              transferDisabled: true,
              detailsRedacted: true,
              reason: 'browser_closed',
            });
            resolveDone();
          })
          .catch(() => {
            report({
              state: 'failed',
              transferDisabled: true,
              detailsRedacted: true,
              reason: 'shutdown_unconfirmed',
            });
            rejectDone(new Error('The local KemerBet session failed closed.'));
          });
      }
    });

    armLoginDeadline();
    // The one-use read-only and execution modes keep their hard process cap. A signed routine
    // launch instead keeps this same guarded window open while the Owner policy and server lease
    // remain valid; returning to login pauses work rather than silently logging in again.
    if (!config.routineDepositsEnabled) {
      sessionTimer = setTimeout(
        () => {
          void finish('stopped', 'session_lifetime_complete');
        },
        (KEMERBET_MAX_LOGIN_LIFETIME_SECONDS + KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS) * 1_000,
      );
      sessionTimer.unref();
    }

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
    verified,
    isSignedInVerified: () =>
      !terminal && !stopping && signedInVerified && phase === 'signed_in_read_only',
    async executeExactFiveLookup(playerIds: ExactFivePlayerIds) {
      const page = localPage;
      if (terminal || stopping || !signedInVerified || operationInProgress || !page) {
        throw new Error('The local KemerBet lookup session is unavailable.');
      }
      operationInProgress = true;
      try {
        return await executeExactFiveLocalKemerBetLookup(page, playerIds, lookupAuthorization);
      } finally {
        lookupAuthorization.clear();
        operationInProgress = false;
      }
    },
    async executeExactOneUseDeposit(
      playerId: string,
      acquireFinalAction: () => Promise<LocalKemerBetFinalAction>,
    ) {
      const page = localPage;
      if (terminal || stopping || !signedInVerified || operationInProgress || !page) {
        throw new Error('The local KemerBet execution session is unavailable.');
      }
      operationInProgress = true;
      try {
        return await executeExactOneUseLocalKemerBetDeposit(
          page,
          playerId,
          lookupAuthorization,
          depositAuthorization,
          acquireFinalAction,
        );
      } finally {
        lookupAuthorization.clear();
        depositAuthorization.clear();
        operationInProgress = false;
      }
    },
    async executeRoutineOneUseDeposit(
      playerId: string,
      amountMinor: number,
      acquireFinalAction: () => Promise<LocalKemerBetRoutineFinalAction>,
    ) {
      const page = localPage;
      if (terminal || stopping || !signedInVerified || operationInProgress || !page) {
        try {
          reportRoutinePreflight('session_unavailable');
        } catch {
          // A diagnostic callback cannot change the guarded execution result.
        }
        throw new Error('The local KemerBet execution session is unavailable.');
      }
      operationInProgress = true;
      try {
        return await executeRoutineOneUseLocalKemerBetDeposit(
          page,
          playerId,
          amountMinor,
          lookupAuthorization,
          depositAuthorization,
          acquireFinalAction,
          reportRoutinePreflight,
        );
      } finally {
        lookupAuthorization.clear();
        depositAuthorization.clear();
        operationInProgress = false;
      }
    },
    stop: () => finish('stopped'),
  });
}
