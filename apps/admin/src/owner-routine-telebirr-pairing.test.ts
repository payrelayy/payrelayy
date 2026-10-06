import { describe, expect, it } from 'vitest';

import {
  OwnerRoutineTelebirrPairingNotReadyError,
  OwnerRoutineTelebirrPairingRejectedError,
  OwnerRoutineTelebirrPairingUnavailableError,
  PostgresOwnerRoutineTelebirrPairing,
} from './owner-routine-telebirr-pairing.js';

const actor = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const row = {
  pairing_id: '33333333-3333-4333-8333-333333333333',
  pairing_nonce_digest: `sha256:${'a'.repeat(64)}`,
  receiver_revision_id: '44444444-4444-4444-8444-444444444444',
  receiver_version: 3,
  receiver_profile_digest: `sha256:${'b'.repeat(64)}`,
  expected_receiver_name_digest: `sha256:${'c'.repeat(64)}`,
  issued_at: new Date('2026-10-06T12:00:00.000Z'),
  expires_at: new Date('2026-10-06T12:10:00.000Z'),
  replayed: false,
};

describe('Owner routine TeleBirr pairing challenge adapter', () => {
  it('returns a routine-only no-money package with the exact Android challenge fields', async () => {
    const calls: Array<{ sql: string; values: readonly string[] }> = [];
    const adapter = new PostgresOwnerRoutineTelebirrPairing({
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [row] };
      },
    });
    const receipt = await adapter.issue(actor, requestId);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('app.issue_owner_routine_telebirr_device_pairing_challenge');
    expect(calls[0]!.values).toEqual([actor, requestId]);
    expect(receipt).toMatchObject({
      alreadyIssued: false,
      assignmentPollingAllowed: false,
      enrollmentAllowed: false,
      expiresAt: row.expires_at.toISOString(),
      moneyMovementAllowed: false,
      pairingOnly: true,
    });
    expect(receipt.challengePackage.startsWith('fetanagent-routine-pairing-v1.')).toBe(true);
    expect(
      JSON.parse(
        Buffer.from(receipt.challengePackage.split('.')[1]!, 'base64url').toString('utf8'),
      ),
    ).toEqual({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'routine_device_pairing_v1',
      pairingId: row.pairing_id,
      pairingNonceDigest: row.pairing_nonce_digest,
      receiverRevisionId: row.receiver_revision_id,
      receiverVersion: row.receiver_version,
      receiverProfileDigest: row.receiver_profile_digest,
      expectedReceiverNameDigest: row.expected_receiver_name_digest,
      issuedAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    });
    expect(receipt.challengePackage).not.toContain('pilot');
  });

  it('returns the identical package for an exact database replay', async () => {
    const adapter = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => ({ rows: [{ ...row, replayed: true }] }),
    });
    expect(await adapter.issue(actor, requestId)).toMatchObject({ alreadyIssued: true });
  });

  it('rejects malformed inputs, malformed database rows, and denied or unavailable authority', async () => {
    const adapter = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => ({ rows: [row] }),
    });
    await expect(adapter.issue(actor, 'bad')).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingRejectedError,
    );
    const malformed = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => ({ rows: [{ ...row, receiver_version: 0 }] }),
    });
    await expect(malformed.issue(actor, requestId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingUnavailableError,
    );
    const denied = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => {
        throw Object.assign(new Error('redacted'), { code: '42501' });
      },
    });
    await expect(denied.issue(actor, requestId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingRejectedError,
    );
    const notReady = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => {
        throw Object.assign(new Error('redacted'), { code: 'P0001' });
      },
    });
    await expect(notReady.issue(actor, requestId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingNotReadyError,
    );
  });
});
