import { describe, expect, it } from 'vitest';

import { OwnerAuthenticationRejectedError } from './owner-auth.js';
import { PostgresOwnerBrowserSessions } from './owner-browser-session.js';

describe('Owner browser session database boundary', () => {
  it('passes only verified subject, Auth session ID, and action to the narrow function', async () => {
    const calls: unknown[] = [];
    const session = {
      absoluteExpiresAt: '2026-11-08T00:00:00+00:00',
      idleExpiresAt: '2026-11-01T12:00:00+00:00',
    };
    const adapter = new PostgresOwnerBrowserSessions({
      query: async (sql, values) => {
        calls.push([sql, values]);
        return { rows: [{ session }] };
      },
    });
    expect(
      await adapter.run(
        '11111111-1111-4111-8111-111111111111',
        '99999999-9999-4999-8999-999999999999',
        'check',
      ),
    ).toEqual(session);
    expect(calls).toEqual([
      [
        'select app.owner_browser_session($1::uuid, $2::uuid, $3::text) as session',
        ['11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'check'],
      ],
    ]);
  });

  it('maps an expired or unauthorized database session to authentication rejection', async () => {
    const adapter = new PostgresOwnerBrowserSessions({
      query: async () => {
        throw Object.assign(new Error('denied'), { code: '42501' });
      },
    });
    await expect(
      adapter.run(
        '11111111-1111-4111-8111-111111111111',
        '99999999-9999-4999-8999-999999999999',
        'touch',
      ),
    ).rejects.toBeInstanceOf(OwnerAuthenticationRejectedError);
  });
});
