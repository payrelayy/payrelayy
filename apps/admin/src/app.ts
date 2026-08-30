import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { OwnerControlConfig } from '@fetanagent/config/owner-control';
import Fastify, { LogController } from 'fastify';

import {
  OwnerDepositIntakeRejectedError,
  OwnerDepositIntakeUnavailableError,
} from './owner-deposit-intake.js';
import {
  OWNER_DRY_RUN_FIXTURE_IDS,
  OwnerDryRunFixtureAssessmentRejectedError,
  OwnerDryRunFixtureAssessmentUnavailableError,
  type OwnerDryRunFixtureReviewDecision,
} from './owner-dry-run-fixture-assessments.js';
import {
  OwnerAuthenticationRejectedError,
  OwnerAuthenticationUnavailableError,
  bearerTokenFromRawHeaders,
  verifyOwnerBearerToken,
} from './owner-auth.js';
import {
  OwnerInviteRejectedError,
  OwnerInviteUnavailableError,
  type BetaInviteRevocationReason,
} from './owner-invites.js';
import {
  OwnerKemerbetAgentProfileRejectedError,
  OwnerKemerbetAgentProfileUnavailableError,
  type OwnerKemerbetAgentProfileReason,
} from './owner-kemerbet-agent-profile.js';
import {
  FileOwnerKemerbetReadinessCohortControl,
  OwnerKemerbetReadinessCohortRejectedError,
  OwnerKemerbetReadinessCohortUnavailableError,
  type OwnerKemerbetReadinessCohortControl,
  type OwnerKemerbetReadinessCohortReceipt,
  type OwnerKemerbetReadinessLifecycleState,
} from './owner-kemerbet-readiness-cohort.js';
import { reconcileOwnerKemerbetReadinessRootReceipt } from './owner-kemerbet-readiness-reconciler.js';
import {
  OwnerKemerbetSessionRejectedError,
  OwnerKemerbetSessionUnavailableError,
  UnixOwnerKemerbetSessionControl,
  type OwnerKemerbetSessionControl,
  type OwnerKemerbetSessionInput,
  type OwnerKemerbetSessionStatus,
} from './owner-kemerbet-session-control.js';
import {
  OwnerPlayerDepositEligibilityRejectedError,
  OwnerPlayerDepositEligibilityUnavailableError,
  type OwnerPlayerDepositEligibilityDecision,
} from './owner-player-deposit-eligibility.js';
import {
  OwnerPlayerRegistrationReviewRejectedError,
  OwnerPlayerRegistrationReviewUnavailableError,
  type OwnerPlayerRegistrationDecision,
} from './owner-player-registration-reviews.js';
import {
  OwnerPrivateLivePilotRejectedError,
  OwnerPrivateLivePilotUnavailableError,
  type PrepareApprovedPrivateLivePilotRequest,
  type PrivateLivePilotStopReason,
} from './owner-private-live-pilot.js';
import {
  OwnerReceiverAccountRejectedError,
  OwnerReceiverAccountUnavailableError,
  type OwnerReceiverProvider,
  type OwnerReceiverRotationReason,
} from './owner-receiver-accounts.js';
import type { OwnerControlPostgresRuntime } from './postgres-runtime.js';
import {
  OWNER_DASHBOARD_CONTENT_SECURITY_POLICY,
  OWNER_DASHBOARD_CSS,
  OWNER_DASHBOARD_HTML,
  OWNER_DASHBOARD_JAVASCRIPT,
  ownerDashboardPublicConfig,
} from './owner-dashboard.js';

export interface OwnerControlAppDependencies {
  readonly fetch?: typeof fetch;
  readonly kemerbetReadinessCohortControl?: OwnerKemerbetReadinessCohortControl;
  readonly kemerbetSessionControl?: OwnerKemerbetSessionControl;
  readonly now?: () => Date;
  readonly runtime: OwnerControlPostgresRuntime;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? object
    : undefined;
}

const REVOCATION_REASONS = new Set<BetaInviteRevocationReason>([
  'owner_cancelled',
  'security_rotation',
  'staging_reset',
]);
const PLAYER_REGISTRATION_DECISIONS = new Set<OwnerPlayerRegistrationDecision>([
  'exists',
  'not_found',
  'review_required',
  'cancelled',
]);
const PLAYER_DEPOSIT_ELIGIBILITY_DECISIONS = new Set<OwnerPlayerDepositEligibilityDecision>([
  'eligible',
  'revoked',
]);
const DRY_RUN_FIXTURE_IDS = new Set<string>(OWNER_DRY_RUN_FIXTURE_IDS);
const DRY_RUN_FIXTURE_REVIEW_DECISIONS = new Set<OwnerDryRunFixtureReviewDecision>([
  'acknowledged',
  'manual_review_required',
]);
const PRIVATE_LIVE_PILOT_STOP_REASONS = new Set<PrivateLivePilotStopReason>([
  'cap_review',
  'execution_uncertainty',
  'owner_stop',
  'parser_drift',
  'pilot_complete',
  'provider_incident',
]);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OWNER_PILOT_CSRF_HEADER_VALUE = 'private-live-pilot-v1';
const OWNER_RECEIVER_CSRF_HEADER_VALUE = 'owner-receiver-rotation-v1';
const OWNER_KEMERBET_AGENT_CSRF_HEADER_VALUE = 'owner-kemerbet-agent-profile-v1';
const OWNER_KEMERBET_READINESS_COHORT_CSRF_HEADER_VALUE = 'owner-kemerbet-readiness-cohort-v1';
const OWNER_KEMERBET_SESSION_CSRF_HEADER_VALUE = 'owner-kemerbet-session-v1';
const OWNER_KEMERBET_AGENT_PROFILE_REASONS = new Set<OwnerKemerbetAgentProfileReason>([
  'agent_rotation',
  'initial_configuration',
  'owner_correction',
  'security_recovery',
]);
const OWNER_KEMERBET_SESSION_QUARANTINE_REASON_CODES = new Set([
  'browser_cleanup_unverified',
  'profile_integrity_unverified',
  'recheck_authorization_spent_failed_terminal',
  'security_recovery_cohort_required',
  'security_recovery_in_progress',
  'unclean_session_generation',
]);
const OWNER_KEMERBET_SECURITY_RECOVERY_SESSION = Object.freeze({
  active: false,
  loginRequired: false,
  phase: 'idle' as const,
  quarantine: Object.freeze({
    reasonCode: 'profile_integrity_unverified' as const,
    recoveryRequired: true as const,
  }),
  signedIn: false,
  transferDisabled: true as const,
});
const OWNER_KEMERBET_RECHECK_SPENT_TERMINAL_SESSION = Object.freeze({
  active: false,
  loginRequired: false,
  phase: 'idle' as const,
  quarantine: Object.freeze({
    reasonCode: 'recheck_authorization_spent_failed_terminal' as const,
    recoveryRequired: true as const,
  }),
  signedIn: false,
  transferDisabled: true as const,
});
const OWNER_KEMERBET_SECURITY_RECOVERY_COHORT_REQUIRED_SESSION = Object.freeze({
  active: false,
  loginRequired: false,
  phase: 'idle' as const,
  quarantine: Object.freeze({
    reasonCode: 'security_recovery_cohort_required' as const,
    recoveryRequired: true as const,
  }),
  signedIn: false,
  transferDisabled: true as const,
});
const OWNER_KEMERBET_SECURITY_RECOVERY_IN_PROGRESS_SESSION = Object.freeze({
  active: false,
  loginRequired: false,
  phase: 'idle' as const,
  quarantine: Object.freeze({
    reasonCode: 'security_recovery_in_progress' as const,
    recoveryRequired: true as const,
  }),
  signedIn: false,
  transferDisabled: true as const,
});

