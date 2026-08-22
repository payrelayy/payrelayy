import { describe, expect, it, vi } from 'vitest';

import {
  OwnerReceiverAccountRejectedError,
  OwnerReceiverAccountUnavailableError,
  PostgresOwnerReceiverAccounts,
  type OwnerReceiverDatabase,
} from './owner-receiver-accounts.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const receiverRevisionId = '33333333-3333-4333-8333-333333333333';
const secrets = { encryptionSecret: 'c'.repeat(64), fingerprintSecret: 'd'.repeat(64) };

function row(overrides: Record<string, unknown> = {}) {
  return {
    account_holder_name: 'FetanAgent Receiver',
    account_reference_masked: '***3456',
    active_from: new Date('2026-08-22T13:30:00.000Z'),
    protected_reference: true,
    provider_code: 'telebirr',
    provider_display_name: 'TeleBirr',
    receiver_revision_id: receiverRevisionId,
    receiver_status: 'active',
    retired_at: null,
    revision: 2,
    rotation_reason: 'account_rotation',
    ...overrides,
  };
}

describe('Owner receiver-account PostgreSQL adapter', () => {
  it('protects the exact account before PostgreSQL and returns only the safe revision projection', async () => {
    const query = vi.fn<OwnerReceiverDatabase['query']>(async (sql, values) => {
      expect(sql).toContain('rotate_owner_receiver_account');
      expect(values.slice(0, 4)).toEqual([
        authUserId,
        requestId,
        'telebirr',
        'FetanAgent Receiver',
      ]);
      expect(values[4]).toMatch(
        /^receiver-v1\.telebirr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
      );
      expect(values[5]).toMatch(/^[0-9a-f]{64}$/u);
      expect(values[6]).toBe('***3456');
      expect(values.slice(7)).toEqual([1, 1, 1, 'account_rotation']);
      expect(JSON.stringify(values)).not.toContain('0000003456');
      return { rows: [row()] };
    });
    const control = new PostgresOwnerReceiverAccounts({ query }, secrets);

    await expect(
      control.rotate(authUserId, {
        accountHolderName: 'FetanAgent Receiver',
        accountReference: '0000003456',
        providerCode: 'telebirr',
        requestId,
        rotationReason: 'account_rotation',
      }),
    ).resolves.toEqual({
      accountHolderName: 'FetanAgent Receiver',
      accountReferenceMasked: '***3456',
      activeFrom: '2026-08-22T13:30:00.000Z',
      protectedReference: true,
      providerCode: 'telebirr',
      providerDisplayName: 'TeleBirr',
      receiverRevisionId,
      receiverStatus: 'active',
      revision: 2,
      rotationReason: 'account_rotation',
    });
  });

  it('lists active and retired history without protected material', async () => {
    const control = new PostgresOwnerReceiverAccounts(
      {
        query: async (sql, values) => {
          expect(sql).toContain('list_owner_receiver_accounts');
          expect(values).toEqual([authUserId]);
          return {
            rows: [
              row(),
              row({
                receiver_revision_id: '44444444-4444-4444-8444-444444444444',
                receiver_status: 'inactive',
                retired_at: new Date('2026-08-22T13:30:00.000Z'),
                revision: 1,
              }),
              row({
                protected_reference: false,
                receiver_revision_id: '66666666-6666-4666-8666-666666666666',
                provider_code: 'cbe_birr',
                provider_display_name: 'CBE Birr',
                receiver_status: 'active',
                retired_at: null,
                revision: 1,
                rotation_reason: null,
              }),
            ],
          };
        },
      },
      secrets,
    );

    const result = await control.list(authUserId);
    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({
      receiverStatus: 'inactive',
      retiredAt: '2026-08-22T13:30:00.000Z',
    });
    expect(JSON.stringify(result)).not.toMatch(/cipher|fingerprint|0000003456/iu);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result[2]).toMatchObject({
      protectedReference: false,
      providerCode: 'cbe_birr',
      receiverStatus: 'active',
    });
  });

  it.each([
    { accountHolderName: ' Receiver', accountReference: '0000003456' },
    { accountHolderName: 'Receiver', accountReference: '0000 003 456' },
    { accountHolderName: 'Receiver', accountReference: '+0000003456' },
    { accountHolderName: 'Receiver', accountReference: '12345678' },
  ])('rejects malformed plaintext before PostgreSQL', async (invalid) => {
    const query = vi.fn<OwnerReceiverDatabase['query']>();
    const control = new PostgresOwnerReceiverAccounts({ query }, secrets);
    await expect(
      control.rotate(authUserId, {
        ...invalid,
        providerCode: 'telebirr',
        requestId,
        rotationReason: 'initial_configuration',
      }),
    ).rejects.toBeInstanceOf(OwnerReceiverAccountRejectedError);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed, unprotected, or duplicate-active database projection', async () => {
    const malformed = new PostgresOwnerReceiverAccounts(
      { query: async () => ({ rows: [row({ protected_reference: false })] }) },
      secrets,
    );
    await expect(
      malformed.rotate(authUserId, {
        accountHolderName: 'FetanAgent Receiver',
        accountReference: '0000003456',
        providerCode: 'telebirr',
        requestId,
        rotationReason: 'account_rotation',
      }),
    ).rejects.toBeInstanceOf(OwnerReceiverAccountUnavailableError);

    const duplicate = new PostgresOwnerReceiverAccounts(
      {
        query: async () => ({
          rows: [row(), row({ receiver_revision_id: '55555555-5555-4555-8555-555555555555' })],
        }),
      },
      secrets,
    );
    await expect(duplicate.list(authUserId)).rejects.toBeInstanceOf(
      OwnerReceiverAccountUnavailableError,
    );
  });
});
