import { describe, expect, it } from 'vitest';

import { PostgresOwnerDeviceHealth } from './owner-device-health.js';

const actor = 'f519cc02-0000-4000-8000-000000000001';

describe('Owner device health', () => {
  it('shows only fresh signed reports as active', async () => {
    const database = new PostgresOwnerDeviceHealth({
      async query(sql) {
        return {
          rows: [
            {
              state: sql.includes('companion') ? 'signed_in_verified' : 'ready',
              reported_at: new Date('2026-11-03T09:00:00.000Z'),
              checked_at: new Date('2026-11-03T09:00:30.000Z'),
            },
          ],
        };
      },
    });
    const result = await database.status(actor);
    expect(result.companion.state).toBe('active');
    expect(result.receiverPhone.state).toBe('active');
  });

  it('never calls a stale or absent report active', async () => {
    const database = new PostgresOwnerDeviceHealth({
      async query(sql) {
        return {
          rows: [
            sql.includes('companion')
              ? {
                  state: 'signed_in_verified',
                  reported_at: new Date('2026-11-03T09:00:00.000Z'),
                  checked_at: new Date('2026-11-03T09:02:00.000Z'),
                }
              : {
                  state: null,
                  reported_at: null,
                  checked_at: new Date('2026-11-03T09:02:00.000Z'),
                },
          ],
        };
      },
    });
    const result = await database.status(actor);
    expect(result.companion.state).toBe('unknown');
    expect(result.receiverPhone.state).toBe('unknown');
  });
});
