import {
  OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
  loadOwnerControlConfig,
} from '@payreplayy/config/owner-control';
import { describe, expect, it } from 'vitest';

import { buildOwnerControlApp } from './app.js';
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
    OWNER_CONTROL_DATABASE_URL: `postgresql://payreplayy_owner_control_runtime.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
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
        inviteUrl: 'https://t.me/PayReplayyBot?start=raw-token-returned-once',
      }),
      revoke: async () => undefined,
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
});
