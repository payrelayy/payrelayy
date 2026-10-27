import { describe, expect, it, vi } from 'vitest';
import { protectReceiverAccountReference } from '@fetanagent/deposit-reference-protection';

import {
  OwnerReceiverAccountRejectedError,
  OwnerReceiverAccountUnavailableError,
  PostgresOwnerReceiverAccounts,
  validOwnerReceiverAccountReference,
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

function rotationRow(overrides: Record<string, unknown> = {}) {
  return Object.fromEntries(
    Object.entries(row(overrides)).filter(([key]) => key !== 'provider_display_name'),
  );
}

describe('Owner receiver-account PostgreSQL adapter', () => {
  it('opens active and retired receiver numbers in the Owner history', async () => {
    const active = protectReceiverAccountReference({
      provider: 'telebirr',
      reference: '0911113456',
      secrets,
    });
    const retired = protectReceiverAccountReference({
      provider: 'telebirr',
      reference: '0922223456',
      secrets,
    });
    const query = vi.fn<OwnerReceiverDatabase['query']>(async (sql) => {
      expect(sql).toContain('list_owner_receiver_accounts_sensitive');
      return {
        rows: [
          row({
            account_reference_masked: active.masked,
            account_reference_ciphertext: active.ciphertext,
            account_reference_fingerprint: active.fingerprint,
          }),
          row({
            receiver_revision_id: requestId,
            revision: 1,
            receiver_status: 'inactive',
            retired_at: new Date('2026-10-23T18:00:00Z'),
            account_reference_masked: retired.masked,
            account_reference_ciphertext: retired.ciphertext,
            account_reference_fingerprint: retired.fingerprint,
          }),
        ],
      };
    });
    const control = new PostgresOwnerReceiverAccounts({ query }, secrets, undefined, true);
    await expect(control.list(authUserId)).resolves.toMatchObject([
      { accountReference: '0911113456', receiverStatus: 'active' },
      { accountReference: '0922223456', receiverStatus: 'inactive' },
    ]);
  });
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
      return { rows: [rotationRow()] };
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

  it('accepts the TeleBirr rotation return contract without a display-name column', async () => {
    const providerCode = 'telebirr';
    const providerDisplayName = 'TeleBirr';
    const query = vi.fn<OwnerReceiverDatabase['query']>(async () => ({
      rows: [rotationRow({ provider_code: providerCode })],
    }));
    const control = new PostgresOwnerReceiverAccounts({ query }, secrets);
    const result = await control.rotate(authUserId, {
      accountHolderName: 'FetanAgent Receiver',
      accountReference: '0000003456',
      providerCode,
      requestId,
      rotationReason: 'account_rotation',
    });
    expect(result).toMatchObject({ providerCode, providerDisplayName, receiverStatus: 'active' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/cipher|fingerprint|0000003456/iu);
  });

  it('rotates a CBE receiving phone through the v2 lookup-protected path', async () => {
    const oldReceiver = row({ provider_code: 'cbe_birr', provider_display_name: 'CBE Birr' });
    const retiredReceiver = {
      ...oldReceiver,
      receiver_status: 'inactive',
      retired_at: new Date('2026-10-23T18:00:00Z'),
    };
    const newReceiver = row({
      provider_code: 'cbe_birr',
      provider_display_name: 'CBE Birr',
      receiver_revision_id: requestId,
      revision: 3,
    });
    let listCalls = 0;
    const query = vi.fn<OwnerReceiverDatabase['query']>(async (sql, values) => {
      if (sql.includes('list_owner_receiver_accounts')) {
        listCalls += 1;
        return { rows: listCalls === 1 ? [oldReceiver] : [retiredReceiver, newReceiver] };
      }
      expect(sql).toContain('rotate_owner_cbe_birr_receiver_lookup_v2');
      expect(values.slice(0, 5)).toEqual([
        authUserId,
        requestId,
        requestId,
        3,
        'FetanAgent Receiver',
      ]);
      expect(values[5]).toMatch(/^receiver-v1\.cbe_birr\./u);
      expect(values[8]).toMatch(/^cbe-receiver-v2\./u);
      expect(values[11]).toBe('account_rotation');
      expect(JSON.stringify(values)).not.toContain('251000003456');
      return {
        rows: [
          {
            receiver_revision_id: requestId,
            revision: 3,
            receiver_status: 'active',
            active_from: new Date(),
            lookup_protected: true,
          },
        ],
      };
    });
    const control = new PostgresOwnerReceiverAccounts({ query }, secrets, {
      encryptionSecret: 'e'.repeat(64),
      fingerprintSecret: 'f'.repeat(64),
    });
    await expect(
      control.rotate(authUserId, {
        accountHolderName: 'FetanAgent Receiver',
        accountReference: '251000003456',
        providerCode: 'cbe_birr',
        requestId,
        rotationReason: 'account_rotation',
      }),
    ).resolves.toMatchObject({
      providerCode: 'cbe_birr',
      receiverRevisionId: requestId,
      revision: 3,
      protectedReference: true,
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('requires a full 251 phone for new CBE Birr revisions without changing TeleBirr rules', async () => {
    expect(validOwnerReceiverAccountReference('cbe_birr', '251000003456')).toBe(true);
    expect(validOwnerReceiverAccountReference('telebirr', '0000003456')).toBe(true);
    expect(validOwnerReceiverAccountReference('telebirr', '251000003456')).toBe(true);
    for (const invalid of [
      '000003456',
      '0000003456',
      '25100000345',
      '2510000034567',
      '+251000003456',
      '25100000345 ',
      '251０００００３４５６',
    ]) {
      expect(validOwnerReceiverAccountReference('cbe_birr', invalid)).toBe(false);
      const query = vi.fn<OwnerReceiverDatabase['query']>();
      const control = new PostgresOwnerReceiverAccounts({ query }, secrets);
      await expect(
        control.rotate(authUserId, {
          accountHolderName: 'FetanAgent Receiver',
          accountReference: invalid,
          providerCode: 'cbe_birr',
          requestId,
          rotationReason: 'owner_correction',
        }),
      ).rejects.toBeInstanceOf(OwnerReceiverAccountRejectedError);
      expect(query).not.toHaveBeenCalled();
    }
    expect(validOwnerReceiverAccountReference('other', '251000003456')).toBe(false);
  });

  it('still rejects missing or mismatched provider display names in history', async () => {
    for (const value of [rotationRow(), row({ provider_display_name: 'Other provider' })]) {
      const control = new PostgresOwnerReceiverAccounts(
        { query: async () => ({ rows: [value] }) },
        secrets,
      );
      await expect(control.list(authUserId)).rejects.toBeInstanceOf(
        OwnerReceiverAccountUnavailableError,
      );
    }
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
              row({
                account_reference_masked: '****4567',
                protected_reference: false,
                receiver_revision_id: '77777777-7777-4777-8777-777777777777',
                receiver_status: 'inactive',
                retired_at: new Date('2026-08-21T13:30:00.000Z'),
                revision: 1,
                rotation_reason: null,
              }),
              row({
                account_reference_masked: '****TEST',
                protected_reference: false,
                receiver_revision_id: '88888888-8888-4888-8888-888888888888',
                receiver_status: 'inactive',
                retired_at: new Date('2026-08-20T13:30:00.000Z'),
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
    expect(result).toHaveLength(5);
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
    expect(result[3]).toMatchObject({
      accountReferenceMasked: '****4567',
      protectedReference: false,
      receiverStatus: 'inactive',
    });
    expect(result[4]).toMatchObject({
      accountReferenceMasked: '****TEST',
      protectedReference: false,
      receiverStatus: 'inactive',
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

    for (const invalid of [
      row({ account_reference_masked: '****3456' }),
      row({ account_reference_masked: '****3456', protected_reference: false }),
      row({ account_reference_masked: '****TEST' }),
      row({ account_reference_masked: '****TEST', protected_reference: false }),
    ]) {
      const legacyMaskOutsideRetiredHistory = new PostgresOwnerReceiverAccounts(
        { query: async () => ({ rows: [invalid] }) },
        secrets,
      );
      await expect(legacyMaskOutsideRetiredHistory.list(authUserId)).rejects.toBeInstanceOf(
        OwnerReceiverAccountUnavailableError,
      );
    }
  });
});
