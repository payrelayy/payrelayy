import { describe, expect, it } from 'vitest';

import { bearerTokenFromRawHeaders, verifyOwnerBearerToken } from './owner-auth.js';

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
});
