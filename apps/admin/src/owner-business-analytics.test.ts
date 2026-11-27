import { describe, expect, it } from 'vitest';

import {
  OwnerBusinessAnalyticsRejectedError,
  OwnerBusinessAnalyticsUnavailableError,
  PostgresOwnerBusinessAnalytics,
} from './owner-business-analytics.js';

const actor = '11111111-1111-4111-8111-111111111111';

describe('Owner business analytics projection', () => {
  it('accepts bounded confirmed-credit metrics and keeps manual records separate', async () => {
    const period = (newUsers: number) => ({
      newUsers,
      automaticCredits: 2,
      automaticAmountMinor: '12900',
      manualRecords: 1,
      manualRecordedAmountMinor: '60000',
    });
    const queries: string[] = [];
    const service = new PostgresOwnerBusinessAnalytics({
      query: async (sql) => {
        queries.push(sql);
        return {
          rows: [
            {
              metrics: {
                checkedAt: '2026-11-27T09:00:00Z',
                timeZone: 'Africa/Addis_Ababa',
                registeredUsers: 340,
                today: period(1),
                week: period(28),
                month: period(258),
              },
            },
          ],
        };
      },
    });
    const metrics = await service.metrics(actor);
    expect(metrics.today.automaticAmountMinor).toBe('12900');
    expect(metrics.today.manualRecordedAmountMinor).toBe('60000');
    expect(queries).toEqual(['select app.get_owner_business_metrics($1::uuid) as metrics']);
  });

  it('rejects malformed database totals rather than showing a misleading number', async () => {
    const service = new PostgresOwnerBusinessAnalytics({
      query: async () => ({ rows: [{ metrics: { checkedAt: 'invalid' } }] }),
    });
    await expect(service.metrics(actor)).rejects.toBeInstanceOf(
      OwnerBusinessAnalyticsUnavailableError,
    );
    await expect(service.metrics('invalid')).rejects.toBeInstanceOf(
      OwnerBusinessAnalyticsRejectedError,
    );
  });

  it('returns only Telegram ID, Player IDs, and confirmed automatic history for a bounded page', async () => {
    const values: unknown[] = [];
    const service = new PostgresOwnerBusinessAnalytics({
      query: async (_sql, parameters) => {
        values.push(...parameters);
        return {
          rows: [
            {
              telegram_user_id: '123456789',
              identity_status: 'active',
              joined_at: new Date('2026-11-20T10:00:00Z'),
              last_active_at: new Date('2026-11-27T08:00:00Z'),
              player_count: '1',
              player_ids: ['32584710'],
              automatic_credits: '2',
              automatic_amount_minor: '12900',
              username: 'must-not-leak',
              private_chat_id: '987654321',
            },
          ],
        };
      },
    });
    const [user] = await service.listUsers(actor, '123456789', 26, 0);
    expect(values).toEqual([actor, '123456789', 26, 0]);
    expect(user).toEqual({
      telegramId: '123456789',
      status: 'active',
      joinedAt: '2026-11-20T10:00:00.000Z',
      lastActiveAt: '2026-11-27T08:00:00.000Z',
      playerCount: 1,
      playerIds: ['32584710'],
      automaticCredits: 2,
      automaticAmountMinor: '12900',
    });
    await expect(service.listUsers(actor, 'ID 123456789')).rejects.toBeInstanceOf(
      OwnerBusinessAnalyticsRejectedError,
    );
  });
});