function exactOwnerKemerbetSessionQuarantine(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (
    Object.keys(session).sort().join('\0') !==
      ['active', 'loginRequired', 'phase', 'quarantine', 'signedIn', 'transferDisabled']
        .sort()
        .join('\0') ||
    session.active !== false ||
    session.loginRequired !== false ||
    session.phase !== 'idle' ||
    session.signedIn !== false ||
    session.transferDisabled !== true ||
    typeof session.quarantine !== 'object' ||
    session.quarantine === null ||
    Array.isArray(session.quarantine)
  ) {
    return false;
  }
  const quarantine = session.quarantine as Record<string, unknown>;
  return (
    Object.keys(quarantine).sort().join('\0') ===
      ['reasonCode', 'recoveryRequired'].sort().join('\0') &&
    OWNER_KEMERBET_SESSION_QUARANTINE_REASON_CODES.has(String(quarantine.reasonCode)) &&
    quarantine.recoveryRequired === true
  );
}
const OWNER_RECEIVER_PROVIDERS = new Set<OwnerReceiverProvider>(['cbe_birr', 'telebirr']);
const OWNER_RECEIVER_ROTATION_REASONS = new Set<OwnerReceiverRotationReason>([
  'account_rotation',
  'initial_configuration',
  'owner_correction',
  'provider_incident_recovery',
]);
const OWNER_RECEIVER_HOLDER_PATTERN =
  /^[^\s\u0000-\u001f\u007f](?:[^\u0000-\u001f\u007f]{0,158}[^\s\u0000-\u001f\u007f])?$/u;
const OWNER_RECEIVER_REFERENCE_PATTERN = /^[0-9]{9,24}$/u;
const INTERACTIVE_SESSION_CACHE_TTL_MS = 5_000;
const INTERACTIVE_SESSION_CACHE_MAX_ENTRIES = 8;

interface InteractiveSessionCacheEntry<T> {
  readonly expiresAtMs: number;
  readonly value: Promise<T>;
}

function exactRawHeader(rawHeaders: readonly string[], name: string): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      const value = rawHeaders[index + 1];
      if (value !== undefined) values.push(value);
    }
  }
  return values.length === 1 ? values[0] : undefined;
}

function exactIsoDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : undefined;
}

