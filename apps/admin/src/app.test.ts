import {
  OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
  loadOwnerControlConfig,
} from '@payreplayy/config/owner-control';
import { describe, expect, it } from 'vitest';

import { buildOwnerControlApp } from './app.js';
import { OWNER_DASHBOARD_JAVASCRIPT } from './owner-dashboard.js';
import { OwnerInviteRejectedError } from './owner-invites.js';
import type { OwnerControlPostgresRuntime } from './postgres-runtime.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const inviteId = '22222222-2222-4222-8222-222222222222';
const bearer = 'header.payload.signature-with-safe-characters';

function config() {
  return loadOwnerControlConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
    OWNER_CONTROL_DATABASE_URL: `postgresql://payreplayy_owner_control_runtime:password@db.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co:5432/postgres?sslmode=verify-full`,
    OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
    OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key_for_staging_only',
  });
}

function runtime(
  overrides: Partial<OwnerControlPostgresRuntime> = {},
): OwnerControlPostgresRuntime {
  return {
    invites: {
      issue: async () => ({
        expiresAt: '2026-08-11T12:00:00.000Z',
        inviteId,
        inviteUrl: 'https://t.me/payrelayybot?start=raw-token-returned-once',
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
    expect(response.body).toContain('PayReplayy Owner');
    expect(response.body).toContain('KemerBet Player ID requests');
    expect(response.body).toContain('This does not prove ownership');
    expect(response.body).toContain('Explicit ownership confirmation');
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
    expect(response.body).toContain("reviewButton('Found on KemerBet'");
    expect(response.body).not.toContain('innerHTML');
    expect(response.body).toContain("url.pathname !== '/payrelayybot'");
    expect(response.body).not.toContain('/PayReplayyBot');
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
});
