import { describe, expect, it } from 'vitest';

import {
  bearerTokenFromRawHeaders,
  ownerSessionIdFromVerifiedToken,
  verifyOwnerBearerToken,
} from './owner-auth.js';

describe('Owner bearer authentication', () => {
  it('requires exactly one strict bearer header', () => {
    const token = 'header.payload.signature-with-safe-characters';
    expect(bearerTokenFromRawHeaders(['Authorization', `Bearer ${token}`])).toBe(token);
    expect(
      bearerTokenFromRawHeaders([
        'authorization',
        `Bearer ${token}`,
        'Authorization',
        `Bearer ${token}`,
      ]),
    ).toBeUndefined();
    expect(bearerTokenFromRawHeaders(['authorization', `bearer ${token}`])).toBeUndefined();
  });

  it('accepts only a verified Supabase user response with a UUID subject', async () => {
    const authUserId = '11111111-1111-4111-8111-111111111111';
    const verified = await verifyOwnerBearerToken(
      'header.payload.signature-with-safe-characters',
      {
        publishableKey: 'sb_publishable_test_key',
        supabaseUrl: 'https://spzpiyxheappsfyswewl.supabase.co',
      },
      (async () =>
        new Response(JSON.stringify({ id: authUserId }), { status: 200 })) as typeof fetch,
    );
    expect(verified).toEqual({ authUserId });
  });

  it('binds the session ID claim to the already verified Supabase user', () => {
    const authUserId = '11111111-1111-4111-8111-111111111111';
    const sessionId = '99999999-9999-4999-8999-999999999999';
    const token =
      'header.' +
      Buffer.from(JSON.stringify({ sub: authUserId, session_id: sessionId })).toString(
        'base64url',
      ) +
      '.signature';
    expect(ownerSessionIdFromVerifiedToken(token, authUserId)).toBe(sessionId);
    expect(() =>
      ownerSessionIdFromVerifiedToken(token, '22222222-2222-4222-8222-222222222222'),
    ).toThrow();
    expect(() => ownerSessionIdFromVerifiedToken('header.payload.signature', authUserId)).toThrow();
  });
});