function projectKemerbetReadinessCohortReceipt(value: unknown) {
  const receipt = exactObject(value, [
    'alreadyPrepared',
    'identifiersRedacted',
    'moneyMoved',
    'playersPrepared',
    'transferDisabled',
  ]);
  if (
    typeof receipt?.alreadyPrepared !== 'boolean' ||
    receipt.identifiersRedacted !== true ||
    receipt.moneyMoved !== false ||
    receipt.playersPrepared !== 5 ||
    receipt.transferDisabled !== true
  ) {
    throw new OwnerKemerbetReadinessCohortUnavailableError();
  }
  return {
    alreadyPrepared: receipt.alreadyPrepared,
    identifiersRedacted: true,
    moneyMoved: false,
    playersPrepared: 5,
    transferDisabled: true,
  } as const;
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

export function buildOwnerControlApp(
  config: OwnerControlConfig,
  dependencies: OwnerControlAppDependencies,
) {
  if (!config.runtime.enabled) throw new Error('The Owner-control runtime is disabled.');
  const runtimeConfig = config.runtime;
  const kemerbetReadinessCohortControl =
    dependencies.kemerbetReadinessCohortControl ?? new FileOwnerKemerbetReadinessCohortControl();
  const kemerbetSessionControl =
    dependencies.kemerbetSessionControl ?? new UnixOwnerKemerbetSessionControl();
  const privatePilotMutationOrigins = new Set([
    'https://owner.fetanagent.com',
    `http://127.0.0.1:${config.server.port}`,
    `http://localhost:${config.server.port}`,
  ]);
  const app = Fastify({
    bodyLimit: 4 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers', 'req.body', 'res.body', '*.token', '*.inviteUrl', '*.password'],
        censor: '[REDACTED]',
      },
    },
  });
  const interactiveOwnerSubjects = new Map<string, InteractiveSessionCacheEntry<string>>();
  const interactiveKemerbetProfiles = new Map<string, InteractiveSessionCacheEntry<string>>();
  let kemerbetProfileLifecycleLane = Promise.resolve();

  function serializeKemerbetProfileLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = kemerbetProfileLifecycleLane.then(operation, operation);
    kemerbetProfileLifecycleLane = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function interactiveCacheNowMs(): number {
    return dependencies.now ? dependencies.now().getTime() : performance.now();
  }

  function cachedInteractiveValue<T>(
    cache: Map<string, InteractiveSessionCacheEntry<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const timestamp = interactiveCacheNowMs();
    for (const [candidateKey, entry] of cache) {
      if (entry.expiresAtMs <= timestamp) cache.delete(candidateKey);
    }
    const cached = cache.get(key);
    if (cached && cached.expiresAtMs > timestamp) return cached.value;

    const value = load();
    const entry = { expiresAtMs: timestamp + INTERACTIVE_SESSION_CACHE_TTL_MS, value };
    cache.set(key, entry);
    while (cache.size > INTERACTIVE_SESSION_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    void value.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
    return value;
  }

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store, max-age=0').header('pragma', 'no-cache');
    return payload;
  });

  const browserHeaders = {
    'content-security-policy': OWNER_DASHBOARD_CONTENT_SECURITY_POLICY,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  } as const;

  app.get('/owner', async (_request, reply) =>
    reply.headers(browserHeaders).type('text/html; charset=utf-8').send(OWNER_DASHBOARD_HTML),
  );
  app.get('/owner/app.js', async (_request, reply) =>
    reply
      .headers(browserHeaders)
      .type('text/javascript; charset=utf-8')
      .send(OWNER_DASHBOARD_JAVASCRIPT),
  );
  app.get('/owner/styles.css', async (_request, reply) =>
    reply.headers(browserHeaders).type('text/css; charset=utf-8').send(OWNER_DASHBOARD_CSS),
  );
  app.get('/owner/config.json', async (_request, reply) =>
    reply.headers(browserHeaders).send(ownerDashboardPublicConfig(runtimeConfig)),
  );
  app.setErrorHandler((error, request, reply) => {
    const code = statusCode(error);
    if (code !== undefined && code >= 400 && code < 500) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    request.log.warn('Owner control request handling is unavailable.');
    return reply.code(503).send({ error: 'owner_control_unavailable' });
  });

  async function ownerSubject(rawHeaders: readonly string[]): Promise<string> {
    const token = bearerTokenFromRawHeaders(rawHeaders);
    if (!token) throw new OwnerAuthenticationRejectedError();
    const verified = await verifyOwnerBearerToken(
      token,
      {
        publishableKey: runtimeConfig.publishableKey,
        supabaseUrl: runtimeConfig.supabaseUrl,
      },
      dependencies.fetch,
    );
    return verified.authUserId;
  }

  async function interactiveOwnerSubject(rawHeaders: readonly string[]): Promise<string> {
    const token = bearerTokenFromRawHeaders(rawHeaders);
    if (!token) throw new OwnerAuthenticationRejectedError();
    const tokenDigest = createHash('sha256').update(token, 'utf8').digest('hex');
    return cachedInteractiveValue(interactiveOwnerSubjects, tokenDigest, async () => {
      const verified = await verifyOwnerBearerToken(
        token,
        {
          publishableKey: runtimeConfig.publishableKey,
          supabaseUrl: runtimeConfig.supabaseUrl,
        },
        dependencies.fetch,
      );
      return verified.authUserId;
    });
  }

  function validPrivatePilotMutationHeaders(
    rawHeaders: readonly string[],
    requestId: unknown,
  ): boolean {
    return (
      typeof requestId === 'string' &&
      UUID_V4_PATTERN.test(requestId) &&
      exactRawHeader(rawHeaders, 'content-type') === 'application/json' &&
      privatePilotMutationOrigins.has(exactRawHeader(rawHeaders, 'origin') ?? '') &&
      exactRawHeader(rawHeaders, 'x-fetanagent-owner-csrf') === OWNER_PILOT_CSRF_HEADER_VALUE &&
      exactRawHeader(rawHeaders, 'x-idempotency-key') === requestId
    );
  }

  function validReceiverMutationHeaders(
    rawHeaders: readonly string[],
    requestId: unknown,
  ): boolean {
    return (
      typeof requestId === 'string' &&
      UUID_V4_PATTERN.test(requestId) &&
      exactRawHeader(rawHeaders, 'content-type') === 'application/json' &&
      privatePilotMutationOrigins.has(exactRawHeader(rawHeaders, 'origin') ?? '') &&
      exactRawHeader(rawHeaders, 'x-fetanagent-owner-csrf') === OWNER_RECEIVER_CSRF_HEADER_VALUE &&
      exactRawHeader(rawHeaders, 'x-idempotency-key') === requestId
    );
  }

  function validKemerbetAgentProfileMutationHeaders(
    rawHeaders: readonly string[],
    requestId: unknown,
  ): boolean {
    return (
      typeof requestId === 'string' &&
      UUID_V4_PATTERN.test(requestId) &&
      exactRawHeader(rawHeaders, 'content-type') === 'application/json' &&
      privatePilotMutationOrigins.has(exactRawHeader(rawHeaders, 'origin') ?? '') &&
      exactRawHeader(rawHeaders, 'x-fetanagent-owner-csrf') ===
        OWNER_KEMERBET_AGENT_CSRF_HEADER_VALUE &&
      exactRawHeader(rawHeaders, 'x-idempotency-key') === requestId
    );
  }

  function validKemerbetSessionMutationHeaders(
    rawHeaders: readonly string[],
    requestId: unknown,
  ): boolean {
    return (
      typeof requestId === 'string' &&
      UUID_V4_PATTERN.test(requestId) &&
      exactRawHeader(rawHeaders, 'content-type') === 'application/json' &&
      privatePilotMutationOrigins.has(exactRawHeader(rawHeaders, 'origin') ?? '') &&
      exactRawHeader(rawHeaders, 'x-fetanagent-owner-csrf') ===
        OWNER_KEMERBET_SESSION_CSRF_HEADER_VALUE &&
      exactRawHeader(rawHeaders, 'x-idempotency-key') === requestId
    );
  }

  function validKemerbetReadinessCohortMutationHeaders(
    rawHeaders: readonly string[],
    requestId: unknown,
  ): boolean {
    return (
      typeof requestId === 'string' &&
      UUID_V4_PATTERN.test(requestId) &&
      exactRawHeader(rawHeaders, 'content-type') === 'application/json' &&
      privatePilotMutationOrigins.has(exactRawHeader(rawHeaders, 'origin') ?? '') &&
      exactRawHeader(rawHeaders, 'x-fetanagent-owner-csrf') ===
        OWNER_KEMERBET_READINESS_COHORT_CSRF_HEADER_VALUE &&
      exactRawHeader(rawHeaders, 'x-idempotency-key') === requestId
    );
  }

  async function activeKemerbetAgentProfileId(authUserId: string): Promise<string> {
    const profiles = await dependencies.runtime.kemerbetAgentProfiles.list(authUserId);
    const active = profiles.filter((profile) => profile.profileStatus === 'active');
    if (active.length !== 1) throw new OwnerKemerbetSessionRejectedError();
    return active[0]!.platformAgentAccountId;
  }

  async function interactiveKemerbetAgentProfileId(authUserId: string): Promise<string> {
    return cachedInteractiveValue(interactiveKemerbetProfiles, authUserId, () =>
      activeKemerbetAgentProfileId(authUserId),
    );
  }

  async function kemerbetReadinessLifecycle(): Promise<OwnerKemerbetReadinessLifecycleState> {
    if (typeof kemerbetReadinessCohortControl.lifecycle === 'function') {
      return kemerbetReadinessCohortControl.lifecycle();
    }
    return (await kemerbetReadinessCohortControl.rootReceipt())?.event ?? 'empty';
  }

  type KemerbetStateMutationMode =
    'ordinary' | 'private_session' | 'readiness_cohort' | 'security_recovery';
  type KemerbetStateMutationResult<T> =
    | { readonly state: 'blocked' }
    | {
        readonly securityRecoverySessionAllowed: boolean;
        readonly state: 'completed';
        readonly value: T;
      };

  async function runKemerbetStateMutation<T>(
    mode: KemerbetStateMutationMode,
    mutation: () => Promise<T>,
  ): Promise<KemerbetStateMutationResult<T>> {
    return serializeKemerbetProfileLifecycle(async () => {
      const lifecycle = await kemerbetReadinessLifecycle();
      if (
        lifecycle === 'recheck_authorization_spent_failed_terminal' ||
        (lifecycle === 'security_recovery_cohort_staged' && mode !== 'private_session') ||
        lifecycle === 'imported' ||
        lifecycle === 'retryable_failed' ||
        ((mode === 'ordinary' || mode === 'private_session') &&
          (lifecycle === 'security_recovery_failed_terminal' ||
            lifecycle === 'security_recovery_profile_finalized')) ||
        (mode === 'readiness_cohort' && lifecycle === 'security_recovery_failed_terminal') ||
        (mode === 'security_recovery' && lifecycle !== 'security_recovery_failed_terminal')
      ) {
        return { state: 'blocked' };
      }
      return {
        securityRecoverySessionAllowed:
          mode === 'private_session' && lifecycle === 'security_recovery_cohort_staged',
        state: 'completed',
        value: await mutation(),
      };
    });
  }

  function kemerbetSessionPayload(
    session: OwnerKemerbetSessionStatus,
    securityRecoverySessionAllowed: boolean,
  ): {
    readonly securityRecoverySessionAllowed?: true;
    readonly session: OwnerKemerbetSessionStatus;
  } {
    return securityRecoverySessionAllowed && session.quarantine === undefined
      ? { securityRecoverySessionAllowed: true, session }
      : { session };
  }

  app.post('/v1/owner/telegram-beta-invites', async (request, reply) => {
    try {
      const body = exactObject(request.body, ['expiresInSeconds']);
      const expiresInSeconds = body?.expiresInSeconds;
      if (
        !Number.isSafeInteger(expiresInSeconds) ||
        // Keep a one-minute transport margin above the database's five-minute minimum.
        (expiresInSeconds as number) < 360 ||
        (expiresInSeconds as number) > 604_800
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await ownerSubject(request.raw.rawHeaders);
      const now = dependencies.now?.() ?? new Date();
      const invite = await dependencies.runtime.invites.issue(
        authUserId,
        new Date(now.getTime() + (expiresInSeconds as number) * 1_000),
        config.botUsername,
      );
      return reply.code(201).send(invite);
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerInviteRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (
        error instanceof OwnerAuthenticationUnavailableError ||
        error instanceof OwnerInviteUnavailableError
      ) {
        request.log.warn('Owner beta-invite issuance is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
      request.log.warn('Owner beta-invite issuance is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post<{ Params: { inviteId: string } }>(
    '/v1/owner/telegram-beta-invites/:inviteId/revoke',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['reasonCode']);
        const reasonCode = body?.reasonCode;
        if (
          typeof reasonCode !== 'string' ||
          !REVOCATION_REASONS.has(reasonCode as BetaInviteRevocationReason)
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        await dependencies.runtime.invites.revoke(
          authUserId,
          request.params.inviteId,
          reasonCode as BetaInviteRevocationReason,
        );
        return reply.code(204).send();
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerInviteRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner beta-invite revocation is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/v1/owner/dry-run-deposit-intake',
    async (request, reply) => {
      try {
        if (Object.keys(request.query).some((key) => key !== 'limit')) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const deposits = await dependencies.runtime.deposits.list(authUserId, limit);
        return reply.code(200).send({ deposits });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerDepositIntakeRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (error instanceof OwnerDepositIntakeUnavailableError) {
          request.log.warn('Owner dry-run deposit intake is unavailable.');
        }
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.post<{ Params: { depositIntentId: string } }>(
    '/v1/owner/dry-run-deposit-intake/:depositIntentId/fixture-assessments',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['fixtureId']);
        const fixtureId = body?.fixtureId;
        if (typeof fixtureId !== 'string' || !DRY_RUN_FIXTURE_IDS.has(fixtureId)) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const deposits = await dependencies.runtime.deposits.list(authUserId, 50);
        const deposit = deposits.find(
          (item) => item.depositIntentId === request.params.depositIntentId,
        );
        if (!deposit) return reply.code(403).send({ error: 'forbidden' });
        const assessment = await dependencies.runtime.assessments.assess(
          authUserId,
          deposit,
          fixtureId,
          dependencies.now?.() ?? new Date(),
        );
        return reply.code(201).send(assessment);
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerDepositIntakeRejectedError ||
          error instanceof OwnerDryRunFixtureAssessmentRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner dry-run fixture assessment is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/v1/owner/dry-run-fixture-assessments',
    async (request, reply) => {
      try {
        if (Object.keys(request.query).some((key) => key !== 'limit')) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const assessments = await dependencies.runtime.assessments.list(authUserId, limit);
        return reply.code(200).send({ assessments });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerDryRunFixtureAssessmentRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (error instanceof OwnerDryRunFixtureAssessmentUnavailableError) {
          request.log.warn('Owner dry-run fixture assessment list is unavailable.');
        }
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.post<{ Params: { assessmentId: string } }>(
    '/v1/owner/dry-run-fixture-assessments/:assessmentId/review',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['decision']);
        const decision = body?.decision;
        if (
          typeof decision !== 'string' ||
          !DRY_RUN_FIXTURE_REVIEW_DECISIONS.has(decision as OwnerDryRunFixtureReviewDecision)
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const receipt = await dependencies.runtime.assessments.review(
          authUserId,
          request.params.assessmentId,
          decision as OwnerDryRunFixtureReviewDecision,
        );
        return reply.code(200).send(receipt);
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerDryRunFixtureAssessmentRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner dry-run fixture review is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/v1/owner/player-registration-requests',
    async (request, reply) => {
      try {
        const queryKeys = Object.keys(request.query);
        if (queryKeys.some((key) => key !== 'limit')) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const rawLimit = request.query.limit;
        const limit = rawLimit === undefined ? 25 : Number(rawLimit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const requests = await dependencies.runtime.playerRegistrations.list(authUserId, limit);
        return reply.code(200).send({ requests });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPlayerRegistrationReviewRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner Player ID review queue is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.post<{ Params: { requestId: string } }>(
    '/v1/owner/player-registration-requests/:requestId/review',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['decision']);
        const decision = body?.decision;
        if (
          typeof decision !== 'string' ||
          !PLAYER_REGISTRATION_DECISIONS.has(decision as OwnerPlayerRegistrationDecision)
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const mutation = await runKemerbetStateMutation('ordinary', () =>
          dependencies.runtime.playerRegistrations.review(
            authUserId,
            request.params.requestId,
            decision as OwnerPlayerRegistrationDecision,
          ),
        );
        return mutation.state === 'blocked'
          ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
          : reply.code(200).send(mutation.value);
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPlayerRegistrationReviewRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (error instanceof OwnerPlayerRegistrationReviewUnavailableError) {
          request.log.warn('Owner Player ID review is unavailable.');
          return reply.code(503).send({ error: 'owner_control_unavailable' });
        }
        request.log.warn('Owner Player ID review is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/v1/owner/player-registration-association-candidates',
    async (request, reply) => {
      try {
        if (Object.keys(request.query).some((key) => key !== 'limit')) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const candidates = await dependencies.runtime.playerRegistrations.listAssociationCandidates(
          authUserId,
          limit,
        );
        return reply.code(200).send({ candidates });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPlayerRegistrationReviewRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner Player ID association queue is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.post<{ Params: { requestId: string } }>(
    '/v1/owner/player-registration-requests/:requestId/associate',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['confirmation']);
        if (body?.confirmation !== 'owner_verified_platform_ownership') {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const mutation = await runKemerbetStateMutation('ordinary', () =>
          dependencies.runtime.playerRegistrations.associate(authUserId, request.params.requestId),
        );
        return mutation.state === 'blocked'
          ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
          : reply.code(200).send(mutation.value);
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPlayerRegistrationReviewRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner Player ID association is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/v1/owner/player-deposit-eligibility',
    async (request, reply) => {
      try {
        if (Object.keys(request.query).some((key) => key !== 'limit')) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const players = await dependencies.runtime.eligibility.list(authUserId, limit);
        return reply.code(200).send({ players });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPlayerDepositEligibilityRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner Player-ID deposit-eligibility list is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.post('/v1/owner/kemerbet-readiness-cohort/prepare', async (request, reply) => {
    try {
      const body = exactObject(request.body, ['confirmation', 'requestId']);
      if (
        typeof request.query !== 'object' ||
        request.query === null ||
        Object.keys(request.query).length !== 0 ||
        body?.confirmation !== 'owner_confirmed_kemerbet_readiness_five_player_no_transfer' ||
        !validKemerbetReadinessCohortMutationHeaders(request.raw.rawHeaders, body?.requestId)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await ownerSubject(request.raw.rawHeaders);
      request.log.info({ phase: 'auth_complete' }, 'Owner readiness phase completed.');
      const mutation = await runKemerbetStateMutation('readiness_cohort', async () => {
        request.log.info({ phase: 'lane_entered' }, 'Owner readiness phase completed.');
        const requestId = body.requestId as string;
        // Reconcile any exact root-owned import/completion receipt before deciding whether the
        // one-use input is still absent. This closes the crash window where root consumed the files
        // before the Owner request could persist its exported transition.
        const reconciliation = await reconcileOwnerKemerbetReadinessRootReceipt(
          kemerbetReadinessCohortControl,
          dependencies.runtime.kemerbetReadinessCohorts,
        );
        if (reconciliation === 'security_recovery_required') {
          return undefined;
        }
        const openPilot = await dependencies.runtime.privateLivePilot.current(authUserId);
        if (openPilot?.pilotStatus === 'draft' || openPilot?.pilotStatus === 'armed') {
          return { state: 'open_pilot' as const };
        }
        const claim = await dependencies.runtime.kemerbetReadinessCohorts.claim(
          authUserId,
          requestId,
        );
        request.log.info({ phase: 'claim_complete' }, 'Owner readiness phase completed.');
        if (claim.state === 'failed_terminal') {
          throw new OwnerKemerbetReadinessCohortRejectedError();
        }
        let prepared: OwnerKemerbetReadinessCohortReceipt;
        if (claim.state === 'prepared') {
          prepared = projectKemerbetReadinessCohortReceipt(
            await kemerbetReadinessCohortControl.prepare(claim.players, requestId, claim.claimId),
          );
          request.log.info({ phase: 'files_published' }, 'Owner readiness phase completed.');
          await dependencies.runtime.kemerbetReadinessCohorts.markExported(
            authUserId,
            requestId,
            claim.claimId,
          );
          request.log.info({ phase: 'export_marked' }, 'Owner readiness phase completed.');
        } else {
          const lifecycle = await kemerbetReadinessLifecycle();
          if (
            !new Set<OwnerKemerbetReadinessLifecycleState>([
              'completed',
              'imported',
              'retryable_failed',
              'security_recovery_cohort_staged',
              'staged',
            ]).has(lifecycle)
          ) {
            // Never claim that a prior export succeeded when neither the frozen stage nor a root
            // receipt exists. The same request ID remains safe to reconcile after repair.
            throw new OwnerKemerbetReadinessCohortUnavailableError();
          }
          prepared = projectKemerbetReadinessCohortReceipt({
            alreadyPrepared: true,
            identifiersRedacted: true,
            moneyMoved: false,
            playersPrepared: 5,
            transferDisabled: true,
          });
          request.log.info({ phase: 'stage_reconciled' }, 'Owner readiness phase completed.');
        }
        return { receipt: prepared, state: 'prepared' as const };
      });
      if (mutation.state === 'blocked' || mutation.value === undefined) {
        return reply.code(409).send({ error: 'kemerbet_security_recovery_required' });
      }
      if (mutation.value.state === 'open_pilot') {
        return reply.code(409).send({ error: 'readiness_cohort_open_pilot' });
      }
      return reply
        .code(mutation.value.receipt.alreadyPrepared ? 200 : 201)
        .send(mutation.value.receipt);
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerPlayerDepositEligibilityRejectedError ||
        error instanceof OwnerPrivateLivePilotRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (error instanceof OwnerKemerbetReadinessCohortRejectedError) {
        return reply.code(409).send({ error: 'readiness_cohort_not_ready' });
      }
      if (
        error instanceof OwnerAuthenticationUnavailableError ||
        error instanceof OwnerPlayerDepositEligibilityUnavailableError ||
        error instanceof OwnerPrivateLivePilotUnavailableError ||
        error instanceof OwnerKemerbetReadinessCohortUnavailableError
      ) {
        request.log.warn('Owner KemerBet readiness-cohort preparation is unavailable.');
      }
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post<{ Params: { playerAccountId: string } }>(
    '/v1/owner/player-deposit-eligibility/:playerAccountId/decide',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['confirmation', 'decision']);
        const decision = body?.decision;
        if (
          typeof decision !== 'string' ||
          !PLAYER_DEPOSIT_ELIGIBILITY_DECISIONS.has(
            decision as OwnerPlayerDepositEligibilityDecision,
          ) ||
          body?.confirmation !==
            (decision === 'eligible'
              ? 'owner_confirmed_financial_eligibility'
              : 'owner_confirmed_financial_revocation')
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const mutation = await runKemerbetStateMutation('ordinary', () =>
          dependencies.runtime.eligibility.decide(
            authUserId,
            request.params.playerAccountId,
            decision as OwnerPlayerDepositEligibilityDecision,
          ),
        );
        return mutation.state === 'blocked'
          ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
          : reply.code(200).send(mutation.value);
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPlayerDepositEligibilityRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (error instanceof OwnerPlayerDepositEligibilityUnavailableError) {
          request.log.warn('Owner Player-ID deposit-eligibility decision is unavailable.');
          return reply.code(503).send({ error: 'owner_control_unavailable' });
        }
        request.log.warn('Owner Player-ID deposit-eligibility decision is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get<{ Querystring: Record<string, string> }>(
    '/v1/owner/receiver-accounts',
    async (request, reply) => {
      try {
        if (Object.keys(request.query).length !== 0) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const receivers = await dependencies.runtime.receivers.list(authUserId);
        return reply.code(200).send({ receivers });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerReceiverAccountRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (
          error instanceof OwnerAuthenticationUnavailableError ||
          error instanceof OwnerReceiverAccountUnavailableError
        ) {
          request.log.warn('Owner receiver-account history is unavailable.');
        }
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.post('/v1/owner/receiver-accounts/rotate', async (request, reply) => {
    try {
      const body = exactObject(request.body, [
        'accountHolderName',
        'accountReference',
        'confirmation',
        'providerCode',
        'requestId',
        'rotationReason',
      ]);
      const providerCode = body?.providerCode;
      const rotationReason = body?.rotationReason;
      if (
        body?.confirmation !== 'owner_confirmed_receiver_rotation' ||
        typeof providerCode !== 'string' ||
        !OWNER_RECEIVER_PROVIDERS.has(providerCode as OwnerReceiverProvider) ||
        typeof rotationReason !== 'string' ||
        !OWNER_RECEIVER_ROTATION_REASONS.has(rotationReason as OwnerReceiverRotationReason) ||
        typeof body.accountHolderName !== 'string' ||
        !OWNER_RECEIVER_HOLDER_PATTERN.test(body.accountHolderName) ||
        typeof body.accountReference !== 'string' ||
        !OWNER_RECEIVER_REFERENCE_PATTERN.test(body.accountReference) ||
        !validReceiverMutationHeaders(request.raw.rawHeaders, body.requestId)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await ownerSubject(request.raw.rawHeaders);
      const mutation = await runKemerbetStateMutation('ordinary', () =>
        dependencies.runtime.receivers.rotate(authUserId, {
          accountHolderName: body.accountHolderName as string,
          accountReference: body.accountReference as string,
          providerCode: providerCode as OwnerReceiverProvider,
          requestId: body.requestId as string,
          rotationReason: rotationReason as OwnerReceiverRotationReason,
        }),
      );
      return mutation.state === 'blocked'
        ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
        : reply.code(201).send({ receiver: mutation.value });
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerReceiverAccountRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      request.log.warn('Owner receiver-account rotation is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.get('/v1/owner/kemerbet-agent-profiles', async (request, reply) => {
    try {
      if (
        typeof request.query !== 'object' ||
        request.query === null ||
        Object.keys(request.query).length !== 0
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await ownerSubject(request.raw.rawHeaders);
      const profiles = await dependencies.runtime.kemerbetAgentProfiles.list(authUserId);
      return reply.code(200).send({ profiles });
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerKemerbetAgentProfileRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (
        error instanceof OwnerAuthenticationUnavailableError ||
        error instanceof OwnerKemerbetAgentProfileUnavailableError
      ) {
        request.log.warn('Owner KemerBet agent-profile history is unavailable.');
      }
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post('/v1/owner/kemerbet-agent-profiles/prepare', async (request, reply) => {
    try {
      const body = exactObject(request.body, ['configurationReason', 'confirmation', 'requestId']);
      const configurationReason = body?.configurationReason;
      if (
        body?.confirmation !== 'owner_confirmed_kemerbet_agent_profile' ||
        typeof configurationReason !== 'string' ||
        !OWNER_KEMERBET_AGENT_PROFILE_REASONS.has(
          configurationReason as OwnerKemerbetAgentProfileReason,
        ) ||
        !validKemerbetAgentProfileMutationHeaders(request.raw.rawHeaders, body.requestId)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await ownerSubject(request.raw.rawHeaders);
      const mutationMode: KemerbetStateMutationMode =
        configurationReason === 'security_recovery' ? 'security_recovery' : 'ordinary';
      const mutation = await runKemerbetStateMutation(mutationMode, async () => {
        const currentProfiles = await dependencies.runtime.kemerbetAgentProfiles.list(authUserId);
        const currentActiveProfiles = currentProfiles.filter(
          (candidate) => candidate.profileStatus === 'active',
        );
        if (currentActiveProfiles.length > 1) {
          throw new OwnerKemerbetAgentProfileUnavailableError();
        }
        const currentActiveProfile = currentActiveProfiles[0];
        if (typeof kemerbetReadinessCohortControl.lifecycle !== 'function') {
          throw new OwnerKemerbetAgentProfileUnavailableError();
        }
        const readinessLifecycle = await kemerbetReadinessCohortControl.lifecycle();
        if (readinessLifecycle === 'security_recovery_failed_terminal') {
          if (configurationReason !== 'security_recovery') {
            throw new OwnerKemerbetAgentProfileRejectedError();
          }
          if (
            !currentActiveProfile ||
            typeof dependencies.runtime.kemerbetAgentProfiles.recover !== 'function' ||
            typeof kemerbetReadinessCohortControl.acknowledgeSecurityRecovery !== 'function'
          ) {
            throw new OwnerKemerbetAgentProfileUnavailableError();
          }
          const rootReceipt = await kemerbetReadinessCohortControl.rootReceipt();
          if (rootReceipt?.event !== 'security_recovery_failed_terminal') {
            throw new OwnerKemerbetAgentProfileUnavailableError();
          }
          const recovery = await dependencies.runtime.kemerbetAgentProfiles.recover(authUserId, {
            claimId: rootReceipt.claimId,
            receiptId: body.requestId as string,
          });
          await kemerbetReadinessCohortControl.acknowledgeSecurityRecovery({
            claimId: recovery.claimId,
            platformAgentAccountId: recovery.profile.platformAgentAccountId,
            profileRevision: recovery.profile.profileRevision,
            receiptId: recovery.receiptId,
          });
          interactiveKemerbetProfiles.delete(authUserId);
          return recovery.profile;
        }
        if (configurationReason === 'security_recovery') {
          throw new OwnerKemerbetAgentProfileRejectedError();
        }
        if (readinessLifecycle !== 'empty' && readinessLifecycle !== 'completed') {
          throw new OwnerKemerbetAgentProfileRejectedError();
        }
        if (currentActiveProfile) {
          const currentSession = await kemerbetSessionControl.status(
            currentActiveProfile.platformAgentAccountId,
          );
          if (currentSession.active) return undefined;
          const exactQuarantineObserved = exactOwnerKemerbetSessionQuarantine(currentSession);
          if (exactQuarantineObserved) {
            throw new OwnerKemerbetAgentProfileRejectedError();
          }
        }
        const profile = await dependencies.runtime.kemerbetAgentProfiles.prepare(authUserId, {
          configurationReason: configurationReason as OwnerKemerbetAgentProfileReason,
          requestId: body.requestId as string,
        });
        interactiveKemerbetProfiles.delete(authUserId);
        return profile;
      });
      if (mutation.state === 'blocked') {
        return mutationMode === 'security_recovery'
          ? reply.code(403).send({ error: 'forbidden' })
          : reply.code(409).send({ error: 'kemerbet_security_recovery_required' });
      }
      return mutation.value === undefined
        ? reply.code(409).send({ error: 'kemerbet_session_must_stop' })
        : reply.code(201).send({ profile: mutation.value });
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerKemerbetAgentProfileRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      request.log.warn('Owner KemerBet agent-profile preparation is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.get('/v1/owner/kemerbet-session', async (request, reply) => {
    try {
      if (
        typeof request.query !== 'object' ||
        request.query === null ||
        Object.keys(request.query).length !== 0
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await interactiveOwnerSubject(request.raw.rawHeaders);
      const payload = await serializeKemerbetProfileLifecycle(async () => {
        const lifecycle = await kemerbetReadinessLifecycle();
        if (lifecycle === 'recheck_authorization_spent_failed_terminal') {
          return { session: OWNER_KEMERBET_RECHECK_SPENT_TERMINAL_SESSION };
        }
        if (lifecycle === 'security_recovery_failed_terminal') {
          return { session: OWNER_KEMERBET_SECURITY_RECOVERY_SESSION };
        }
        if (lifecycle === 'security_recovery_profile_finalized') {
          return { session: OWNER_KEMERBET_SECURITY_RECOVERY_COHORT_REQUIRED_SESSION };
        }
        if (lifecycle === 'security_recovery_cohort_staged') {
          const accountId = await interactiveKemerbetAgentProfileId(authUserId);
          return kemerbetSessionPayload(await kemerbetSessionControl.status(accountId), true);
        }
        if (lifecycle === 'imported' || lifecycle === 'retryable_failed') {
          return { session: OWNER_KEMERBET_SECURITY_RECOVERY_IN_PROGRESS_SESSION };
        }
        const accountId = await interactiveKemerbetAgentProfileId(authUserId);
        return { session: await kemerbetSessionControl.status(accountId) };
      });
      return reply.code(200).send(payload);
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerKemerbetAgentProfileRejectedError ||
        error instanceof OwnerKemerbetSessionRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      request.log.warn('Owner KemerBet session status is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.get('/v1/owner/kemerbet-session/frame', async (request, reply) => {
    try {
      const query = exactObject(request.query, ['after', 'generation']);
      const generation = query?.generation;
      const afterValue = query?.after;
      if (
        typeof generation !== 'string' ||
        !UUID_V4_PATTERN.test(generation) ||
        typeof afterValue !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,9})$/u.test(afterValue)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const after = Number(afterValue);
      if (!Number.isSafeInteger(after)) return reply.code(400).send({ error: 'invalid_request' });
      const authUserId = await interactiveOwnerSubject(request.raw.rawHeaders);
      const mutation = await runKemerbetStateMutation('private_session', async () => {
        const accountId = await interactiveKemerbetAgentProfileId(authUserId);
        return kemerbetSessionControl.frame(accountId, generation, after);
      });
      if (mutation.state === 'blocked') {
        return reply.code(409).send({ error: 'kemerbet_security_recovery_required' });
      }
      const frame = mutation.value;
      if (!frame) return reply.code(204).send();
      return reply
        .header('cache-control', 'no-store, max-age=0')
        .header('x-fetanagent-frame-sequence', String(frame.sequence))
        .header('x-fetanagent-session-generation', frame.generation)
        .type('image/jpeg')
        .code(200)
        .send(frame.image);
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerKemerbetAgentProfileRejectedError ||
        error instanceof OwnerKemerbetSessionRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      request.log.warn('Owner KemerBet session frame is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post('/v1/owner/kemerbet-session/start', async (request, reply) => {
    try {
      const body = exactObject(request.body, ['confirmation', 'requestId']);
      if (
        body?.confirmation !== 'owner_confirmed_private_kemerbet_sign_in' ||
        !validKemerbetSessionMutationHeaders(request.raw.rawHeaders, body.requestId)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await interactiveOwnerSubject(request.raw.rawHeaders);
      const mutation = await runKemerbetStateMutation('private_session', async () => {
        const accountId = await interactiveKemerbetAgentProfileId(authUserId);
        return kemerbetSessionControl.start(accountId, body.requestId as string);
      });
      return mutation.state === 'blocked'
        ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
        : reply
            .code(202)
            .send(kemerbetSessionPayload(mutation.value, mutation.securityRecoverySessionAllowed));
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerKemerbetAgentProfileRejectedError ||
        error instanceof OwnerKemerbetSessionRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      request.log.warn('Owner KemerBet session start is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post('/v1/owner/kemerbet-session/input', async (request, reply) => {
    try {
      const candidate = request.body as Record<string, unknown> | undefined;
      const body =
        candidate?.kind === 'pointer'
          ? exactObject(candidate, [
              'frameSequence',
              'kind',
              'requestId',
              'sessionGeneration',
              'x',
              'y',
            ])
          : candidate?.kind === 'key'
            ? exactObject(candidate, [
                'frameSequence',
                'key',
                'kind',
                'requestId',
                'sessionGeneration',
              ])
            : candidate?.kind === 'text'
              ? exactObject(candidate, [
                  'frameSequence',
                  'kind',
                  'requestId',
                  'sessionGeneration',
                  'text',
                ])
              : undefined;
      const pointerValid =
        body?.kind === 'pointer' &&
        Number.isInteger(body.x) &&
        Number(body.x) >= 0 &&
        Number(body.x) < 1280 &&
        Number.isInteger(body.y) &&
        Number(body.y) >= 0 &&
        Number(body.y) < 720;
      const keyValid =
        body?.kind === 'key' &&
        typeof body.key === 'string' &&
        (['Backspace', 'Delete', 'Enter', 'Escape', 'Tab'].includes(body.key) ||
          (/^[\u0020-\u007e]$/u.test(body.key) && body.key !== '`'));
      const textValid =
        body?.kind === 'text' &&
        typeof body.text === 'string' &&
        /^[\u0020-\u007e]{1,64}$/u.test(body.text) &&
        !body.text.includes('`');
      if (
        (!pointerValid && !keyValid && !textValid) ||
        typeof body?.sessionGeneration !== 'string' ||
        !UUID_V4_PATTERN.test(body.sessionGeneration) ||
        !Number.isSafeInteger(body.frameSequence) ||
        Number(body.frameSequence) < 1 ||
        !validKemerbetSessionMutationHeaders(request.raw.rawHeaders, body?.requestId)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await interactiveOwnerSubject(request.raw.rawHeaders);
      const mutation = await runKemerbetStateMutation('private_session', async () => {
        const accountId = await interactiveKemerbetAgentProfileId(authUserId);
        return kemerbetSessionControl.input(
          accountId,
          body as unknown as OwnerKemerbetSessionInput,
        );
      });
      return mutation.state === 'blocked'
        ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
        : reply
            .code(200)
            .send(kemerbetSessionPayload(mutation.value, mutation.securityRecoverySessionAllowed));
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerKemerbetAgentProfileRejectedError ||
        error instanceof OwnerKemerbetSessionRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      request.log.warn('Owner KemerBet session input is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post('/v1/owner/kemerbet-session/stop', async (request, reply) => {
    try {
      const body = exactObject(request.body, ['confirmation', 'requestId']);
      if (
        body?.confirmation !== 'owner_confirmed_stop_private_kemerbet_session' ||
        !validKemerbetSessionMutationHeaders(request.raw.rawHeaders, body.requestId)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await interactiveOwnerSubject(request.raw.rawHeaders);
      const mutation = await runKemerbetStateMutation('private_session', async () => {
        const accountId = await interactiveKemerbetAgentProfileId(authUserId);
        return kemerbetSessionControl.stop(accountId, body.requestId as string);
      });
      return mutation.state === 'blocked'
        ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
        : reply
            .code(202)
            .send(kemerbetSessionPayload(mutation.value, mutation.securityRecoverySessionAllowed));
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerKemerbetAgentProfileRejectedError ||
        error instanceof OwnerKemerbetSessionRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (error instanceof OwnerKemerbetSessionUnavailableError) {
        request.log.warn('Owner KemerBet session stop is unavailable.');
      }
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post('/v1/owner/private-live-deposit-pilots/prepare', async (request, reply) => {
    try {
      const body = exactObject(request.body, [
        'activeFrom',
        'confirmation',
        'expiresAt',
        'playerIds',
        'requestId',
      ]);
      const activeFrom = exactIsoDate(body?.activeFrom);
      const expiresAt = exactIsoDate(body?.expiresAt);
      const playerIds = body?.playerIds;
      if (
        !body ||
        body.confirmation !== 'owner_confirmed_fixed_telebirr_five_player_pilot' ||
        !activeFrom ||
        !expiresAt ||
        expiresAt.getTime() !== activeFrom.getTime() + 2 * 60 * 60 * 1_000 ||
        !Array.isArray(playerIds) ||
        playerIds.length !== 5 ||
        playerIds.some((value) => typeof value !== 'string') ||
        !validPrivatePilotMutationHeaders(request.raw.rawHeaders, body.requestId)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const authUserId = await ownerSubject(request.raw.rawHeaders);
      const mutation = await runKemerbetStateMutation('ordinary', () =>
        dependencies.runtime.privateLivePilot.prepare(authUserId, {
          activeFrom,
          expiresAt,
          playerIds: playerIds as unknown as PrepareApprovedPrivateLivePilotRequest['playerIds'],
          requestId: body.requestId as string,
        }),
      );
      return mutation.state === 'blocked'
        ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
        : reply.code(201).send({ pilot: mutation.value });
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerPrivateLivePilotRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (
        error instanceof OwnerAuthenticationUnavailableError ||
        error instanceof OwnerPrivateLivePilotUnavailableError
      ) {
        request.log.warn('Owner private live-deposit pilot preparation is unavailable.');
      }
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.post<{ Params: { pilotRevisionId: string } }>(
    '/v1/owner/private-live-deposit-pilots/:pilotRevisionId/arm',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['confirmation', 'requestId']);
        if (
          body?.confirmation !== 'owner_confirmed_dry_run_only' ||
          // Arm and stop use the immutable pilot UUID as their durable idempotency identity.
          body.requestId !== request.params.pilotRevisionId ||
          !validPrivatePilotMutationHeaders(request.raw.rawHeaders, body.requestId)
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const mutation = await runKemerbetStateMutation('ordinary', () =>
          dependencies.runtime.privateLivePilot.arm(authUserId, request.params.pilotRevisionId),
        );
        return mutation.state === 'blocked'
          ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
          : reply.code(200).send(mutation.value);
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPrivateLivePilotRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner private live-deposit pilot arming is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.post<{ Params: { pilotRevisionId: string } }>(
    '/v1/owner/private-live-deposit-pilots/:pilotRevisionId/stop',
    async (request, reply) => {
      try {
        const body = exactObject(request.body, ['confirmation', 'reasonCode', 'requestId']);
        const reasonCode = body?.reasonCode;
        if (
          body?.confirmation !== 'owner_confirmed_emergency_stop' ||
          body.requestId !== request.params.pilotRevisionId ||
          typeof reasonCode !== 'string' ||
          !PRIVATE_LIVE_PILOT_STOP_REASONS.has(reasonCode as PrivateLivePilotStopReason) ||
          !validPrivatePilotMutationHeaders(request.raw.rawHeaders, body.requestId)
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const mutation = await runKemerbetStateMutation('ordinary', () =>
          dependencies.runtime.privateLivePilot.stop(
            authUserId,
            request.params.pilotRevisionId,
            reasonCode as PrivateLivePilotStopReason,
          ),
        );
        return mutation.state === 'blocked'
          ? reply.code(409).send({ error: 'kemerbet_security_recovery_required' })
          : reply.code(200).send({ pilot: mutation.value });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPrivateLivePilotRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner private live-deposit pilot emergency stop is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get<{ Querystring: Record<string, string> }>(
    '/v1/owner/private-live-deposit-pilots/current',
    async (request, reply) => {
      try {
        if (Object.keys(request.query).length !== 0) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const authUserId = await ownerSubject(request.raw.rawHeaders);
        const status = await dependencies.runtime.privateLivePilot.current(authUserId);
        return reply.code(200).send({ pilot: status ?? null });
      } catch (error) {
        if (
          error instanceof OwnerAuthenticationRejectedError ||
          error instanceof OwnerPrivateLivePilotRejectedError
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        request.log.warn('Owner current private live-deposit pilot status is unavailable.');
        return reply.code(503).send({ error: 'owner_control_unavailable' });
      }
    },
  );

  app.get<{
    Params: { pilotRevisionId: string };
    Querystring: Record<string, string>;
  }>('/v1/owner/private-live-deposit-pilots/:pilotRevisionId/status', async (request, reply) => {
    try {
      if (Object.keys(request.query).length !== 0) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authUserId = await ownerSubject(request.raw.rawHeaders);
      const status = await dependencies.runtime.privateLivePilot.status(
        authUserId,
        request.params.pilotRevisionId,
      );
      return reply.code(200).send({ pilot: status });
    } catch (error) {
      if (
        error instanceof OwnerAuthenticationRejectedError ||
        error instanceof OwnerPrivateLivePilotRejectedError
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      request.log.warn('Owner private live-deposit pilot status is unavailable.');
      return reply.code(503).send({ error: 'owner_control_unavailable' });
    }
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'fetanagent-owner-control' }));
  app.get('/readyz', async (_request, reply) => {
    const ready = await dependencies.runtime.ready();
    return ready ? reply.code(200).send({ ready: true }) : reply.code(503).send({ ready: false });
  });
  app.addHook('onClose', async () => dependencies.runtime.close());
  return app;
}
