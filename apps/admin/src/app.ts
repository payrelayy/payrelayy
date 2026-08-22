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
const OWNER_KEMERBET_AGENT_PROFILE_REASONS = new Set<OwnerKemerbetAgentProfileReason>([
  'agent_rotation',
  'initial_configuration',
  'owner_correction',
  'security_recovery',
]);
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
        const receipt = await dependencies.runtime.playerRegistrations.review(
          authUserId,
          request.params.requestId,
          decision as OwnerPlayerRegistrationDecision,
        );
        return reply.code(200).send(receipt);
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
        const receipt = await dependencies.runtime.playerRegistrations.associate(
          authUserId,
          request.params.requestId,
        );
        return reply.code(200).send(receipt);
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
        const receipt = await dependencies.runtime.eligibility.decide(
          authUserId,
          request.params.playerAccountId,
          decision as OwnerPlayerDepositEligibilityDecision,
        );
        return reply.code(200).send(receipt);
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
      const receiver = await dependencies.runtime.receivers.rotate(authUserId, {
        accountHolderName: body.accountHolderName,
        accountReference: body.accountReference,
        providerCode: providerCode as OwnerReceiverProvider,
        requestId: body.requestId as string,
        rotationReason: rotationReason as OwnerReceiverRotationReason,
      });
      return reply.code(201).send({ receiver });
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
      const profile = await dependencies.runtime.kemerbetAgentProfiles.prepare(authUserId, {
        configurationReason: configurationReason as OwnerKemerbetAgentProfileReason,
        requestId: body.requestId as string,
      });
      return reply.code(201).send({ profile });
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
      const status = await dependencies.runtime.privateLivePilot.prepare(authUserId, {
        activeFrom,
        expiresAt,
        playerIds: playerIds as unknown as PrepareApprovedPrivateLivePilotRequest['playerIds'],
        requestId: body.requestId as string,
      });
      return reply.code(201).send({ pilot: status });
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
        const receipt = await dependencies.runtime.privateLivePilot.arm(
          authUserId,
          request.params.pilotRevisionId,
        );
        return reply.code(200).send(receipt);
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
        const status = await dependencies.runtime.privateLivePilot.stop(
          authUserId,
          request.params.pilotRevisionId,
          reasonCode as PrivateLivePilotStopReason,
        );
        return reply.code(200).send({ pilot: status });
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
