import { describe, expect, it, vi } from 'vitest';

import {
  OwnerReceiverAccountRejectedError,
  OwnerReceiverAccountUnavailableError,
  PostgresOwnerReceiverAccounts,
  type OwnerReceiverDatabase,
} from './owner-receiver-accounts.js';

const actor = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const phone = '251000003456';
const referenceSecrets = { encryptionSecret: 'c'.repeat(64), fingerprintSecret: 'd'.repeat(64) };
const lookupSecrets = { encryptionSecret: 'e'.repeat(64), fingerprintSecret: 'f'.repeat(64) };
const request = {
  accountHolderName: 'Synthetic Receiver',
  accountReference: phone,
  expectedVersion: 2,
  requestId,
};

function rotationRow(overrides: Record<string, unknown> = {}) {
  return {
    receiver_revision_id: requestId,
    revision: 2,
    receiver_status: 'active',
    active_from: new Date('2026-10-18T16:30:00.000Z'),
    lookup_protected: true,
    ...overrides,
  };
}

describe('default-off Owner CBE Birr v2 receiver adapter', () => {
  it('passes only independently protected material to the atomic Owner function', async () => {
    const query = vi.fn<OwnerReceiverDatabase['query']>(async (sql, values) => {
      expect(sql).toContain('app.rotate_owner_cbe_birr_receiver_lookup_v2');
      expect(sql).toContain("'protection_upgrade'");
      expect(values.slice(0, 5)).toEqual([actor, requestId, requestId, 2, 'Synthetic Receiver']);
      expect(values[5]).toMatch(/^receiver-v1\.cbe_birr\./u);
      expect(values[6]).toMatch(/^[0-9a-f]{64}$/u);
      expect(values[7]).toBe('***3456');
      expect(values[8]).toMatch(/^cbe-receiver-v2\./u);
      expect(values[9]).toMatch(/^[0-9a-f]{64}$/u);
      expect(values[10]).toBe('***3456');
      expect(JSON.stringify(values)).not.toContain(phone);
      return { rows: [rotationRow()] };
    });
    const control = new PostgresOwnerReceiverAccounts({ query }, referenceSecrets, lookupSecrets);

    const result = await control.upgradeCbeBirrProtection(actor, request);
    expect(result).toEqual({
      accountReferenceMasked: '***3456',
      activeFrom: '2026-10-18T16:30:00.000Z',
      lookupProtected: true,
      receiverRevisionId: requestId,
      receiverStatus: 'active',
      revision: 2,
      rotationReason: 'protection_upgrade',
    });
    expect(JSON.stringify(result)).not.toContain(phone);
    expect(Object.isFrozen(result)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps the same revision identity and fingerprints on an idempotent retry', async () => {
    const calls: (readonly (boolean | number | string)[])[] = [];
    const control = new PostgresOwnerReceiverAccounts(
      {
        query: async (_sql, values) => {
          calls.push(values);
          return { rows: [rotationRow()] };
        },
      },
      referenceSecrets,
      lookupSecrets,
    );
    await control.upgradeCbeBirrProtection(actor, request);
    await control.upgradeCbeBirrProtection(actor, request);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.slice(0, 5)).toEqual(calls[1]!.slice(0, 5));
    expect(calls[0]![6]).toBe(calls[1]![6]);
    expect(calls[0]![9]).toBe(calls[1]![9]);
  });

  it('rejects invalid input and fails closed without keys or a valid SQL projection', async () => {
    const query = vi.fn<OwnerReceiverDatabase['query']>(async () => ({
      rows: [rotationRow()],
    }));
    const control = new PostgresOwnerReceiverAccounts({ query }, referenceSecrets, lookupSecrets);
    for (const invalid of [
      { ...request, accountReference: '000003456' },
      { ...request, accountHolderName: ' Receiver' },
      { ...request, expectedVersion: 0 },
      { ...request, expectedVersion: 2.5 },
      { ...request, requestId: 'not-a-uuid' },
    ]) {
      await expect(control.upgradeCbeBirrProtection(actor, invalid)).rejects.toBeInstanceOf(
        OwnerReceiverAccountRejectedError,
      );
    }
    expect(query).not.toHaveBeenCalled();

    const missingKeys = new PostgresOwnerReceiverAccounts({ query }, referenceSecrets);
    await expect(missingKeys.upgradeCbeBirrProtection(actor, request)).rejects.toBeInstanceOf(
      OwnerReceiverAccountUnavailableError,
    );
    expect(query).not.toHaveBeenCalled();

    const reusedKey = new PostgresOwnerReceiverAccounts({ query }, referenceSecrets, {
      encryptionSecret: referenceSecrets.encryptionSecret,
      fingerprintSecret: lookupSecrets.fingerprintSecret,
    });
    await expect(reusedKey.upgradeCbeBirrProtection(actor, request)).rejects.toBeInstanceOf(
      OwnerReceiverAccountUnavailableError,
    );
    expect(query).not.toHaveBeenCalled();

    for (const invalidRow of [
      rotationRow({ receiver_revision_id: actor }),
      rotationRow({ revision: 3 }),
      rotationRow({ receiver_status: 'inactive' }),
      rotationRow({ lookup_protected: false }),
      rotationRow({ active_from: '2026-10-18T16:30:00.000Z' }),
    ]) {
      const invalidProjection = new PostgresOwnerReceiverAccounts(
        { query: async () => ({ rows: [invalidRow] }) },
        referenceSecrets,
        lookupSecrets,
      );
      await expect(
        invalidProjection.upgradeCbeBirrProtection(actor, request),
      ).rejects.toBeInstanceOf(OwnerReceiverAccountUnavailableError);
    }
  });
});
