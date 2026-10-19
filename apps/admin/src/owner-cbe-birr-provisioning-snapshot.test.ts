import { describe, expect, it, vi } from 'vitest';

import {
  OwnerReceiverAccountRejectedError,
  OwnerReceiverAccountUnavailableError,
  PostgresOwnerReceiverAccounts,
  type OwnerReceiverDatabase,
} from './owner-receiver-accounts.js';

const actor = '11111111-1111-4111-8111-111111111111';
const revision = '22222222-2222-4222-8222-222222222222';
const approvedRevision = { receiverRevisionId: revision, receiverVersion: 3 };
const referenceSecrets = { encryptionSecret: 'c'.repeat(64), fingerprintSecret: 'd'.repeat(64) };

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    receiver_revision_id: revision,
    receiver_version: 3,
    protection_profile_version: 2,
    encryption_key_version: 2,
    fingerprint_key_version: 2,
    ...overrides,
  };
}

describe('Owner CBE Birr provisioning snapshot adapter', () => {
  it('reads only the exact active revision metadata and returns a frozen nonsecret projection', async () => {
    const query = vi.fn<OwnerReceiverDatabase['query']>(async (sql, values) => {
      expect(sql).toContain('app.inspect_owner_cbe_birr_provisioning_snapshot($1::uuid)');
      expect(sql).not.toMatch(
        /join|from app\.(?:receiver_accounts|cbe_birr_receiver_lookup_revisions)/iu,
      );
      expect(values).toEqual([actor]);
      return { rows: [snapshotRow()] };
    });
    const control = new PostgresOwnerReceiverAccounts({ query }, referenceSecrets);

    const result = await control.readCbeBirrProvisioningSnapshot(actor, approvedRevision);
    expect(result).toEqual({
      receiverRevisionId: revision,
      receiverVersion: 3,
      protectionProfileVersion: 2,
      encryptionKeyVersion: 2,
      fingerprintKeyVersion: 2,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/cipher|keyHex|phone|account/iu);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed actor before querying PostgreSQL', async () => {
    const query = vi.fn<OwnerReceiverDatabase['query']>();
    const control = new PostgresOwnerReceiverAccounts({ query }, referenceSecrets);
    await expect(
      control.readCbeBirrProvisioningSnapshot('not-a-uuid', approvedRevision),
    ).rejects.toBeInstanceOf(OwnerReceiverAccountRejectedError);
    await expect(
      control.readCbeBirrProvisioningSnapshot(actor, {
        receiverRevisionId: 'not-a-uuid',
        receiverVersion: 3,
      }),
    ).rejects.toBeInstanceOf(OwnerReceiverAccountRejectedError);
    await expect(
      control.readCbeBirrProvisioningSnapshot(actor, {
        receiverRevisionId: revision,
        receiverVersion: 0,
      }),
    ).rejects.toBeInstanceOf(OwnerReceiverAccountRejectedError);
    expect(query).not.toHaveBeenCalled();
  });

  it('holds the approved revision identity fixed across the database read', async () => {
    const mutableApproval = { ...approvedRevision };
    const control = new PostgresOwnerReceiverAccounts(
      {
        query: async () => {
          mutableApproval.receiverVersion = 4;
          return { rows: [snapshotRow()] };
        },
      },
      referenceSecrets,
    );
    await expect(
      control.readCbeBirrProvisioningSnapshot(actor, mutableApproval),
    ).resolves.toMatchObject({
      receiverRevisionId: revision,
      receiverVersion: 3,
    });
  });

  it('fails closed on missing, malformed, expanded, or stale metadata', async () => {
    for (const rows of [
      [],
      [snapshotRow(), snapshotRow()],
      [snapshotRow({ receiver_revision_id: actor })],
      [snapshotRow({ receiver_version: 0 })],
      [snapshotRow({ receiver_version: 2.5 })],
      [snapshotRow({ receiver_version: 4 })],
      [snapshotRow({ protection_profile_version: 1 })],
      [snapshotRow({ encryption_key_version: 1 })],
      [snapshotRow({ fingerprint_key_version: 1 })],
      [snapshotRow({ receiver_phone: 'synthetic-extra-field' })],
    ]) {
      const control = new PostgresOwnerReceiverAccounts(
        { query: async () => ({ rows }) },
        referenceSecrets,
      );
      await expect(
        control.readCbeBirrProvisioningSnapshot(actor, approvedRevision),
      ).rejects.toBeInstanceOf(OwnerReceiverAccountUnavailableError);
    }
    const failed = new PostgresOwnerReceiverAccounts(
      {
        query: async () => {
          throw new Error('database failure');
        },
      },
      referenceSecrets,
    );
    await expect(failed.readCbeBirrProvisioningSnapshot(actor, approvedRevision)).rejects.toThrow(
      'The Owner receiver-account operation is unavailable.',
    );
  });
});
