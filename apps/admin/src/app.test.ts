import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
  loadOwnerControlConfig,
} from '@fetanagent/config/owner-control';
import { describe, expect, it } from 'vitest';

import { buildOwnerControlApp as buildOwnerControlAppProduction } from './app.js';
import {
  OwnerKemerbetReadinessCohortRejectedError,
  type OwnerKemerbetReadinessCohortControl,
  type OwnerKemerbetReadinessCohortReceipt,
} from './owner-kemerbet-readiness-cohort.js';
import type {
  OwnerKemerbetSessionControl,
  OwnerKemerbetSessionStatus,
} from './owner-kemerbet-session-control.js';
import { OWNER_DASHBOARD_JAVASCRIPT } from './owner-dashboard.js';
import { OwnerInviteRejectedError } from './owner-invites.js';
import {
  OwnerPrivateLivePilotUnavailableError,
  type PrivateLivePilotStatus,
} from './owner-private-live-pilot.js';
import type { OwnerControlPostgresRuntime } from './postgres-runtime.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const inviteId = '22222222-2222-4222-8222-222222222222';
const pilotRevisionId = '33333333-3333-4333-8333-333333333333';
const pilotRequestId = '55555555-5555-4555-8555-555555555555';
const bearer = 'header.payload.signature-with-safe-characters';
const receiverEncryptionMaster = 'c'.repeat(64);
const receiverFingerprintMaster = 'd'.repeat(64);
const receiverMasterProfile = JSON.stringify({
  encryptionMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from(receiverEncryptionMaster, 'hex'))
    .digest('hex')}`,
  fingerprintMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from(receiverFingerprintMaster, 'hex'))
    .digest('hex')}`,
  version: 2,
});

function pilotStatus(overrides: Partial<PrivateLivePilotStatus> = {}): PrivateLivePilotStatus {
  return {
    configurationDigest: `sha256:${'a'.repeat(64)}`,
    contractVersion: 1 as const,
    expiresAt: '2026-08-21T22:00:00.000Z',
    financiallyActive: false,
    maximumAggregateMinor: '12500',
    maximumReservationCount: 5,
    pilotRevisionId,
    pilotStatus: 'draft' as const,
    playerCount: 5,
    providerCount: 1,
    reservedAmountMinor: '0',
    reservedDepositCount: 0,
    revision: 1,
    submittingCustomerCount: 1,
    switchMode: 'disabled' as const,
    withinActiveWindow: true,
    ...overrides,
  };
}

function pilotMutationHeaders(requestId = pilotRequestId) {
  return {
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:3002',
    'x-fetanagent-owner-csrf': 'private-live-pilot-v1',
    'x-idempotency-key': requestId,
  };
}

function receiverMutationHeaders(requestId = pilotRequestId) {
  return {
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:3002',
    'x-fetanagent-owner-csrf': 'owner-receiver-rotation-v1',
    'x-idempotency-key': requestId,
  };
}

function kemerbetAgentProfileMutationHeaders(requestId = pilotRequestId) {
  return {
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:3002',
    'x-fetanagent-owner-csrf': 'owner-kemerbet-agent-profile-v1',
    'x-idempotency-key': requestId,
  };
}

function kemerbetSessionMutationHeaders(requestId = pilotRequestId) {
  return {
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:3002',
    'x-fetanagent-owner-csrf': 'owner-kemerbet-session-v1',
    'x-idempotency-key': requestId,
  };
}

function kemerbetReadinessCohortMutationHeaders(requestId = pilotRequestId) {
  return {
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:3002',
    'x-fetanagent-owner-csrf': 'owner-kemerbet-readiness-cohort-v1',
    'x-idempotency-key': requestId,
  };
}

const inactiveKemerbetSession: OwnerKemerbetSessionStatus = {
  active: false,
  loginRequired: false,
  phase: 'idle',
  signedIn: false,
  transferDisabled: true,
};

const quarantinedKemerbetSession: OwnerKemerbetSessionStatus = {
  active: false,
  loginRequired: false,
  phase: 'idle',
  quarantine: {
    reasonCode: 'unclean_session_generation',
    recoveryRequired: true,
  },
  signedIn: false,
  transferDisabled: true,
};

const activeKemerbetSession: OwnerKemerbetSessionStatus = {
  active: true,
  expiresAt: '2026-08-23T12:10:00.000Z',
  frameSequence: 1,
  generation: pilotRequestId,
  loginRequired: true,
  phase: 'login_required',
  signedIn: false,
  transferDisabled: true,
};

const noMarkerReadinessControl: OwnerKemerbetReadinessCohortControl = {
  completed: async () => false,
  lifecycle: async () => 'empty',
  prepare: async () => {
    throw new Error('readiness preparation was not expected');
  },
  rootReceipt: async () => undefined,
};

function buildOwnerControlApp(
  ...[appConfig, dependencies]: Parameters<typeof buildOwnerControlAppProduction>
) {
  return buildOwnerControlAppProduction(appConfig, {
    kemerbetReadinessCohortControl: noMarkerReadinessControl,
    ...dependencies,
  });
}

function readinessEligiblePlayers() {
  return [1, 2, 3, 4, 5].map((index) => ({
    decidedAt: '2026-08-25T09:00:00.000Z',
    decision: 'eligible' as const,
    decisionId: `10000000-0000-4000-8000-00000000000${index}`,
    decisionVersion: index,
    playerAccountId: `00000000-0000-4000-8000-00000000000${index}`,
    playerId: `PLAYER_${index}`,
    playerStatus: 'active' as const,
    platformCode: 'kemerbet' as const,
    reasonCode: 'financial_eligibility_approved' as const,
    validationStatus: 'valid' as const,
  }));
}

function config() {
  return loadOwnerControlConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
    OWNER_CONTROL_DATABASE_URL: `postgresql://fetanagent_owner_control_runtime:password@db.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co:5432/postgres?sslmode=verify-full`,
    OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
    OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key_for_staging_only',
    OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER: receiverEncryptionMaster,
    OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER: receiverFingerprintMaster,
    OWNER_RECEIVER_REFERENCE_PROFILE: receiverMasterProfile,
  });
}

function runtime(
  overrides: Partial<OwnerControlPostgresRuntime> = {},
): OwnerControlPostgresRuntime {
  return {
    assessments: {
      assess: async (_actor, deposit, fixtureId) => ({
        alreadyRecorded: false,
        assessedAt: '2026-08-13T10:00:00.000Z',
        assessmentId: '44444444-4444-4444-8444-444444444444',
        depositIntentId: deposit.depositIntentId,
        fixtureId: fixtureId as 'valid-completed',
        outcome: 'would_review',
        reasonCode: 'payment_stale',
      }),
      list: async () => [],
      review: async (_actor, assessmentId, decision) => ({
        alreadyRecorded: false,
        assessmentId,
        decision,
        reviewedAt: '2026-08-13T10:01:00.000Z',
      }),
    },
    deposits: {
      list: async () => [],
    },
    eligibility: {
      decide: async (_actor, playerAccountId, decision) => ({
        alreadyRecorded: false,
        decidedAt: '2026-08-19T16:30:00.000Z',
        decision,
        decisionId: '44444444-4444-4444-8444-444444444444',
        decisionVersion: 1,
        playerAccountId,
        reasonCode:
          decision === 'eligible'
            ? 'financial_eligibility_approved'
            : 'financial_eligibility_revoked',
      }),
      list: async () => [],
    },
    invites: {
      issue: async () => ({
        expiresAt: '2026-08-11T12:00:00.000Z',
        inviteId,
        inviteUrl: 'https://t.me/fetanagentbot?start=raw-token-returned-once',
      }),
      revoke: async () => undefined,
    },
    kemerbetAgentProfiles: {
      list: async () => [],
      prepare: async (_actor, request) => ({
        configuredAt: '2026-08-22T19:30:00.000Z',
        configurationReason: request.configurationReason,
        platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
        platformCode: 'kemerbet',
        profileContractVersion: 1,
        profileLabel: 'Primary KemerBet agent revision 1',
        profileRevision: 1,
        profileStatus: 'active',
      }),
    },
    kemerbetReadinessCohorts: {
      claim: async () => ({
        alreadyClaimed: false,
        claimId: '88888888-8888-4888-8888-888888888888',
        players: readinessEligiblePlayers(),
        state: 'prepared',
      }),
      markExported: async (_actor, _requestId, claimId) => ({
        alreadyRecorded: false,
        claimId,
        state: 'exported',
        transitionedAt: '2026-08-25T09:05:00.000Z',
      }),
      recordRootReceipt: async () => {
        throw new Error('root receipt must not run without an exact filesystem receipt');
      },
    },
    playerRegistrations: {
      associate: async (_actor, requestId) => ({
        alreadyRecorded: false,
        associatedAt: '2026-08-11T12:15:00.000Z',
        playerAccountId: '33333333-3333-4333-8333-333333333333',
        requestId,
      }),
      list: async () => [],
      listAssociationCandidates: async () => [],
      review: async (_actor, requestId, decision) => ({
        alreadyRecorded: false,
        requestId,
        reviewedAt: '2026-08-11T12:10:00.000Z',
        status: decision,
      }),
    },
    privateLivePilot: {
      arm: async () => ({
        alreadyApplied: false,
        status: pilotStatus({ pilotStatus: 'armed', switchMode: 'dry_run' }),
      }),
      current: async () => undefined,
      prepare: async () => pilotStatus(),
      status: async () => pilotStatus(),
      stop: async () =>
        pilotStatus({
          pilotStatus: 'stopped',
          stopReasonCode: 'owner_stop',
          stoppedAt: '2026-08-21T20:30:00.000Z',
        }),
    },
    receivers: {
      list: async () => [],
      rotate: async (_actor, request) => ({
        accountHolderName: request.accountHolderName,
        accountReferenceMasked: `***${request.accountReference.slice(-4)}`,
        activeFrom: '2026-08-22T13:30:00.000Z',
        protectedReference: true,
        providerCode: request.providerCode,
        providerDisplayName: request.providerCode === 'cbe_birr' ? 'CBE Birr' : 'TeleBirr',
        receiverRevisionId: '66666666-6666-4666-8666-666666666666',
        receiverStatus: 'active',
        revision: 1,
        rotationReason: request.rotationReason,
      }),
    },
    ready: async () => true,
    close: async () => undefined,
    ...overrides,
  };
}

function verifiedAuthFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ id: authUserId }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function nextEventLoopTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('Owner-control HTTP boundary', () => {
  it('serves a no-store, loopback-only Owner page with strict browser policy', async () => {
    const app = buildOwnerControlApp(config(), { runtime: runtime() });
    const response = await app.inject({ method: 'GET', url: '/owner' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store, max-age=0');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain(
      `connect-src 'self' https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
    );
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['permissions-policy']).toContain('payment=()');
    expect(response.body).toContain('FetanAgent Owner');
    expect(response.body).toMatch(
      /securely renews the Owner access token for up to twelve\s+hours/u,
    );
    expect(response.body).toContain('id="owner-session-status"');
    expect(response.body).toContain('KemerBet Player ID requests');
    expect(response.body).toContain('This does not prove ownership');
    expect(response.body).toContain('Explicit ownership confirmation');
    expect(response.body).toContain('Player ID ownership associations');
    expect(response.body).toContain('Deposit eligibility decisions');
    expect(response.body).toContain('Receiving accounts');
    expect(response.body).toContain('never rewrites receipt history');
    expect(response.body).toMatch(/does not open a deposit[\s\S]*or move money/u);
    expect(response.body).toContain('TeleBirr five-Player pilot');
    expect(response.body).toContain('25 ETB maximum per deposit and Player');
    expect(response.body).toContain('Emergency stop');
    expect(response.body).toContain('Dry-run deposit intake');
    expect(response.body).toContain('Private KemerBet sign-in');
    expect(response.body).toContain('Transfer is blocked');
    expect(response.body).toContain('survives page');
    expect(response.body).toMatch(/retained\s+for up to twelve hours/u);
    expect(response.body).toContain('including across Owner-page re-authentication');
    expect(response.body).toContain('id="kemerbet-session-confirmation"');
    expect(response.body).toContain(
      'I approve opening a ten-minute private KemerBet sign-in browser.',
    );
    expect(response.body).not.toContain('sb_publishable_');
    await app.close();
  });

  it('returns only public staging Auth configuration to the private page', async () => {
    const app = buildOwnerControlApp(config(), { runtime: runtime() });
    const response = await app.inject({ method: 'GET', url: '/owner/config.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      publishableKey: 'sb_publishable_test_key_for_staging_only',
      supabaseUrl: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
    });
    expect(response.body).not.toContain('password');
    await app.close();
  });

  it('restores a rotating twelve-hour Owner session after a same-tab reload', async () => {
    const app = buildOwnerControlApp(config(), { runtime: runtime() });
    const response = await app.inject({ method: 'GET', url: '/owner/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('/auth/v1/token?grant_type=password');
    expect(response.body).toContain('/auth/v1/token?grant_type=refresh_token');
    expect(response.body).toContain('/auth/v1/logout?scope=local');
    expect(response.body).toContain("credentials: 'omit'");
    expect(response.body).toContain("authorization: 'Bearer ' + accessToken");
    expect(response.body).not.toMatch(/localStorage|document\.cookie|indexedDB/u);
    expect(response.body).toContain(
      "const OWNER_SESSION_STORAGE_KEY = 'fetanagent.owner.session.v1'",
    );
    expect(response.body).toContain('window.sessionStorage.setItem(');
    expect(response.body).toContain('window.sessionStorage.getItem(OWNER_SESSION_STORAGE_KEY)');
    expect(response.body).toContain('window.sessionStorage.removeItem(OWNER_SESSION_STORAGE_KEY)');
    expect(response.body).toContain(
      'JSON.stringify({ expiresAt: ownerSessionExpiresAt, refreshToken })',
    );
    expect(response.body).toContain('void restoreOwnerSession()');
    expect(response.body).toContain('Owner session restored after reload.');
    expect(response.body).toContain('const OWNER_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000');
    expect(response.body).toContain('const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1_000');
    expect(response.body).toContain('body: JSON.stringify({ refresh_token: refreshToken })');
    expect(response.body).toContain('value.refresh_token.length < 12');
    expect(response.body).not.toContain('value.refresh_token.length < 20');
    expect(response.body).toContain('Supabase accepted sign-in but returned an unusable session.');
    expect(response.body).toContain('async function loadOwnerDashboardAfterAuthentication(');
    expect(response.body).toContain(
      'Owner authentication succeeded, but dashboard data is temporarily unavailable.',
    );
    expect(response.body).toContain('Your session remains active; select Refresh to retry.');
    expect(response.body).toMatch(
      /signOut\(failureNotice\);\s*return;\s*\} finally \{\s*setBusy\(loginForm, false\);\s*\}\s*await loadOwnerDashboardAfterAuthentication\(/u,
    );
    expect(response.body).toMatch(
      /signOut\('Your saved Owner session could not be restored\. Sign in again to continue\.'\);\s*return;\s*\} finally \{\s*setBusy\(loginForm, false\);\s*\}\s*await loadOwnerDashboardAfterAuthentication\('Owner session restored after reload\.'\);/u,
    );
    expect(response.body).not.toMatch(
      /setNotice\('Signed in\.[^']*'\);\s*await loadOwnerPlayerQueues\(\);/u,
    );
    expect(response.body).not.toMatch(
      /setNotice\('Owner session restored after reload\.'\);\s*await loadOwnerPlayerQueues\(\);/u,
    );
    expect(response.body).toContain(
      'ownerSessionExpiresAt = currentTime + OWNER_SESSION_LIFETIME_MS',
    );
    expect(response.body).toContain('Your twelve-hour Owner session ended.');
    expect(response.body).toContain('refreshToken = undefined');
    expect(response.body).not.toContain('service_role');
    expect(response.body).toContain('/v1/owner/player-registration-requests?limit=25');
    expect(response.body).toContain(
      '/v1/owner/player-registration-association-candidates?limit=25',
    );
    expect(response.body).toContain('/v1/owner/dry-run-deposit-intake?limit=25');
    expect(response.body).toContain('/v1/owner/dry-run-fixture-assessments?limit=50');
    expect(response.body).toContain('/v1/owner/player-deposit-eligibility?limit=50');
    expect(response.body).toContain('/v1/owner/private-live-deposit-pilots/current');
    expect(response.body).toContain('/v1/owner/receiver-accounts');
    expect(response.body).toContain('/v1/owner/kemerbet-agent-profiles');
    expect(response.body).toContain('owner_confirmed_receiver_rotation');
    expect(response.body).toContain("'x-fetanagent-owner-csrf': 'owner-receiver-rotation-v1'");
    expect(response.body).toContain('owner_confirmed_kemerbet_agent_profile');
    expect(response.body).toContain("'x-fetanagent-owner-csrf': 'owner-kemerbet-agent-profile-v1'");
    expect(response.body).toContain('/v1/owner/kemerbet-session/start');
    expect(response.body).toContain('/v1/owner/kemerbet-session/frame?generation=');
    expect(response.body).toContain('/v1/owner/kemerbet-session/input');
    expect(response.body).toContain('/v1/owner/kemerbet-session/stop');
    expect(response.body).toContain("'x-fetanagent-owner-csrf': 'owner-kemerbet-session-v1'");
    expect(response.body).toContain('owner_confirmed_private_kemerbet_sign_in');
    expect(response.body).toContain("'unclean_session_generation'");
    expect(response.body).toContain("'browser_cleanup_unverified'");
    expect(response.body).toContain("'profile_integrity_unverified'");
    expect(response.body).toContain("'recheck_authorization_spent_failed_terminal'");
    expect(response.body).toContain("'security_recovery_cohort_required'");
    expect(response.body).toContain("'security_recovery_in_progress'");
    expect(response.body).toContain('terminally failed');
    expect(response.body).toContain('It is non-retryable.');
    expect(response.body).toContain('function requireKemerbetReadinessCohortMutation()');
    expect(response.body).toContain("value.phase !== 'idle'");
    expect(response.body).toContain("kemerbetAgentProfileReason.value = 'security_recovery'");
    expect(response.body).toContain(
      'Security recovery must retire it before another private sign-in.',
    );
    expect(response.body).toContain('kemerbetSessionConfirmation.disabled = recoveryRequired');
    expect(response.body).toContain(
      'currentKemerbetSession?.quarantine?.recoveryRequired === true',
    );
    expect(response.body).toContain('const baseDelay = recoveryRequired ? 15000');
    expect(response.body).toContain('Status-only recovery checks continue automatically.');
    expect(response.body).toContain('let kemerbetSecurityRecoveryRequired = false');
    expect(response.body).toContain('function applyKemerbetQuarantineMutationBoundary()');
    expect(response.body).toContain("failure.error === 'kemerbet_security_recovery_required'");
    expect(response.body).toContain('kemerbetSecurityRecoveryRequired = true');
    expect(response.body).toContain(
      'document.querySelectorAll(\'[data-kemerbet-state-mutation="ordinary"]\')',
    );
    expect(
      response.body.match(/requireOrdinaryKemerbetMutation\(\)/gu)?.length,
    ).toBeGreaterThanOrEqual(11);
    expect(response.body).toContain(
      "(configurationReason === 'security_recovery') !== recoveryRequired",
    );
    expect(response.body).toMatch(
      /await loadKemerbetAgentProfiles\(\);[\s\S]*await Promise\.all\(\[/u,
    );
    expect(response.body).not.toContain('kemerbetAgentProfileForm.requestSubmit');
    expect(response.body).toContain('response.status !== 202');
    expect(response.body).toContain('kemerbetSessionReconnectNeeded = true');
    expect(response.body).toContain('displayedKemerbetFrameSequence');
    expect(response.body).toContain('KEMERBET_TEXT_BATCH_DELAY_MS = 180');
    expect(response.body).toContain("queueKemerbetSessionInput({ kind: 'text', text })");
    expect(response.body).toContain('flushKemerbetPendingText();');
    expect(response.body).not.toContain('imageBase64');
    expect(response.body).toContain('!kemerbetSessionConfirmation.checked');
    expect(response.body).toContain('kemerbetSessionStatus.textContent = startingMessage');
    expect(response.body).toContain('kemerbetSessionStatus.textContent = failureMessage');
    expect(response.body).toContain('if (currentKemerbetSession?.active)');
    expect(response.body).toContain('The private KemerBet sign-in browser is already open.');
    expect(response.body).toContain('KemerBet is already signed in.');
    expect(response.body).toContain('Please try once more; if it still fails, contact support.');
    expect(response.body).not.toContain(
      "window.confirm(\n    'Start a ten-minute private KemerBet sign-in browser?",
    );
    expect(response.body).toContain('owner_confirmed_stop_private_kemerbet_session');
    expect(response.body).toContain('createImageBitmap');
    expect(response.body).toContain('KemerBet signed in and retained until');
    expect(response.body).toContain(
      'The authenticated session is retained and preview input is locked.',
    );
    expect(response.body).toContain('owner_confirmed_fixed_telebirr_five_player_pilot');
    expect(response.body).toContain('owner_confirmed_emergency_stop');
    expect(response.body).toContain("'x-fetanagent-owner-csrf': 'private-live-pilot-v1'");
    expect(response.body).toContain('Run advisory fixture');
    expect(response.body).toContain('does not verify, approve, credit, or execute a payment');
    expect(response.body).toContain("reviewButton('Found on KemerBet'");
    expect(response.body).toContain('Confirm ownership only');
    expect(response.body).toContain('does not grant deposit eligibility');
    expect(response.body).not.toContain('enable deposit intake');
    expect(response.body).toContain('Approve deposit eligibility');
    expect(response.body).toContain('Revoke deposit eligibility');
    expect(response.body).not.toContain('innerHTML');
    expect(response.body).toContain("url.pathname !== '/fetanagentbot'");
    expect(response.body).not.toContain('/FetanAgentBot');
    expect(() => new Function(OWNER_DASHBOARD_JAVASCRIPT)).not.toThrow();
    await app.close();
  });

  it('serves an aggregate-only one-use KemerBet readiness-cohort control', async () => {
    const app = buildOwnerControlApp(config(), { runtime: runtime() });
    const [page, script] = await Promise.all([
      app.inject({ method: 'GET', url: '/owner' }),
      app.inject({ method: 'GET', url: '/owner/app.js' }),
    ]);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('KemerBet readiness cohort');
    expect(page.body).toContain('id="kemerbet-readiness-cohort-button"');
    expect(page.body).toContain('The browser sends no Player identifiers, amount, or digest');
    expect(script.statusCode).toBe(200);
    expect(script.body).toContain('/v1/owner/kemerbet-readiness-cohort/prepare');
    expect(script.body).toContain(
      "'x-fetanagent-owner-csrf': 'owner-kemerbet-readiness-cohort-v1'",
    );
    expect(script.body).toContain(
      "confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer'",
    );
    expect(script.body).toContain("currentPilot?.pilotStatus === 'draft'");
    expect(script.body).toContain("currentPilot?.pilotStatus === 'armed'");
    expect(script.body).toContain('!currentPilotLoaded || hasOpenPilot');
    expect(script.body).toContain("failure?.error === 'readiness_cohort_open_pilot'");
    expect(script.body).toContain('Date.parse(pilot.expiresAt) <= Date.now()');
    expect(script.body).toContain(
      'Stop that pilot below before preparing the one-use KemerBet readiness',
    );
    const handler = script.body.slice(
      script.body.indexOf('async function prepareKemerbetReadinessCohort()'),
      script.body.indexOf('function pilotMutationHeaders(requestId)'),
    );
    expect(handler).toContain('body: JSON.stringify({');
    expect(handler).not.toMatch(/playerIds|playerId\b|configurationDigest|amountMinor/u);
    expect(handler).toContain('validKemerbetReadinessCohortReceipt');
    expect(script.body).toContain(
      "'alreadyPrepared,identifiersRedacted,moneyMoved,playersPrepared,transferDisabled'",
    );
    expect(() => new Function(script.body)).not.toThrow();
    await app.close();
  });

  it('rejects an expiry without the database clock and transport margin', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: async () => {
        throw new Error('authentication must not run');
      },
      runtime: runtime(),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/telegram-beta-invites',
      payload: { expiresInSeconds: 300 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    await app.close();
  });

  it('verifies the bearer token and returns a no-store one-time invite receipt', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      now: () => new Date('2026-08-10T12:00:00.000Z'),
      runtime: runtime(),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/telegram-beta-invites',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      payload: { expiresInSeconds: 86_400 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store, max-age=0');
    expect(response.json()).toMatchObject({ inviteId });
    await app.close();
  });

  it('returns generic forbidden when the verified user is not an active Owner', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        invites: {
          issue: async () => {
            throw new OwnerInviteRejectedError();
          },
          revoke: async () => undefined,
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/telegram-beta-invites',
      headers: { authorization: `Bearer ${bearer}` },
      payload: { expiresInSeconds: 3_600 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    await app.close();
  });

  it('revokes by opaque invite id and allowlisted reason', async () => {
    let revoked: readonly string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        invites: {
          issue: async () => {
            throw new Error('not called');
          },
          revoke: async (actor, id, reason) => {
            revoked = [actor, id, reason];
          },
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/owner/telegram-beta-invites/${inviteId}/revoke`,
      headers: { authorization: `Bearer ${bearer}` },
      payload: { reasonCode: 'owner_cancelled' },
    });
    expect(response.statusCode).toBe(204);
    expect(revoked).toEqual([authUserId, inviteId, 'owner_cancelled']);
    await app.close();
  });

  it('returns a bounded authenticated KemerBet Player-ID review queue', async () => {
    let observed: readonly (number | string)[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        playerRegistrations: {
          associate: async () => {
            throw new Error('not called');
          },
          list: async (actor, limit) => {
            observed = [actor, limit ?? -1];
            return [
              {
                createdAt: '2026-08-11T12:00:00.000Z',
                playerId: 'STAGING-TEST-20260811-01',
                platformCode: 'kemerbet',
                requestId: inviteId,
                status: 'pending_validation',
                updatedAt: '2026-08-11T12:00:00.000Z',
              },
            ];
          },
          listAssociationCandidates: async () => [],
          review: async () => {
            throw new Error('not called');
          },
        },
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/owner/player-registration-requests?limit=20',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      requests: [{ playerId: 'STAGING-TEST-20260811-01', status: 'pending_validation' }],
    });
    expect(observed).toEqual([authUserId, 20]);
    await app.close();
  });

  it('records only an allowlisted non-claiming review decision', async () => {
    let observed: readonly string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        playerRegistrations: {
          associate: async () => {
            throw new Error('not called');
          },
          list: async () => [],
          listAssociationCandidates: async () => [],
          review: async (actor, id, decision) => {
            observed = [actor, id, decision];
            return {
              alreadyRecorded: false,
              requestId: id,
              reviewedAt: '2026-08-11T12:10:00.000Z',
              status: decision,
            };
          },
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/owner/player-registration-requests/${inviteId}/review`,
      headers: { authorization: `Bearer ${bearer}` },
      payload: { decision: 'review_required' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ requestId: inviteId, status: 'review_required' });
    expect(observed).toEqual([authUserId, inviteId, 'review_required']);
    await app.close();
  });

  it('returns a bounded authenticated dry-run deposit projection', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        deposits: {
          list: async (actor, limit) => {
            expect([actor, limit]).toEqual([authUserId, 20]);
            return [
              {
                amountMinor: '2500',
                currencyCode: 'ETB',
                depositIntentId: inviteId,
                depositStatus: 'intake_received',
                openedAt: '2026-08-12T10:00:00.000Z',
                paymentDeadline: '2026-08-12T11:00:00.000Z',
                playerId: '28379330',
                providerCode: 'cbe_birr',
                receiverAccountMasked: '****1234',
                submissionStatus: 'received',
                submittedAt: '2026-08-12T10:05:00.000Z',
                submittedReferenceMasked: '***A1B2',
              },
            ];
          },
        },
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/owner/dry-run-deposit-intake?limit=20',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deposits: [{ playerId: '28379330', submittedReferenceMasked: '***A1B2' }],
    });
    expect(response.body).not.toContain('ciphertext');
    await app.close();
  });

  it('records and reviews only an advisory redacted fixture result', async () => {
    const depositIntentId = '55555555-5555-4555-8555-555555555555';
    const assessmentId = '44444444-4444-4444-8444-444444444444';
    let observedReview: readonly string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      now: () => new Date('2026-08-13T10:00:00.000Z'),
      runtime: runtime({
        deposits: {
          list: async () => [
            {
              amountMinor: '2500',
              currencyCode: 'ETB',
              depositIntentId,
              depositStatus: 'intake_received',
              openedAt: '2026-08-09T10:00:00.000Z',
              paymentDeadline: '2026-08-09T11:00:00.000Z',
              playerId: '28379330',
              providerCode: 'cbe_birr',
              receiverAccountMasked: '****1234',
              submissionStatus: 'received',
              submittedAt: '2026-08-09T10:05:00.000Z',
              submittedReferenceMasked: '***7890',
            },
          ],
        },
        assessments: {
          assess: async (_actor, deposit, fixtureId) => ({
            alreadyRecorded: false,
            assessedAt: '2026-08-13T10:00:00.000Z',
            assessmentId,
            depositIntentId: deposit.depositIntentId,
            fixtureId: fixtureId as 'pending-status',
            outcome: 'would_review',
            reasonCode: 'fixture_status_pending',
          }),
          list: async () => [],
          review: async (actor, id, decision) => {
            observedReview = [actor, id, decision];
            return {
              alreadyRecorded: false,
              assessmentId: id,
              decision,
              reviewedAt: '2026-08-13T10:01:00.000Z',
            };
          },
        },
      }),
    });
    const assessmentResponse = await app.inject({
      method: 'POST',
      url: `/v1/owner/dry-run-deposit-intake/${depositIntentId}/fixture-assessments`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      payload: { fixtureId: 'pending-status' },
    });
    expect(assessmentResponse.statusCode).toBe(201);
    expect(assessmentResponse.json()).toMatchObject({
      outcome: 'would_review',
      reasonCode: 'fixture_status_pending',
    });

    const reviewResponse = await app.inject({
      method: 'POST',
      url: `/v1/owner/dry-run-fixture-assessments/${assessmentId}/review`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      payload: { decision: 'manual_review_required' },
    });
    expect(reviewResponse.statusCode).toBe(200);
    expect(observedReview).toEqual([authUserId, assessmentId, 'manual_review_required']);
    await app.close();
  });

  it('lists and explicitly associates a reviewed KemerBet Player ID', async () => {
    let associated: readonly string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        playerRegistrations: {
          associate: async (actor, id) => {
            associated = [actor, id];
            return {
              alreadyRecorded: false,
              associatedAt: '2026-08-11T12:15:00.000Z',
              playerAccountId: '33333333-3333-4333-8333-333333333333',
              requestId: id,
            };
          },
          list: async () => [],
          listAssociationCandidates: async () => [
            {
              playerId: '28379330',
              platformCode: 'kemerbet',
              requestId: inviteId,
              reviewedAt: '2026-08-11T12:10:00.000Z',
            },
          ],
          review: async () => {
            throw new Error('not called');
          },
        },
      }),
    });
    const listResponse = await app.inject({
      method: 'GET',
      url: '/v1/owner/player-registration-association-candidates?limit=25',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({ candidates: [{ playerId: '28379330' }] });
    const associateResponse = await app.inject({
      method: 'POST',
      url: `/v1/owner/player-registration-requests/${inviteId}/associate`,
      headers: { authorization: `Bearer ${bearer}` },
      payload: { confirmation: 'owner_verified_platform_ownership' },
    });
    expect(associateResponse.statusCode).toBe(200);
    expect(associated).toEqual([authUserId, inviteId]);
    await app.close();
  });

  it('lists and explicitly decides deposit eligibility without starting a financial action', async () => {
    const playerAccountId = '33333333-3333-4333-8333-333333333333';
    let observedDecision: readonly string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        eligibility: {
          list: async (actor, limit) => {
            expect([actor, limit]).toEqual([authUserId, 50]);
            return [
              {
                playerAccountId,
                playerId: '28379330',
                playerStatus: 'active',
                platformCode: 'kemerbet',
                validationStatus: 'valid',
              },
            ];
          },
          decide: async (actor, id, decision) => {
            observedDecision = [actor, id, decision];
            return {
              alreadyRecorded: false,
              decidedAt: '2026-08-19T16:30:00.000Z',
              decision,
              decisionId: '44444444-4444-4444-8444-444444444444',
              decisionVersion: 1,
              playerAccountId: id,
              reasonCode: 'financial_eligibility_approved',
            };
          },
        },
      }),
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/v1/owner/player-deposit-eligibility?limit=50',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({ players: [{ playerId: '28379330' }] });

    const decideResponse = await app.inject({
      method: 'POST',
      url: `/v1/owner/player-deposit-eligibility/${playerAccountId}/decide`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      payload: {
        confirmation: 'owner_confirmed_financial_eligibility',
        decision: 'eligible',
      },
    });
    expect(decideResponse.statusCode).toBe(200);
    expect(observedDecision).toEqual([authUserId, playerAccountId, 'eligible']);
    await app.close();
  });

  it('rejects a mismatched deposit-eligibility confirmation before authentication', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: async () => {
        throw new Error('authentication must not run');
      },
      runtime: runtime(),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/player-deposit-eligibility/33333333-3333-4333-8333-333333333333/decide',
      payload: {
        confirmation: 'owner_confirmed_financial_revocation',
        decision: 'eligible',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    await app.close();
  });

  it.each([
    [false, 201],
    [true, 200],
  ] as const)(
    'prepares the current five-Player readiness cohort with an aggregate-only receipt (replay %s)',
    async (alreadyPrepared, expectedStatus) => {
      let observedRequestId: string | undefined;
      let observedClaimRequest: readonly string[] | undefined;
      let observedExport: readonly string[] | undefined;
      const control: OwnerKemerbetReadinessCohortControl = {
        completed: async () => false,
        rootReceipt: async () => undefined,
        prepare: async (players, requestId) => {
          expect(players).toEqual(readinessEligiblePlayers());
          observedRequestId = requestId;
          return {
            alreadyPrepared,
            identifiersRedacted: true,
            moneyMoved: false,
            playersPrepared: 5,
            transferDisabled: true,
          };
        },
      };
      const app = buildOwnerControlApp(config(), {
        fetch: verifiedAuthFetch(),
        kemerbetReadinessCohortControl: control,
        runtime: runtime({
          kemerbetReadinessCohorts: {
            claim: async (actor, requestId) => {
              observedClaimRequest = [actor, requestId];
              return {
                alreadyClaimed: false,
                claimId: '88888888-8888-4888-8888-888888888888',
                players: readinessEligiblePlayers(),
                state: 'prepared',
              };
            },
            markExported: async (actor, requestId, claimId) => {
              observedExport = [actor, requestId, claimId];
              return {
                alreadyRecorded: false,
                claimId,
                state: 'exported',
                transitionedAt: '2026-08-25T09:05:00.000Z',
              };
            },
            recordRootReceipt: async () => {
              throw new Error('root receipt must not run');
            },
          },
        }),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-readiness-cohort/prepare',
        headers: kemerbetReadinessCohortMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
          requestId: pilotRequestId,
        },
      });

      expect(response.statusCode).toBe(expectedStatus);
      expect(observedRequestId).toBe(pilotRequestId);
      expect(observedClaimRequest).toEqual([authUserId, pilotRequestId]);
      expect(observedExport).toEqual([
        authUserId,
        pilotRequestId,
        '88888888-8888-4888-8888-888888888888',
      ]);
      expect(response.json()).toEqual({
        alreadyPrepared,
        identifiersRedacted: true,
        moneyMoved: false,
        playersPrepared: 5,
        transferDisabled: true,
      });
      expect(response.body).not.toContain('PLAYER_');
      expect(response.body).not.toContain('sha256:');
      await app.close();
    },
  );

  it('reports an expired open pilot before creating or staging a readiness claim', async () => {
    const events: string[] = [];
    const defaultPrivateLivePilot = runtime().privateLivePilot;
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetReadinessCohortControl: {
        completed: async () => {
          throw new Error('completion probe must not run');
        },
        prepare: async () => {
          throw new Error('cohort staging must not run');
        },
        rootReceipt: async () => {
          events.push('root-receipt');
          return undefined;
        },
      },
      runtime: runtime({
        kemerbetReadinessCohorts: {
          claim: async () => {
            throw new Error('readiness claim must not run');
          },
          markExported: async () => {
            throw new Error('export must not run');
          },
          recordRootReceipt: async () => {
            throw new Error('root receipt persistence must not run');
          },
        },
        privateLivePilot: {
          ...defaultPrivateLivePilot,
          current: async () =>
            pilotStatus({
              expiresAt: '2026-08-22T23:50:06.000Z',
              pilotStatus: 'draft',
              withinActiveWindow: false,
            }),
        },
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-readiness-cohort/prepare',
      headers: kemerbetReadinessCohortMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
        requestId: pilotRequestId,
      },
    });

    expect(events).toEqual(['root-receipt', 'root-receipt']);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'readiness_cohort_open_pilot' });
    expect(response.body).not.toContain(pilotRevisionId);
    expect(response.body).not.toContain('PLAYER_');
    await app.close();
  });

  it('fails closed when the private-pilot preflight is unavailable', async () => {
    const defaultPrivateLivePilot = runtime().privateLivePilot;
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetReadinessCohortControl: {
        completed: async () => {
          throw new Error('completion probe must not run');
        },
        prepare: async () => {
          throw new Error('cohort staging must not run');
        },
        rootReceipt: async () => undefined,
      },
      runtime: runtime({
        kemerbetReadinessCohorts: {
          claim: async () => {
            throw new Error('readiness claim must not run');
          },
          markExported: async () => {
            throw new Error('export must not run');
          },
          recordRootReceipt: async () => {
            throw new Error('root receipt persistence must not run');
          },
        },
        privateLivePilot: {
          ...defaultPrivateLivePilot,
          current: async () => {
            throw new OwnerPrivateLivePilotUnavailableError();
          },
        },
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-readiness-cohort/prepare',
      headers: kemerbetReadinessCohortMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
        requestId: pilotRequestId,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'owner_control_unavailable' });
    expect(response.body).not.toContain('PLAYER_');
    await app.close();
  });

  it.each([
    ['imported', 'imported'],
    ['completed', 'succeeded'],
  ] as const)(
    'handles an exact root %s receipt before reusing the %s DB claim',
    async (event, claimState) => {
      const order: string[] = [];
      let observedReceipt: readonly string[] | undefined;
      const claimId = '88888888-8888-4888-8888-888888888888';
      const app = buildOwnerControlApp(config(), {
        fetch: verifiedAuthFetch(),
        kemerbetReadinessCohortControl: {
          completed: async () => {
            throw new Error('legacy completion probe must not run');
          },
          prepare: async () => {
            throw new Error('the consumed one-use input must not be restaged');
          },
          rootReceipt: async () => {
            order.push('root-receipt');
            return { claimId, event };
          },
        },
        runtime: runtime({
          kemerbetReadinessCohorts: {
            claim: async () => {
              order.push('claim');
              return {
                alreadyClaimed: true,
                claimId,
                players: readinessEligiblePlayers(),
                state: claimState,
              };
            },
            markExported: async () => {
              throw new Error('export must not repeat after root import');
            },
            recordRootReceipt: async (recordedClaimId, receiptId, recordedEvent) => {
              order.push('record-root-receipt');
              observedReceipt = [recordedClaimId, receiptId, recordedEvent];
              return {
                alreadyRecorded: false,
                claimId: recordedClaimId,
                event: recordedEvent,
                receiptId,
                state: recordedEvent === 'completed' ? 'succeeded' : 'imported',
                recordedAt: '2026-08-25T09:10:00.000Z',
              };
            },
          },
        }),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-readiness-cohort/prepare',
        headers: kemerbetReadinessCohortMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
          requestId: pilotRequestId,
        },
      });

      if (event === 'imported') {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: 'kemerbet_security_recovery_required' });
        expect(order).toEqual(['root-receipt']);
        expect(observedReceipt).toBeUndefined();
        await app.close();
        return;
      }
      expect(response.statusCode).toBe(200);
      expect(order).toEqual(['root-receipt', 'root-receipt', 'record-root-receipt', 'claim']);
      expect(observedReceipt?.[0]).toBe(claimId);
      expect(observedReceipt?.[1]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(observedReceipt?.[2]).toBe(event);
      expect(response.json()).toEqual({
        alreadyPrepared: true,
        identifiersRedacted: true,
        moneyMoved: false,
        playersPrepared: 5,
        transferDisabled: true,
      });
      expect(response.body).not.toContain(claimId);
      expect(response.body).not.toContain('PLAYER_');
      await app.close();
    },
  );

  it('rejects readiness-cohort identifier fields before authentication', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: async () => {
        throw new Error('authentication must not run');
      },
      kemerbetReadinessCohortControl: {
        completed: async () => {
          throw new Error('cohort control must not run');
        },
        rootReceipt: async () => {
          throw new Error('cohort control must not run');
        },
        prepare: async () => {
          throw new Error('cohort control must not run');
        },
      },
      runtime: runtime(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-readiness-cohort/prepare',
      headers: kemerbetReadinessCohortMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
        playerIds: ['PLAYER_1'],
        requestId: pilotRequestId,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    await app.close();
  });

  it.each([
    ['invalid CSRF header', { 'x-fetanagent-owner-csrf': 'wrong-boundary' }],
    ['mismatched idempotency header', { 'x-idempotency-key': inviteId }],
  ])('rejects %s before authentication', async (_label, override) => {
    const app = buildOwnerControlApp(config(), {
      fetch: async () => {
        throw new Error('authentication must not run');
      },
      kemerbetReadinessCohortControl: {
        completed: async () => {
          throw new Error('cohort control must not run');
        },
        rootReceipt: async () => {
          throw new Error('cohort control must not run');
        },
        prepare: async () => {
          throw new Error('cohort control must not run');
        },
      },
      runtime: runtime(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-readiness-cohort/prepare',
      headers: { ...kemerbetReadinessCohortMutationHeaders(), ...override },
      payload: {
        confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
        requestId: pilotRequestId,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    await app.close();
  });

  it('maps a rejected readiness cohort to a fixed conflict without exposing identifiers', async () => {
    const control: OwnerKemerbetReadinessCohortControl = {
      completed: async () => false,
      rootReceipt: async () => undefined,
      prepare: async () => {
        throw new OwnerKemerbetReadinessCohortRejectedError();
      },
    };
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetReadinessCohortControl: control,
      runtime: runtime({
        eligibility: {
          decide: async () => {
            throw new Error('decision must not run');
          },
          list: async () => readinessEligiblePlayers(),
        },
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-readiness-cohort/prepare',
      headers: kemerbetReadinessCohortMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
        requestId: pilotRequestId,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'readiness_cohort_not_ready' });
    expect(response.body).not.toContain('PLAYER_');
    await app.close();
  });

  it('refuses a non-fixed readiness receipt without leaking injected fields', async () => {
    const injectedPlayerId = 'DO_NOT_RETURN_PLAYER';
    const control: OwnerKemerbetReadinessCohortControl = {
      completed: async () => false,
      rootReceipt: async () => undefined,
      prepare: async () =>
        ({
          alreadyPrepared: false,
          identifiersRedacted: true,
          moneyMoved: false,
          playerIds: [injectedPlayerId],
          playersPrepared: 5,
          transferDisabled: true,
        }) as OwnerKemerbetReadinessCohortReceipt,
    };
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetReadinessCohortControl: control,
      runtime: runtime({
        eligibility: {
          decide: async () => {
            throw new Error('decision must not run');
          },
          list: async () => readinessEligiblePlayers(),
        },
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-readiness-cohort/prepare',
      headers: kemerbetReadinessCohortMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
        requestId: pilotRequestId,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'owner_control_unavailable' });
    expect(response.body).not.toContain(injectedPlayerId);
    await app.close();
  });

  it('rejects arbitrary Player-ID review notes and decisions before authentication', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: async () => {
        throw new Error('authentication must not run');
      },
      runtime: runtime(),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/owner/player-registration-requests/${inviteId}/review`,
      payload: { decision: 'validated', note: 'raw evidence' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    await app.close();
  });

  it('lists only masked receiver history and rotates an exact Owner-confirmed account', async () => {
    let observed: unknown;
    const receiver = {
      accountHolderName: 'FetanAgent Receiver',
      accountReferenceMasked: '***3456',
      activeFrom: '2026-08-22T13:30:00.000Z',
      protectedReference: true,
      providerCode: 'telebirr' as const,
      providerDisplayName: 'TeleBirr',
      receiverRevisionId: '66666666-6666-4666-8666-666666666666',
      receiverStatus: 'active' as const,
      revision: 2,
      rotationReason: 'account_rotation' as const,
    };
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        receivers: {
          list: async (actor) => {
            expect(actor).toBe(authUserId);
            return [receiver];
          },
          rotate: async (actor, request) => {
            expect(actor).toBe(authUserId);
            observed = request;
            return receiver;
          },
        },
      }),
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/owner/receiver-accounts',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ receivers: [receiver] });
    expect(listed.body).not.toContain('0000003456');

    const rotated = await app.inject({
      method: 'POST',
      url: '/v1/owner/receiver-accounts/rotate',
      headers: receiverMutationHeaders(),
      payload: {
        accountHolderName: 'FetanAgent Receiver',
        accountReference: '0000003456',
        confirmation: 'owner_confirmed_receiver_rotation',
        providerCode: 'telebirr',
        requestId: pilotRequestId,
        rotationReason: 'account_rotation',
      },
    });
    expect(rotated.statusCode).toBe(201);
    expect(observed).toEqual({
      accountHolderName: 'FetanAgent Receiver',
      accountReference: '0000003456',
      providerCode: 'telebirr',
      requestId: pilotRequestId,
      rotationReason: 'account_rotation',
    });
    expect(rotated.json()).toEqual({ receiver });
    expect(rotated.body).not.toContain('0000003456');
    await app.close();
  });

  it('rejects malformed receiver, cross-origin, and extra-field requests before authentication', async () => {
    let authenticationCalls = 0;
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        throw new Error('authentication must not run');
      }) as typeof fetch,
      runtime: runtime(),
    });
    const base = {
      accountHolderName: 'FetanAgent Receiver',
      accountReference: '0000003456',
      confirmation: 'owner_confirmed_receiver_rotation',
      providerCode: 'telebirr',
      requestId: pilotRequestId,
      rotationReason: 'account_rotation',
    };
    for (const candidate of [
      {
        payload: { ...base, accountReference: '+0000003456' },
        headers: receiverMutationHeaders(),
      },
      { payload: { ...base, amount: 25 }, headers: receiverMutationHeaders() },
      { payload: base, headers: { ...receiverMutationHeaders(), origin: 'https://evil.example' } },
      {
        payload: base,
        headers: {
          ...receiverMutationHeaders(),
          'x-fetanagent-owner-csrf': 'private-live-pilot-v1',
        },
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/owner/receiver-accounts/rotate',
        headers: candidate.headers,
        payload: candidate.payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(authenticationCalls).toBe(0);
    await app.close();
  });

  it('lists and prepares only a credential-free KemerBet agent profile', async () => {
    let observed: unknown;
    const profile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetSessionControl: {
        frame: async () => undefined,
        input: async () => inactiveKemerbetSession,
        start: async () => inactiveKemerbetSession,
        status: async (accountId) => {
          expect(accountId).toBe(profile.platformAgentAccountId);
          return inactiveKemerbetSession;
        },
        stop: async () => inactiveKemerbetSession,
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async (actor) => {
            expect(actor).toBe(authUserId);
            return [profile];
          },
          prepare: async (actor, request) => {
            expect(actor).toBe(authUserId);
            observed = request;
            return profile;
          },
        },
      }),
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/owner/kemerbet-agent-profiles',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ profiles: [profile] });

    const prepared = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-agent-profiles/prepare',
      headers: kemerbetAgentProfileMutationHeaders(),
      payload: {
        configurationReason: 'initial_configuration',
        confirmation: 'owner_confirmed_kemerbet_agent_profile',
        requestId: pilotRequestId,
      },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json()).toEqual({ profile });
    expect(observed).toEqual({
      configurationReason: 'initial_configuration',
      requestId: pilotRequestId,
    });
    expect(prepared.body).not.toMatch(/password|cookie|otp|credential/iu);
    await app.close();
  });

  it('requires the current profile session to be inactive before retiring that profile', async () => {
    let prepareCalls = 0;
    const profile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetSessionControl: {
        frame: async () => undefined,
        input: async () => activeKemerbetSession,
        start: async () => activeKemerbetSession,
        status: async (accountId) => {
          expect(accountId).toBe(profile.platformAgentAccountId);
          return activeKemerbetSession;
        },
        stop: async () => activeKemerbetSession,
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async () => [profile],
          prepare: async () => {
            prepareCalls += 1;
            return profile;
          },
        },
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-agent-profiles/prepare',
      headers: kemerbetAgentProfileMutationHeaders(),
      payload: {
        configurationReason: 'agent_rotation',
        confirmation: 'owner_confirmed_kemerbet_agent_profile',
        requestId: pilotRequestId,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'kemerbet_session_must_stop' });
    expect(prepareCalls).toBe(0);
    await app.close();
  });

  it.each(['staged', 'imported', 'retryable_failed'] as const)(
    'blocks ordinary profile mutation while the one-use readiness lifecycle is %s',
    async (lifecycle) => {
      const profile = {
        configuredAt: '2026-08-22T19:30:00.000Z',
        configurationReason: 'initial_configuration' as const,
        platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
        platformCode: 'kemerbet' as const,
        profileContractVersion: 1 as const,
        profileLabel: 'Primary KemerBet agent revision 1',
        profileRevision: 1,
        profileStatus: 'active' as const,
      };
      let prepareCalls = 0;
      let statusCalls = 0;
      const app = buildOwnerControlApp(config(), {
        fetch: verifiedAuthFetch(),
        kemerbetReadinessCohortControl: {
          completed: async () => false,
          lifecycle: async () => lifecycle,
          prepare: async () => {
            throw new Error('cohort preparation must not run');
          },
          rootReceipt: async () =>
            lifecycle === 'staged'
              ? undefined
              : {
                  claimId: '99999999-9999-4999-8999-999999999999',
                  event: lifecycle,
                },
        },
        kemerbetSessionControl: {
          frame: async () => undefined,
          input: async () => inactiveKemerbetSession,
          start: async () => inactiveKemerbetSession,
          status: async () => {
            statusCalls += 1;
            return inactiveKemerbetSession;
          },
          stop: async () => inactiveKemerbetSession,
        },
        runtime: runtime({
          kemerbetAgentProfiles: {
            list: async () => [profile],
            prepare: async () => {
              prepareCalls += 1;
              return profile;
            },
          },
        }),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-agent-profiles/prepare',
        headers: kemerbetAgentProfileMutationHeaders(),
        payload: {
          configurationReason: 'agent_rotation',
          confirmation: 'owner_confirmed_kemerbet_agent_profile',
          requestId: pilotRequestId,
        },
      });
      expect(response.statusCode).toBe(lifecycle === 'staged' ? 403 : 409);
      expect(prepareCalls).toBe(0);
      expect(statusCalls).toBe(0);
      await app.close();
    },
  );

  it('permits security recovery only for the exact terminal root marker and records the redacted DB acknowledgment', async () => {
    const profile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const recoveredProfile = {
      ...profile,
      configuredAt: '2026-08-28T15:00:00.000Z',
      configurationReason: 'security_recovery' as const,
      platformAgentAccountId: '88888888-8888-4888-8888-888888888888',
      profileLabel: 'Primary KemerBet agent revision 2',
      profileRevision: 2,
    };
    const claimId = '99999999-9999-4999-8999-999999999999';
    const canonicalReceiptId = '66666666-6666-4666-8666-666666666666';
    let recoverCalls = 0;
    const acknowledgments: unknown[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetReadinessCohortControl: {
        acknowledgeSecurityRecovery: async (acknowledgment) => {
          acknowledgments.push(acknowledgment);
          return {
            alreadyAcknowledged: false,
            identifiersRedacted: true,
            moneyMoved: false,
            transferDisabled: true,
          };
        },
        completed: async () => false,
        lifecycle: async () => 'security_recovery_failed_terminal',
        prepare: async () => {
          throw new Error('cohort preparation must not run');
        },
        rootReceipt: async () => ({
          claimId,
          event: 'security_recovery_failed_terminal',
        }),
      },
      kemerbetSessionControl: {
        frame: async () => undefined,
        input: async () => quarantinedKemerbetSession,
        start: async () => quarantinedKemerbetSession,
        status: async () => quarantinedKemerbetSession,
        stop: async () => quarantinedKemerbetSession,
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async () => [profile],
          prepare: async () => {
            throw new Error('plain profile preparation must not run');
          },
          recover: async (actor, request) => {
            expect(actor).toBe(authUserId);
            expect(request).toEqual({ claimId, receiptId: pilotRequestId });
            recoverCalls += 1;
            return {
              claimId,
              profile: recoveredProfile,
              receiptId: canonicalReceiptId,
              recordedAt: '2026-08-28T14:59:59.000Z',
            };
          },
        },
      }),
    });

    const ordinaryRotation = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-agent-profiles/prepare',
      headers: kemerbetAgentProfileMutationHeaders(),
      payload: {
        configurationReason: 'agent_rotation',
        confirmation: 'owner_confirmed_kemerbet_agent_profile',
        requestId: pilotRequestId,
      },
    });
    expect(ordinaryRotation.statusCode).toBe(409);
    expect(ordinaryRotation.json()).toEqual({ error: 'kemerbet_security_recovery_required' });
    expect(recoverCalls).toBe(0);

    const recovery = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-agent-profiles/prepare',
      headers: kemerbetAgentProfileMutationHeaders(),
      payload: {
        configurationReason: 'security_recovery',
        confirmation: 'owner_confirmed_kemerbet_agent_profile',
        requestId: pilotRequestId,
      },
    });
    expect(recovery.statusCode).toBe(201);
    expect(recovery.json()).toEqual({ profile: recoveredProfile });
    expect(recoverCalls).toBe(1);
    expect(acknowledgments).toEqual([
      {
        claimId,
        platformAgentAccountId: recoveredProfile.platformAgentAccountId,
        profileRevision: 2,
        receiptId: canonicalReceiptId,
      },
    ]);
    await app.close();
  });

  it('projects the exact recovery marker on status and blocks every session or cohort action while pending', async () => {
    const profile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const claimId = '99999999-9999-4999-8999-999999999999';
    const controlCalls: string[] = [];
    let readinessDatabaseCalls = 0;
    let pilotCalls = 0;
    const stateMutationCalls: string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetReadinessCohortControl: {
        completed: async () => false,
        prepare: async () => {
          controlCalls.push('prepare-cohort');
          throw new Error('cohort preparation must remain blocked');
        },
        rootReceipt: async () => ({
          claimId,
          event: 'security_recovery_failed_terminal',
        }),
      },
      kemerbetSessionControl: {
        frame: async () => {
          controlCalls.push('frame');
          throw new Error('frame must remain blocked');
        },
        input: async () => {
          controlCalls.push('input');
          throw new Error('input must remain blocked');
        },
        start: async () => {
          controlCalls.push('start');
          throw new Error('start must remain blocked');
        },
        status: async () => {
          controlCalls.push('status');
          throw new Error('socket status must not override the exact root marker');
        },
        stop: async () => {
          controlCalls.push('stop');
          throw new Error('stop must remain blocked');
        },
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async () => [profile],
          prepare: async () => {
            stateMutationCalls.push('profile-prepare');
            throw new Error('profile preparation must not run');
          },
        },
        kemerbetReadinessCohorts: {
          claim: async () => {
            readinessDatabaseCalls += 1;
            throw new Error('claim must remain blocked');
          },
          markExported: async () => {
            readinessDatabaseCalls += 1;
            throw new Error('export must remain blocked');
          },
          recordRootReceipt: async () => {
            readinessDatabaseCalls += 1;
            throw new Error('terminal receipt belongs only to atomic profile recovery');
          },
        },
        privateLivePilot: {
          ...runtime().privateLivePilot,
          arm: async () => {
            stateMutationCalls.push('pilot-arm');
            throw new Error('pilot arm must remain blocked');
          },
          current: async () => {
            pilotCalls += 1;
            return undefined;
          },
          prepare: async () => {
            stateMutationCalls.push('pilot-prepare');
            throw new Error('pilot preparation must remain blocked');
          },
          stop: async () => {
            stateMutationCalls.push('pilot-stop');
            throw new Error('pilot stop must remain blocked');
          },
        },
        eligibility: {
          ...runtime().eligibility,
          decide: async () => {
            stateMutationCalls.push('eligibility-decide');
            throw new Error('eligibility mutation must remain blocked');
          },
        },
        playerRegistrations: {
          ...runtime().playerRegistrations,
          associate: async () => {
            stateMutationCalls.push('player-associate');
            throw new Error('association mutation must remain blocked');
          },
          review: async () => {
            stateMutationCalls.push('player-review');
            throw new Error('review mutation must remain blocked');
          },
        },
        receivers: {
          ...runtime().receivers,
          rotate: async () => {
            stateMutationCalls.push('receiver-rotate');
            throw new Error('receiver mutation must remain blocked');
          },
        },
      }),
    });

    const status = await app.inject({
      method: 'GET',
      url: '/v1/owner/kemerbet-session',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      session: {
        active: false,
        loginRequired: false,
        phase: 'idle',
        quarantine: {
          reasonCode: 'profile_integrity_unverified',
          recoveryRequired: true,
        },
        signedIn: false,
        transferDisabled: true,
      },
    });

    const safeStatusReads = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/v1/owner/kemerbet-agent-profiles',
        headers: { authorization: `Bearer ${bearer}` },
      }),
      app.inject({
        method: 'GET',
        url: '/v1/owner/private-live-deposit-pilots/current',
        headers: { authorization: `Bearer ${bearer}` },
      }),
    ]);
    expect(safeStatusReads.map((response) => response.statusCode)).toEqual([200, 200]);

    const blocked = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/v1/owner/kemerbet-session/frame?generation=${pilotRequestId}&after=0`,
        headers: { authorization: `Bearer ${bearer}` },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/start',
        headers: kemerbetSessionMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_private_kemerbet_sign_in',
          requestId: pilotRequestId,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/input',
        headers: kemerbetSessionMutationHeaders(),
        payload: {
          frameSequence: 1,
          kind: 'pointer',
          requestId: pilotRequestId,
          sessionGeneration: pilotRequestId,
          x: 1,
          y: 1,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/stop',
        headers: kemerbetSessionMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_stop_private_kemerbet_session',
          requestId: pilotRequestId,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-readiness-cohort/prepare',
        headers: kemerbetReadinessCohortMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
          requestId: pilotRequestId,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/owner/player-registration-requests/${pilotRequestId}/review`,
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        payload: { decision: 'exists' },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/owner/player-registration-requests/${pilotRequestId}/associate`,
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        payload: { confirmation: 'owner_verified_platform_ownership' },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/owner/player-deposit-eligibility/${pilotRevisionId}/decide`,
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        payload: {
          confirmation: 'owner_confirmed_financial_eligibility',
          decision: 'eligible',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/receiver-accounts/rotate',
        headers: receiverMutationHeaders(),
        payload: {
          accountHolderName: 'Exact Receiver',
          accountReference: '0912345678',
          confirmation: 'owner_confirmed_receiver_rotation',
          providerCode: 'telebirr',
          requestId: pilotRequestId,
          rotationReason: 'owner_correction',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-agent-profiles/prepare',
        headers: kemerbetAgentProfileMutationHeaders(),
        payload: {
          configurationReason: 'agent_rotation',
          confirmation: 'owner_confirmed_kemerbet_agent_profile',
          requestId: pilotRequestId,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/private-live-deposit-pilots/prepare',
        headers: pilotMutationHeaders(),
        payload: {
          activeFrom: '2026-08-28T12:00:00.000Z',
          confirmation: 'owner_confirmed_fixed_telebirr_five_player_pilot',
          expiresAt: '2026-08-28T14:00:00.000Z',
          playerIds: ['PLAYER_1', 'PLAYER_2', 'PLAYER_3', 'PLAYER_4', 'PLAYER_5'],
          requestId: pilotRequestId,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/arm`,
        headers: pilotMutationHeaders(pilotRevisionId),
        payload: {
          confirmation: 'owner_confirmed_dry_run_only',
          requestId: pilotRevisionId,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/stop`,
        headers: pilotMutationHeaders(pilotRevisionId),
        payload: {
          confirmation: 'owner_confirmed_emergency_stop',
          reasonCode: 'execution_uncertainty',
          requestId: pilotRevisionId,
        },
      }),
    ]);
    for (const response of blocked) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: 'kemerbet_security_recovery_required' });
    }
    expect(controlCalls).toEqual([]);
    expect(readinessDatabaseCalls).toBe(0);
    expect(pilotCalls).toBe(1);
    expect(stateMutationCalls).toEqual([]);
    await app.close();
  });

  it('allows only exact cohort preparation while the recovered profile awaits durable cohort binding', async () => {
    const oldClaimId = '99999999-9999-4999-8999-999999999999';
    const newClaimId = '88888888-8888-4888-8888-888888888888';
    const calls: string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetReadinessCohortControl: {
        completed: async () => false,
        lifecycle: async () => 'security_recovery_profile_finalized',
        prepare: async (_players, requestId, claimId) => {
          calls.push(`stage:${requestId}:${claimId}`);
          return {
            alreadyPrepared: false,
            identifiersRedacted: true,
            moneyMoved: false,
            playersPrepared: 5,
            transferDisabled: true,
          };
        },
        rootReceipt: async () => ({
          claimId: oldClaimId,
          event: 'security_recovery_profile_finalized',
        }),
      },
      kemerbetSessionControl: {
        frame: async () => {
          calls.push('frame');
          return undefined;
        },
        input: async () => {
          calls.push('input');
          return inactiveKemerbetSession;
        },
        start: async () => {
          calls.push('start');
          return inactiveKemerbetSession;
        },
        status: async () => inactiveKemerbetSession,
        stop: async () => {
          calls.push('stop');
          return inactiveKemerbetSession;
        },
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async () => {
            calls.push('profiles');
            return [];
          },
          prepare: async () => {
            calls.push('profile-prepare');
            throw new Error('profile mutation must remain blocked');
          },
        },
        kemerbetReadinessCohorts: {
          claim: async (actor, requestId) => {
            expect(actor).toBe(authUserId);
            expect(requestId).toBe(pilotRequestId);
            calls.push('claim');
            return {
              alreadyClaimed: false,
              claimId: newClaimId,
              players: readinessEligiblePlayers(),
              state: 'prepared',
            };
          },
          markExported: async (actor, requestId, claimId) => {
            expect([actor, requestId, claimId]).toEqual([authUserId, pilotRequestId, newClaimId]);
            calls.push('export');
            return {
              alreadyRecorded: false,
              claimId,
              state: 'exported',
              transitionedAt: '2026-08-28T16:00:00.000Z',
            };
          },
          recordRootReceipt: async () => {
            calls.push('record-root-receipt');
            throw new Error('the phase latch is not a cohort result');
          },
        },
        privateLivePilot: {
          ...runtime().privateLivePilot,
          current: async () => {
            calls.push('pilot-current');
            return undefined;
          },
        },
        receivers: {
          ...runtime().receivers,
          rotate: async () => {
            calls.push('receiver-rotate');
            throw new Error('receiver mutation must remain blocked');
          },
        },
      }),
    });

    const [started, receiver, profile] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/start',
        headers: kemerbetSessionMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_private_kemerbet_sign_in',
          requestId: pilotRequestId,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/receiver-accounts/rotate',
        headers: receiverMutationHeaders(),
        payload: {
          accountHolderName: 'Exact Receiver',
          accountReference: '0912345678',
          confirmation: 'owner_confirmed_receiver_rotation',
          providerCode: 'telebirr',
          requestId: pilotRequestId,
          rotationReason: 'owner_correction',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-agent-profiles/prepare',
        headers: kemerbetAgentProfileMutationHeaders(),
        payload: {
          configurationReason: 'security_recovery',
          confirmation: 'owner_confirmed_kemerbet_agent_profile',
          requestId: pilotRequestId,
        },
      }),
    ]);
    expect(started.statusCode).toBe(409);
    expect(receiver.statusCode).toBe(409);
    expect(profile.statusCode).toBe(403);
    expect(calls).toEqual([]);

    const recoveryStatus = await app.inject({
      method: 'GET',
      url: '/v1/owner/kemerbet-session',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(recoveryStatus.statusCode).toBe(200);
    expect(recoveryStatus.json()).toEqual({
      session: {
        active: false,
        loginRequired: false,
        phase: 'idle',
        quarantine: {
          reasonCode: 'security_recovery_cohort_required',
          recoveryRequired: true,
        },
        signedIn: false,
        transferDisabled: true,
      },
    });
    expect(calls).toEqual([]);

    const prepared = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-readiness-cohort/prepare',
      headers: kemerbetReadinessCohortMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
        requestId: pilotRequestId,
      },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json()).toEqual({
      alreadyPrepared: false,
      identifiersRedacted: true,
      moneyMoved: false,
      playersPrepared: 5,
      transferDisabled: true,
    });
    expect(calls).toEqual([
      'pilot-current',
      'claim',
      `stage:${pilotRequestId}:${newClaimId}`,
      'export',
    ]);
    await app.close();
  });

  it('projects spent recheck authorization as non-retryable and blocks every mutation mode', async () => {
    const claimId = '88888888-8888-4888-8888-888888888888';
    const calls: string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetReadinessCohortControl: {
        completed: async () => false,
        lifecycle: async () => 'recheck_authorization_spent_failed_terminal',
        prepare: async () => {
          calls.push('cohort-prepare');
          throw new Error('spent authorization must not be prepared');
        },
        rootReceipt: async () => ({
          claimId,
          event: 'recheck_authorization_spent_failed_terminal',
        }),
      },
      kemerbetSessionControl: {
        frame: async () => {
          calls.push('frame');
          return undefined;
        },
        input: async () => {
          calls.push('input');
          return inactiveKemerbetSession;
        },
        start: async () => {
          calls.push('start');
          return inactiveKemerbetSession;
        },
        status: async () => {
          calls.push('status');
          return inactiveKemerbetSession;
        },
        stop: async () => {
          calls.push('stop');
          return inactiveKemerbetSession;
        },
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async () => {
            calls.push('profiles');
            return [];
          },
          prepare: async () => {
            calls.push('profile-prepare');
            throw new Error('spent authorization must not rotate a profile');
          },
        },
        kemerbetReadinessCohorts: {
          claim: async () => {
            calls.push('claim');
            throw new Error('spent authorization must not claim another cohort');
          },
          markExported: async () => {
            calls.push('export');
            throw new Error('spent authorization must not export another cohort');
          },
          recordRootReceipt: async () => {
            calls.push('record');
            throw new Error('spent authorization is already terminal');
          },
        },
      }),
    });

    const status = await app.inject({
      method: 'GET',
      url: '/v1/owner/kemerbet-session',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      session: {
        active: false,
        loginRequired: false,
        phase: 'idle',
        quarantine: {
          reasonCode: 'recheck_authorization_spent_failed_terminal',
          recoveryRequired: true,
        },
        signedIn: false,
        transferDisabled: true,
      },
    });

    const [ordinary, cohort, recovery] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/start',
        headers: kemerbetSessionMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_private_kemerbet_sign_in',
          requestId: pilotRequestId,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-readiness-cohort/prepare',
        headers: kemerbetReadinessCohortMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
          requestId: pilotRequestId,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-agent-profiles/prepare',
        headers: kemerbetAgentProfileMutationHeaders(),
        payload: {
          configurationReason: 'security_recovery',
          confirmation: 'owner_confirmed_kemerbet_agent_profile',
          requestId: pilotRequestId,
        },
      }),
    ]);
    expect(ordinary.statusCode).toBe(409);
    expect(cohort.statusCode).toBe(409);
    expect(recovery.statusCode).toBe(403);
    expect(calls).toEqual([]);
    await app.close();
  });

  it.each(['security_recovery_cohort_staged', 'imported', 'retryable_failed'] as const)(
    'keeps every mutation blocked while recovery remains %s',
    async (lifecycle) => {
      const calls: string[] = [];
      const app = buildOwnerControlApp(config(), {
        fetch: verifiedAuthFetch(),
        kemerbetReadinessCohortControl: {
          completed: async () => false,
          lifecycle: async () => lifecycle,
          prepare: async () => {
            calls.push('cohort-prepare');
            throw new Error('recovery cohort must not be replaced');
          },
          rootReceipt: async () =>
            lifecycle === 'security_recovery_cohort_staged'
              ? undefined
              : {
                  claimId: '88888888-8888-4888-8888-888888888888',
                  event: lifecycle,
                },
        },
        kemerbetSessionControl: {
          frame: async () => undefined,
          input: async () => inactiveKemerbetSession,
          start: async () => {
            calls.push('start');
            return inactiveKemerbetSession;
          },
          status: async () => {
            calls.push('status');
            return inactiveKemerbetSession;
          },
          stop: async () => inactiveKemerbetSession,
        },
        runtime: runtime({
          kemerbetReadinessCohorts: {
            ...runtime().kemerbetReadinessCohorts,
            claim: async () => {
              calls.push('claim');
              throw new Error('recovery cohort must not be replaced');
            },
          },
        }),
      });

      const status = await app.inject({
        method: 'GET',
        url: '/v1/owner/kemerbet-session',
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        session: {
          quarantine: {
            reasonCode: 'security_recovery_in_progress',
            recoveryRequired: true,
          },
          transferDisabled: true,
        },
      });

      const [start, cohort] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/v1/owner/kemerbet-session/start',
          headers: kemerbetSessionMutationHeaders(),
          payload: {
            confirmation: 'owner_confirmed_private_kemerbet_sign_in',
            requestId: pilotRequestId,
          },
        }),
        app.inject({
          method: 'POST',
          url: '/v1/owner/kemerbet-readiness-cohort/prepare',
          headers: kemerbetReadinessCohortMutationHeaders(),
          payload: {
            confirmation: 'owner_confirmed_kemerbet_readiness_five_player_no_transfer',
            requestId: pilotRequestId,
          },
        }),
      ]);
      expect(start.statusCode).toBe(409);
      expect(cohort.statusCode).toBe(409);
      expect(calls).toEqual([]);
      await app.close();
    },
  );

  it('never treats generic private-session unavailability as recovery authority', async () => {
    const profile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    let prepareCalls = 0;
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetSessionControl: {
        frame: async () => undefined,
        input: async () => inactiveKemerbetSession,
        start: async () => inactiveKemerbetSession,
        status: async () => {
          throw new Error('unavailable');
        },
        stop: async () => inactiveKemerbetSession,
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async () => [profile],
          prepare: async () => {
            prepareCalls += 1;
            return profile;
          },
        },
      }),
    });
    const recovery = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-agent-profiles/prepare',
      headers: kemerbetAgentProfileMutationHeaders(),
      payload: {
        configurationReason: 'security_recovery',
        confirmation: 'owner_confirmed_kemerbet_agent_profile',
        requestId: pilotRequestId,
      },
    });
    expect(recovery.statusCode).toBe(403);
    expect(prepareCalls).toBe(0);
    await app.close();
  });

  it('serializes profile retirement behind Start and rejects it after the session becomes active', async () => {
    const profile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const startEntered = deferred<void>();
    const releaseStart = deferred<void>();
    const secondAuthenticationStarted = deferred<void>();
    let authenticationCalls = 0;
    let databasePrepareCalls = 0;
    let profileListCalls = 0;
    let profileReadWhileStartPending = false;
    let sessionActive = false;
    let startPending = false;
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        if (authenticationCalls === 2) secondAuthenticationStarted.resolve();
        return new Response(JSON.stringify({ id: authUserId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
      kemerbetSessionControl: {
        frame: async () => undefined,
        input: async () => activeKemerbetSession,
        start: async (accountId) => {
          expect(accountId).toBe(profile.platformAgentAccountId);
          sessionActive = true;
          startPending = true;
          startEntered.resolve();
          await releaseStart.promise;
          startPending = false;
          return activeKemerbetSession;
        },
        status: async (accountId) => {
          expect(accountId).toBe(profile.platformAgentAccountId);
          return sessionActive ? activeKemerbetSession : inactiveKemerbetSession;
        },
        stop: async () => inactiveKemerbetSession,
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async (actor) => {
            expect(actor).toBe(authUserId);
            profileListCalls += 1;
            if (startPending) profileReadWhileStartPending = true;
            return [profile];
          },
          prepare: async () => {
            databasePrepareCalls += 1;
            return profile;
          },
        },
      }),
    });

    const startResponse = app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-session/start',
      headers: kemerbetSessionMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_private_kemerbet_sign_in',
        requestId: pilotRequestId,
      },
    });
    await startEntered.promise;

    let prepareSettled = false;
    const prepareResponse = app
      .inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-agent-profiles/prepare',
        headers: kemerbetAgentProfileMutationHeaders(),
        payload: {
          configurationReason: 'agent_rotation',
          confirmation: 'owner_confirmed_kemerbet_agent_profile',
          requestId: pilotRequestId,
        },
      })
      .then((response) => {
        prepareSettled = true;
        return response;
      });
    await secondAuthenticationStarted.promise;
    await nextEventLoopTurn();

    expect(prepareSettled).toBe(false);
    expect(profileListCalls).toBe(1);
    expect(databasePrepareCalls).toBe(0);
    expect(profileReadWhileStartPending).toBe(false);

    releaseStart.resolve();
    const [started, prepared] = await Promise.all([startResponse, prepareResponse]);
    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual({ session: activeKemerbetSession });
    expect(prepared.statusCode).toBe(409);
    expect(prepared.json()).toEqual({ error: 'kemerbet_session_must_stop' });
    expect(profileListCalls).toBe(2);
    expect(databasePrepareCalls).toBe(0);
    expect(profileReadWhileStartPending).toBe(false);
    expect(authenticationCalls).toBe(2);
    await app.close();
  });

  it('serializes Start behind profile retirement and binds it to the newly active profile', async () => {
    const oldProfile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const newProfile = {
      ...oldProfile,
      configuredAt: '2026-08-27T12:00:00.000Z',
      configurationReason: 'agent_rotation' as const,
      platformAgentAccountId: '88888888-8888-4888-8888-888888888888',
      profileLabel: 'Primary KemerBet agent revision 2',
      profileRevision: 2,
    };
    const rotationRequestId = '66666666-6666-4666-8666-666666666666';
    const prepareEntered = deferred<void>();
    const releasePrepare = deferred<void>();
    const secondAuthenticationStarted = deferred<void>();
    const events: string[] = [];
    const startedAccountIds: string[] = [];
    let authenticationCalls = 0;
    let databasePrepareCalls = 0;
    let preparePending = false;
    let profileListCalls = 0;
    let profileReadWhilePreparePending = false;
    let rotated = false;
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        if (authenticationCalls === 2) secondAuthenticationStarted.resolve();
        return new Response(JSON.stringify({ id: authUserId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
      kemerbetSessionControl: {
        frame: async () => undefined,
        input: async () => activeKemerbetSession,
        start: async (accountId) => {
          events.push(`start:${accountId}`);
          startedAccountIds.push(accountId);
          return activeKemerbetSession;
        },
        status: async (accountId) => {
          events.push(`status:${accountId}`);
          expect(accountId).toBe(oldProfile.platformAgentAccountId);
          return inactiveKemerbetSession;
        },
        stop: async () => inactiveKemerbetSession,
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async (actor) => {
            expect(actor).toBe(authUserId);
            profileListCalls += 1;
            if (preparePending) profileReadWhilePreparePending = true;
            const profile = rotated ? newProfile : oldProfile;
            events.push(`list:${profile.platformAgentAccountId}`);
            return [profile];
          },
          prepare: async (actor, request) => {
            expect(actor).toBe(authUserId);
            expect(request).toEqual({
              configurationReason: 'agent_rotation',
              requestId: rotationRequestId,
            });
            databasePrepareCalls += 1;
            preparePending = true;
            events.push('prepare:entered');
            prepareEntered.resolve();
            await releasePrepare.promise;
            rotated = true;
            preparePending = false;
            events.push('prepare:completed');
            return newProfile;
          },
        },
      }),
    });

    const prepareResponse = app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-agent-profiles/prepare',
      headers: kemerbetAgentProfileMutationHeaders(rotationRequestId),
      payload: {
        configurationReason: 'agent_rotation',
        confirmation: 'owner_confirmed_kemerbet_agent_profile',
        requestId: rotationRequestId,
      },
    });
    await prepareEntered.promise;

    let startSettled = false;
    const startResponse = app
      .inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/start',
        headers: kemerbetSessionMutationHeaders(),
        payload: {
          confirmation: 'owner_confirmed_private_kemerbet_sign_in',
          requestId: pilotRequestId,
        },
      })
      .then((response) => {
        startSettled = true;
        return response;
      });
    await secondAuthenticationStarted.promise;
    await nextEventLoopTurn();

    expect(startSettled).toBe(false);
    expect(profileListCalls).toBe(1);
    expect(databasePrepareCalls).toBe(1);
    expect(startedAccountIds).toEqual([]);
    expect(profileReadWhilePreparePending).toBe(false);

    releasePrepare.resolve();
    const [prepared, started] = await Promise.all([prepareResponse, startResponse]);
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json()).toEqual({ profile: newProfile });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual({ session: activeKemerbetSession });
    expect(startedAccountIds).toEqual([newProfile.platformAgentAccountId]);
    expect(profileListCalls).toBe(2);
    expect(databasePrepareCalls).toBe(1);
    expect(profileReadWhilePreparePending).toBe(false);
    expect(authenticationCalls).toBe(2);
    expect(events).toEqual([
      `list:${oldProfile.platformAgentAccountId}`,
      `status:${oldProfile.platformAgentAccountId}`,
      'prepare:entered',
      'prepare:completed',
      `list:${newProfile.platformAgentAccountId}`,
      `start:${newProfile.platformAgentAccountId}`,
    ]);
    await app.close();
  });

  it('invalidates the interactive active-profile cache after a safe profile rotation', async () => {
    const oldProfile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const newProfile = {
      ...oldProfile,
      configuredAt: '2026-08-22T19:35:00.000Z',
      configurationReason: 'agent_rotation' as const,
      platformAgentAccountId: '88888888-8888-4888-8888-888888888888',
      profileLabel: 'Primary KemerBet agent revision 2',
      profileRevision: 2,
    };
    let rotated = false;
    const observedStatusAccounts: string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetSessionControl: {
        frame: async () => undefined,
        input: async () => inactiveKemerbetSession,
        start: async () => inactiveKemerbetSession,
        status: async (accountId) => {
          observedStatusAccounts.push(accountId);
          return accountId === oldProfile.platformAgentAccountId
            ? inactiveKemerbetSession
            : inactiveKemerbetSession;
        },
        stop: async () => inactiveKemerbetSession,
      },
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async () => [rotated ? newProfile : oldProfile],
          prepare: async () => {
            rotated = true;
            return newProfile;
          },
        },
      }),
    });

    for (const expectedAccountId of [oldProfile.platformAgentAccountId]) {
      const status = await app.inject({
        method: 'GET',
        url: '/v1/owner/kemerbet-session',
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toEqual({ session: inactiveKemerbetSession });
      expect(observedStatusAccounts.at(-1)).toBe(expectedAccountId);
    }
    const prepared = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-agent-profiles/prepare',
      headers: kemerbetAgentProfileMutationHeaders(),
      payload: {
        configurationReason: 'agent_rotation',
        confirmation: 'owner_confirmed_kemerbet_agent_profile',
        requestId: pilotRequestId,
      },
    });
    expect(prepared.statusCode).toBe(201);

    const afterRotation = await app.inject({
      method: 'GET',
      url: '/v1/owner/kemerbet-session',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(afterRotation.statusCode).toBe(200);
    expect(observedStatusAccounts).toEqual([
      oldProfile.platformAgentAccountId,
      oldProfile.platformAgentAccountId,
      newProfile.platformAgentAccountId,
    ]);
    await app.close();
  });

  it('rejects credential fields and invalid KemerBet profile mutation headers before authentication', async () => {
    let authenticationCalls = 0;
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        throw new Error('authentication must not run');
      }) as typeof fetch,
      runtime: runtime(),
    });
    const base = {
      configurationReason: 'initial_configuration',
      confirmation: 'owner_confirmed_kemerbet_agent_profile',
      requestId: pilotRequestId,
    };
    for (const candidate of [
      {
        payload: { ...base, password: 'forbidden' },
        headers: kemerbetAgentProfileMutationHeaders(),
      },
      {
        payload: base,
        headers: { ...kemerbetAgentProfileMutationHeaders(), origin: 'https://evil.example' },
      },
      {
        payload: base,
        headers: {
          ...kemerbetAgentProfileMutationHeaders(),
          'x-fetanagent-owner-csrf': 'owner-receiver-rotation-v1',
        },
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-agent-profiles/prepare',
        headers: candidate.headers,
        payload: candidate.payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(authenticationCalls).toBe(0);
    await app.close();
  });

  it('rejects malformed private-preview text batches before authentication', async () => {
    let authenticationCalls = 0;
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        throw new Error('authentication must not run');
      }) as typeof fetch,
      runtime: runtime(),
    });
    const base = {
      frameSequence: 1,
      kind: 'text',
      requestId: pilotRequestId,
      sessionGeneration: pilotRequestId,
    };
    for (const payload of [
      { ...base, text: '' },
      { ...base, text: 'A'.repeat(65) },
      { ...base, text: 'contains`backtick' },
      { ...base, text: 'contains\nnewline' },
      { ...base, text: 'valid', password: 'forbidden' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/input',
        headers: kemerbetSessionMutationHeaders(),
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(authenticationCalls).toBe(0);
    await app.close();
  });

  it('controls only the active profile through the exact private no-transfer session boundary', async () => {
    const profile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const observed: unknown[] = [];
    const control: OwnerKemerbetSessionControl = {
      frame: async (accountId, generation, after) => {
        observed.push(['frame', accountId, generation, after]);
        return {
          generation,
          image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
          sequence: 1,
        };
      },
      status: async (accountId) => {
        observed.push(['status', accountId]);
        return activeKemerbetSession;
      },
      start: async (accountId, requestId) => {
        observed.push(['start', accountId, requestId]);
        return activeKemerbetSession;
      },
      input: async (accountId, value) => {
        observed.push(['input', accountId, value]);
        return activeKemerbetSession;
      },
      stop: async (accountId, requestId) => {
        observed.push(['stop', accountId, requestId]);
        return inactiveKemerbetSession;
      },
    };
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      kemerbetSessionControl: control,
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async (actor) => {
            expect(actor).toBe(authUserId);
            return [profile];
          },
          prepare: async () => profile,
        },
      }),
    });

    const status = await app.inject({
      method: 'GET',
      url: '/v1/owner/kemerbet-session',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ session: activeKemerbetSession });

    const started = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-session/start',
      headers: kemerbetSessionMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_private_kemerbet_sign_in',
        requestId: pilotRequestId,
      },
    });
    expect(started.statusCode).toBe(202);

    const frame = await app.inject({
      method: 'GET',
      url: `/v1/owner/kemerbet-session/frame?generation=${pilotRequestId}&after=0`,
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers['content-type']).toBe('image/jpeg');
    expect(frame.headers['x-fetanagent-frame-sequence']).toBe('1');

    for (const payload of [
      {
        frameSequence: 1,
        kind: 'pointer',
        requestId: pilotRequestId,
        sessionGeneration: pilotRequestId,
        x: 123,
        y: 456,
      },
      {
        frameSequence: 1,
        key: 'A',
        kind: 'key',
        requestId: pilotRequestId,
        sessionGeneration: pilotRequestId,
      },
      {
        frameSequence: 1,
        kind: 'text',
        requestId: pilotRequestId,
        sessionGeneration: pilotRequestId,
        text: 'owner-login',
      },
    ]) {
      const input = await app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/input',
        headers: kemerbetSessionMutationHeaders(),
        payload,
      });
      expect(input.statusCode).toBe(200);
      expect(input.json()).toEqual({ session: activeKemerbetSession });
    }

    const stopped = await app.inject({
      method: 'POST',
      url: '/v1/owner/kemerbet-session/stop',
      headers: kemerbetSessionMutationHeaders(),
      payload: {
        confirmation: 'owner_confirmed_stop_private_kemerbet_session',
        requestId: pilotRequestId,
      },
    });
    expect(stopped.statusCode).toBe(202);
    expect(stopped.json()).toEqual({ session: inactiveKemerbetSession });
    expect(observed).toEqual([
      ['status', profile.platformAgentAccountId],
      ['start', profile.platformAgentAccountId, pilotRequestId],
      ['frame', profile.platformAgentAccountId, pilotRequestId, 0],
      [
        'input',
        profile.platformAgentAccountId,
        {
          frameSequence: 1,
          kind: 'pointer',
          requestId: pilotRequestId,
          sessionGeneration: pilotRequestId,
          x: 123,
          y: 456,
        },
      ],
      [
        'input',
        profile.platformAgentAccountId,
        {
          frameSequence: 1,
          key: 'A',
          kind: 'key',
          requestId: pilotRequestId,
          sessionGeneration: pilotRequestId,
        },
      ],
      [
        'input',
        profile.platformAgentAccountId,
        {
          frameSequence: 1,
          kind: 'text',
          requestId: pilotRequestId,
          sessionGeneration: pilotRequestId,
          text: 'owner-login',
        },
      ],
      ['stop', profile.platformAgentAccountId, pilotRequestId],
    ]);
    expect(JSON.stringify(observed)).not.toMatch(/password|otp|cookie|amount|transfer/iu);
    await app.close();
  });

  it('coalesces and caches interactive Owner and profile checks for at most five seconds', async () => {
    let nowMs = Date.parse('2026-08-27T12:00:00.000Z');
    let authenticationCalls = 0;
    let profileCalls = 0;
    const profile = {
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration' as const,
      platformAgentAccountId: '77777777-7777-4777-8777-777777777777',
      platformCode: 'kemerbet' as const,
      profileContractVersion: 1 as const,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active' as const,
    };
    const control: OwnerKemerbetSessionControl = {
      frame: async () => undefined,
      input: async () => activeKemerbetSession,
      start: async () => activeKemerbetSession,
      status: async () => activeKemerbetSession,
      stop: async () => inactiveKemerbetSession,
    };
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        return new Response(JSON.stringify({ id: authUserId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
      kemerbetSessionControl: control,
      now: () => new Date(nowMs),
      runtime: runtime({
        kemerbetAgentProfiles: {
          list: async (actor) => {
            expect(actor).toBe(authUserId);
            profileCalls += 1;
            return [profile];
          },
          prepare: async () => profile,
        },
      }),
    });
    const ownerHeaders = { authorization: `Bearer ${bearer}` };
    const statusRequest = () =>
      app.inject({ method: 'GET', url: '/v1/owner/kemerbet-session', headers: ownerHeaders });
    const frameRequest = () =>
      app.inject({
        method: 'GET',
        url: `/v1/owner/kemerbet-session/frame?generation=${pilotRequestId}&after=1`,
        headers: ownerHeaders,
      });

    const [status, frame] = await Promise.all([statusRequest(), frameRequest()]);
    expect(status.statusCode).toBe(200);
    expect(frame.statusCode).toBe(204);
    expect(authenticationCalls).toBe(1);
    expect(profileCalls).toBe(1);

    expect((await statusRequest()).statusCode).toBe(200);
    expect(authenticationCalls).toBe(1);
    expect(profileCalls).toBe(1);

    nowMs += 5_001;
    expect((await frameRequest()).statusCode).toBe(204);
    expect(authenticationCalls).toBe(2);
    expect(profileCalls).toBe(2);

    const source = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');
    expect(source).toContain("createHash('sha256').update(token, 'utf8').digest('hex')");
    expect(source).toContain('const INTERACTIVE_SESSION_CACHE_MAX_ENTRIES = 8');
    await app.close();
  });

  it('rejects private session credential, amount, Transfer, and cross-origin fields before auth', async () => {
    let authenticationCalls = 0;
    const controlCalls: string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        throw new Error('authentication must not run');
      }) as typeof fetch,
      kemerbetSessionControl: {
        frame: async () => undefined,
        status: async () => {
          controlCalls.push('status');
          return inactiveKemerbetSession;
        },
        start: async () => {
          controlCalls.push('start');
          return activeKemerbetSession;
        },
        input: async () => {
          controlCalls.push('input');
          return activeKemerbetSession;
        },
        stop: async () => {
          controlCalls.push('stop');
          return inactiveKemerbetSession;
        },
      },
      runtime: runtime(),
    });
    const base = {
      confirmation: 'owner_confirmed_private_kemerbet_sign_in',
      requestId: pilotRequestId,
    };
    for (const candidate of [
      { payload: { ...base, password: 'forbidden' }, headers: kemerbetSessionMutationHeaders() },
      { payload: { ...base, amount: 25 }, headers: kemerbetSessionMutationHeaders() },
      { payload: { ...base, transfer: true }, headers: kemerbetSessionMutationHeaders() },
      {
        payload: base,
        headers: { ...kemerbetSessionMutationHeaders(), origin: 'https://evil.example' },
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/owner/kemerbet-session/start',
        headers: candidate.headers,
        payload: candidate.payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(authenticationCalls).toBe(0);
    expect(controlCalls).toEqual([]);
    await app.close();
  });

  it('strongly authenticates and prepares only an exact dormant pilot request', async () => {
    let observedActor = '';
    let observedRequest: unknown;
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        privateLivePilot: {
          arm: async () => {
            throw new Error('not called');
          },
          current: async () => {
            throw new Error('not called');
          },
          prepare: async (actor, request) => {
            observedActor = actor;
            observedRequest = request;
            return pilotStatus();
          },
          status: async () => {
            throw new Error('not called');
          },
          stop: async () => {
            throw new Error('not called');
          },
        },
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/private-live-deposit-pilots/prepare',
      headers: pilotMutationHeaders(),
      payload: {
        activeFrom: '2026-08-21T20:00:00.000Z',
        confirmation: 'owner_confirmed_fixed_telebirr_five_player_pilot',
        expiresAt: '2026-08-21T22:00:00.000Z',
        playerIds: ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'],
        requestId: pilotRequestId,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(observedActor).toBe(authUserId);
    expect(observedRequest).toMatchObject({
      playerIds: ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'],
      requestId: pilotRequestId,
    });
    expect(response.json()).toEqual({ pilot: pilotStatus() });
    expect(response.body).not.toContain('PLAYER-1');
    await app.close();
  });

  it('rejects browser-supplied provider, amount, reservation, or customer authority', async () => {
    let authenticationCalls = 0;
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        throw new Error('authentication must not run');
      }) as typeof fetch,
      runtime: runtime(),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/private-live-deposit-pilots/prepare',
      headers: pilotMutationHeaders(),
      payload: {
        activeFrom: '2026-08-21T20:00:00.000Z',
        confirmation: 'owner_confirmed_fixed_telebirr_five_player_pilot',
        expiresAt: '2026-08-21T22:00:00.000Z',
        maximumAggregateMinor: 12_500,
        playerIds: ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'],
        providerCodes: ['telebirr'],
        requestId: pilotRequestId,
        submittingCustomerIds: ['44444444-4444-4444-8444-444444444444'],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(authenticationCalls).toBe(0);
    await app.close();
  });

  it('rejects cross-origin, missing-CSRF, non-JSON, and mismatched idempotency requests before auth', async () => {
    let authenticationCalls = 0;
    const app = buildOwnerControlApp(config(), {
      fetch: (async () => {
        authenticationCalls += 1;
        throw new Error('authentication must not run');
      }) as typeof fetch,
      runtime: runtime(),
    });
    const payload = {
      confirmation: 'owner_confirmed_dry_run_only',
      requestId: pilotRevisionId,
    };
    const invalidHeaders = [
      { ...pilotMutationHeaders(pilotRevisionId), origin: 'https://attacker.example' },
      {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:3002',
        'x-idempotency-key': pilotRevisionId,
      },
      { ...pilotMutationHeaders(pilotRevisionId), 'content-type': 'text/plain' },
      {
        ...pilotMutationHeaders(pilotRevisionId),
        'content-type': 'application/json; charset=utf-8',
      },
      {
        ...pilotMutationHeaders(pilotRevisionId),
        'x-idempotency-key': '66666666-6666-4666-8666-666666666666',
      },
    ];

    for (const headers of invalidHeaders) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/arm`,
        headers,
        payload: headers['content-type'] === 'text/plain' ? JSON.stringify(payload) : payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
    }
    const mismatchedResourceIdentity = await app.inject({
      method: 'POST',
      url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/arm`,
      headers: pilotMutationHeaders(pilotRequestId),
      payload: {
        confirmation: 'owner_confirmed_dry_run_only',
        requestId: pilotRequestId,
      },
    });
    expect(mismatchedResourceIdentity.statusCode).toBe(400);
    expect(authenticationCalls).toBe(0);
    await app.close();
  });

  it('returns a replay-safe dry-run arm receipt and rejects the wrong method', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        privateLivePilot: {
          arm: async (actor, id) => {
            expect([actor, id]).toEqual([authUserId, pilotRevisionId]);
            return {
              alreadyApplied: true,
              status: pilotStatus({ pilotStatus: 'armed', switchMode: 'dry_run' }),
            };
          },
          current: async () => {
            throw new Error('not called');
          },
          prepare: async () => {
            throw new Error('not called');
          },
          status: async () => {
            throw new Error('not called');
          },
          stop: async () => {
            throw new Error('not called');
          },
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/arm`,
      headers: pilotMutationHeaders(pilotRevisionId),
      payload: {
        confirmation: 'owner_confirmed_dry_run_only',
        requestId: pilotRevisionId,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      alreadyApplied: true,
      status: { financiallyActive: false, pilotStatus: 'armed', switchMode: 'dry_run' },
    });

    const wrongMethod = await app.inject({
      method: 'PUT',
      url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/arm`,
      headers: pilotMutationHeaders(pilotRevisionId),
      payload: {
        confirmation: 'owner_confirmed_dry_run_only',
        requestId: pilotRevisionId,
      },
    });
    expect(wrongMethod.statusCode).toBe(404);
    await app.close();
  });

  it('keeps the authenticated emergency stop directly reachable', async () => {
    let stopped: readonly string[] = [];
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        privateLivePilot: {
          arm: async () => {
            throw new Error('not called');
          },
          current: async () => {
            throw new Error('not called');
          },
          prepare: async () => {
            throw new Error('not called');
          },
          status: async () => {
            throw new Error('not called');
          },
          stop: async (actor, id, reasonCode) => {
            stopped = [actor, id, reasonCode];
            return pilotStatus({
              pilotStatus: 'stopped',
              stopReasonCode: reasonCode,
              stoppedAt: '2026-08-21T20:30:00.000Z',
            });
          },
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/stop`,
      headers: pilotMutationHeaders(pilotRevisionId),
      payload: {
        confirmation: 'owner_confirmed_emergency_stop',
        reasonCode: 'execution_uncertainty',
        requestId: pilotRevisionId,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(stopped).toEqual([authUserId, pilotRevisionId, 'execution_uncertainty']);
    expect(response.json()).toMatchObject({
      pilot: { financiallyActive: false, pilotStatus: 'stopped', switchMode: 'disabled' },
    });
    await app.close();
  });

  it('requires the verified Owner bearer subject for status without exposing request inputs', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime(),
    });
    const forbidden = await app.inject({
      method: 'GET',
      url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/status`,
    });
    expect(forbidden.statusCode).toBe(403);

    const accepted = await app.inject({
      method: 'GET',
      url: `/v1/owner/private-live-deposit-pilots/${pilotRevisionId}/status`,
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ pilot: pilotStatus() });
    await app.close();
  });

  it('loads the current pilot after authentication without requiring a copied pilot identifier', async () => {
    const app = buildOwnerControlApp(config(), {
      fetch: verifiedAuthFetch(),
      runtime: runtime({
        privateLivePilot: {
          arm: async () => {
            throw new Error('not called');
          },
          current: async (actor) => {
            expect(actor).toBe(authUserId);
            return pilotStatus({ pilotStatus: 'armed', switchMode: 'dry_run' });
          },
          prepare: async () => {
            throw new Error('not called');
          },
          status: async () => {
            throw new Error('not called');
          },
          stop: async () => {
            throw new Error('not called');
          },
        },
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/owner/private-live-deposit-pilots/current',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      pilot: pilotStatus({ pilotStatus: 'armed', switchMode: 'dry_run' }),
    });
    await app.close();
  });
});
