import { describe, expect, it, vi } from 'vitest';
import {
  OWNER_WITHDRAWAL_CONTACT_SQL,
  OwnerWithdrawalContactConflictError,
  OwnerWithdrawalContactInvalidError,
  OwnerWithdrawalContactRejectedError,
  OwnerWithdrawalContactUnavailableError,
  PostgresOwnerWithdrawalContact,
} from './owner-withdrawal-contact.js';

const actor = '11111111-1111-4111-8111-111111111111';
const launch = { telegram_username: 'balem18', revision: 0, updated_at: null };

describe('Owner manual withdrawal contact adapter', () => {
  it('recognizes the Owner-supplied launch contact and exposes only the public username', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [launch] })
      .mockResolvedValueOnce({
        rows: [{ telegram_username: 'balem18' }],
      });
    const adapter = new PostgresOwnerWithdrawalContact({ query });
    expect(await adapter.get(actor)).toEqual({
      telegramUsername: 'balem18',
      revision: 0,
      updatedAt: null,
    });
    expect(await adapter.publicContact()).toEqual({ telegramUsername: 'balem18' });
    expect(query).toHaveBeenNthCalledWith(1, OWNER_WITHDRAWAL_CONTACT_SQL.get, [actor]);
    expect(query).toHaveBeenNthCalledWith(2, OWNER_WITHDRAWAL_CONTACT_SQL.public, []);
  });

  it('normalizes an Owner edit with its expected revision', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          telegram_username: 'new_handler',
          revision: 1,
          updated_at: new Date('2026-11-01T00:00:00Z'),
        },
      ],
    });
    const result = await new PostgresOwnerWithdrawalContact({ query }).set(
      actor,
      '@New_Handler',
      0,
    );
    expect(query).toHaveBeenCalledWith(OWNER_WITHDRAWAL_CONTACT_SQL.set, [actor, 'new_handler', 0]);
    expect(result).toEqual({
      telegramUsername: 'new_handler',
      revision: 1,
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('rejects malformed input and fails closed on inconsistent database rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ ...launch, telegram_username: 'bad/url' }] });
    const adapter = new PostgresOwnerWithdrawalContact({ query });
    await expect(adapter.get('bad')).rejects.toBeInstanceOf(OwnerWithdrawalContactRejectedError);
    await expect(adapter.set(actor, 'https://t.me/other', 0)).rejects.toBeInstanceOf(
      OwnerWithdrawalContactInvalidError,
    );
    expect(query).not.toHaveBeenCalled();
    await expect(adapter.get(actor)).rejects.toBeInstanceOf(OwnerWithdrawalContactUnavailableError);
  });

  it('reports a stale Owner revision without exposing database details', async () => {
    const query = vi.fn().mockRejectedValue({ code: '40001', message: 'private detail' });
    await expect(
      new PostgresOwnerWithdrawalContact({ query }).set(actor, null, 0),
    ).rejects.toBeInstanceOf(OwnerWithdrawalContactConflictError);
  });
});
