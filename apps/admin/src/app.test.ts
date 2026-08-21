import {
  OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
  loadOwnerControlConfig,
} from '@fetanagent/config/owner-control';
import { describe, expect, it } from 'vitest';

import { buildOwnerControlApp } from './app.js';
import { OWNER_DASHBOARD_JAVASCRIPT } from './owner-dashboard.js';
import { OwnerInviteRejectedError } from './owner-invites.js';
import type { PrivateLivePilotStatus } from './owner-private-live-pilot.js';
import type { OwnerControlPostgresRuntime } from './postgres-runtime.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const inviteId = '22222222-2222-4222-8222-222222222222';
const pilotRevisionId = '33333333-3333-4333-8333-333333333333';
const pilotRequestId = '55555555-5555-4555-8555-555555555555';
const bearer = 'header.payload.signature-with-safe-characters';

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

function config() {
  return loadOwnerControlConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
    OWNER_CONTROL_DATABASE_URL: `postgresql://fetanagent_owner_control_runtime:password@db.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co:5432/postgres?sslmode=verify-full`,
    OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
    OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key_for_staging_only',
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
      prepare: async () => pilotStatus(),
      status: async () => pilotStatus(),
      stop: async () =>
        pilotStatus({
          pilotStatus: 'stopped',
          stopReasonCode: 'owner_stop',
          stoppedAt: '2026-08-21T20:30:00.000Z',
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
    expect(response.body).toContain('KemerBet Player ID requests');
    expect(response.body).toContain('This does not prove ownership');
    expect(response.body).toContain('Explicit ownership confirmation');
    expect(response.body).toContain('Player ID ownership associations');
    expect(response.body).toContain('Deposit eligibility decisions');
    expect(response.body).toMatch(/does not open a deposit[\s\S]*or move money/u);
    expect(response.body).toContain('Dry-run deposit intake');
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

  it('keeps the Owner access token in memory and never enables browser credential storage', async () => {
    const app = buildOwnerControlApp(config(), { runtime: runtime() });
    const response = await app.inject({ method: 'GET', url: '/owner/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('/auth/v1/token?grant_type=password');
    expect(response.body).toContain("credentials: 'omit'");
    expect(response.body).toContain("authorization: 'Bearer ' + accessToken");
    expect(response.body).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/u);
    expect(response.body).not.toContain('refresh_token');
    expect(response.body).not.toContain('service_role');
    expect(response.body).toContain('/v1/owner/player-registration-requests?limit=25');
    expect(response.body).toContain(
      '/v1/owner/player-registration-association-candidates?limit=25',
    );
    expect(response.body).toContain('/v1/owner/dry-run-deposit-intake?limit=25');
    expect(response.body).toContain('/v1/owner/dry-run-fixture-assessments?limit=50');
    expect(response.body).toContain('/v1/owner/player-deposit-eligibility?limit=50');
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
        confirmation: 'owner_confirmed_dormant_private_live_pilot',
        expiresAt: '2026-08-21T22:00:00.000Z',
        maximumAggregateMinor: 12_500,
        maximumPerDepositMinor: 2_500,
        maximumPerPlayerMinor: 2_500,
        maximumReservationCount: 5,
        minimumAmountMinor: 2_500,
        playerIds: ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'],
        providerCodes: ['telebirr'],
        requestId: pilotRequestId,
        submittingCustomerIds: ['44444444-4444-4444-8444-444444444444'],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(observedActor).toBe(authUserId);
    expect(observedRequest).toMatchObject({
      maximumAggregateMinor: 12_500,
      providerCodes: ['telebirr'],
      requestId: pilotRequestId,
    });
    expect(response.json()).toEqual({ pilot: pilotStatus() });
    expect(response.body).not.toContain('PLAYER-1');
    expect(response.body).not.toContain('44444444-4444-4444-8444-444444444444');
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
});
