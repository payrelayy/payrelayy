import { describe, expect, it } from 'vitest';

import {
  OwnerTelebirrFastAlertsUnavailableError,
  PostgresOwnerTelebirrFastAlerts,
} from './owner-telebirr-fast-alerts.js';

const owner = '11111111-1111-4111-8111-111111111111';

describe('Owner TeleBirr review alerts', () => {
  it('reads only the narrow summary with the authenticated Owner subject', async () => {
    const alerts = new PostgresOwnerTelebirrFastAlerts({
      query: async (sql, values) => {
        expect(sql).toBe(
          'select * from app.get_owner_routine_telebirr_fast_alert_summary($1::uuid)',
        );
        expect(values).toEqual([owner]);
        return { rows: [{ held_count: '3', receipt_layout_changed: true }] };
      },
    });
    expect(await alerts.status(owner)).toEqual({ heldCount: 3, receiptLayoutChanged: true });
  });

  it('rejects malformed subjects and database results', async () => {
    const alerts = new PostgresOwnerTelebirrFastAlerts({
      query: async () => ({ rows: [{ held_count: '-1', receipt_layout_changed: false }] }),
    });
    await expect(alerts.status('bad')).rejects.toThrow(OwnerTelebirrFastAlertsUnavailableError);
    await expect(alerts.status(owner)).rejects.toThrow(OwnerTelebirrFastAlertsUnavailableError);
  });
});
