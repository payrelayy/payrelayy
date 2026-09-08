import { describe, expect, it, vi } from 'vitest';
import {
  OWNER_COMPANION_CONNECTION_SQL,
  OwnerCompanionConnectionRejectedError,
  OwnerCompanionConnectionUnavailableError,
  PostgresOwnerCompanionConnection,
} from './owner-companion-connection.js';

const actor = '11111111-1111-4111-8111-111111111111';
const row = {
  paired_device_count: 1,
  valid_device_count: 1,
  connected_device_count: 1,
  last_seen_at: new Date('2026-09-08T11:00:00.000Z'),
  checked_at: new Date('2026-09-08T11:00:10.000Z'),
};

describe('Owner companion connection telemetry', () => {
  it('returns only redacted counts and UTC timestamps through the Owner-scoped function', async () => {
    const query = vi.fn(async () => ({ rows: [row] }));
    expect(await new PostgresOwnerCompanionConnection({ query }).status(actor)).toEqual({
      pairedDeviceCount: 1,
      validDeviceCount: 1,
      connectedDeviceCount: 1,
      lastSeenAt: '2026-09-08T11:00:00.000Z',
      checkedAt: '2026-09-08T11:00:10.000Z',
    });
    expect(query).toHaveBeenCalledExactlyOnceWith(OWNER_COMPANION_CONNECTION_SQL, [actor]);
  });

  it.each([
    [],
    [row, row],
    [null],
    [{ ...row, device_id: 'not-for-the-owner-response' }],
    [{ ...row, paired_device_count: '1' }],
    [{ ...row, valid_device_count: -1 }],
    [{ ...row, connected_device_count: 2 }],
    [{ ...row, valid_device_count: 2 }],
    [{ ...row, last_seen_at: null }],
    [{ ...row, last_seen_at: new Date('invalid') }],
    [{ ...row, checked_at: new Date('2026-09-08T10:59:59.000Z') }],
    [{ ...row, checked_at: new Date('2026-09-08T11:01:00.000Z') }],
  ])('rejects malformed or falsely connected database results %#', async (...rows) => {
    await expect(
      new PostgresOwnerCompanionConnection({ query: async () => ({ rows }) }).status(actor),
    ).rejects.toThrow(OwnerCompanionConnectionUnavailableError);
  });

  it('accepts an unpaired Owner and valid but never-seen pairing', async () => {
    for (const count of [0, 1]) {
      const status = await new PostgresOwnerCompanionConnection({
        query: async () => ({
          rows: [
            {
              ...row,
              paired_device_count: count,
              valid_device_count: count,
              connected_device_count: 0,
              last_seen_at: null,
            },
          ],
        }),
      }).status(actor);
      expect(status.connectedDeviceCount).toBe(0);
      expect(status.lastSeenAt).toBeNull();
    }
  });

  it('rejects invalid actors before querying and hides database failures', async () => {
    const query = vi.fn(async () => {
      throw { code: '42501', detail: 'private' };
    });
    const connection = new PostgresOwnerCompanionConnection({ query });
    await expect(connection.status('invalid')).rejects.toThrow(
      OwnerCompanionConnectionRejectedError,
    );
    expect(query).not.toHaveBeenCalled();
    await expect(connection.status(actor)).rejects.toThrow(OwnerCompanionConnectionRejectedError);
    await expect(
      new PostgresOwnerCompanionConnection({
        query: async () => {
          throw new Error('private');
        },
      }).status(actor),
    ).rejects.toThrow(OwnerCompanionConnectionUnavailableError);
  });
});
