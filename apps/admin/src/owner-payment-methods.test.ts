import { describe, expect, it, vi } from 'vitest';

import {
  OwnerPaymentMethodsRejectedError,
  OwnerPaymentMethodsUnavailableError,
  PostgresOwnerPaymentMethods,
  type PaymentMethodsDatabase,
} from './owner-payment-methods.js';

const owner = '11111111-1111-4111-8111-111111111111';
const request = '22222222-2222-4222-8222-222222222222';
const at = new Date('2026-10-23T18:00:00Z');
const rows = [
  {
    provider_code: 'cbe_birr',
    owner_enabled: true,
    readiness: 'ready',
    receiver_name: 'Receiver',
    receiver_masked: '***1234',
    pending_jobs: '0',
    fenced_attempts: '0',
    changed_at: at,
  },
  {
    provider_code: 'telebirr',
    owner_enabled: false,
    readiness: 'phone_not_paired',
    receiver_name: 'Receiver',
    receiver_masked: '***5678',
    pending_jobs: '1',
    fenced_attempts: '0',
    changed_at: at,
  },
];

describe('Owner payment-method adapter', () => {
  it('returns exactly two validated masked methods and uses an idempotent switch request', async () => {
    const query = vi.fn<PaymentMethodsDatabase['query']>(async (sql, values) => {
      if (sql.includes('set_owner_provider_deposit_control')) {
        expect(values).toEqual([owner, request, 'cbe_birr', false]);
        return { rows: [{ set_owner_provider_deposit_control: false }] };
      }
      expect(values).toEqual([owner]);
      return { rows };
    });
    const control = new PostgresOwnerPaymentMethods({ query });
    const methods = await control.set(owner, request, 'cbe_birr', false);
    expect(methods).toHaveLength(2);
    expect(methods[0]).toMatchObject({
      providerCode: 'cbe_birr',
      receiverMasked: '***1234',
      pendingJobs: 0,
    });
    expect(methods[1]).toMatchObject({ providerCode: 'telebirr', pendingJobs: 1 });
    expect(JSON.stringify(methods)).not.toContain('receiver-v1');
  });

  it('fails closed on a duplicate or malformed database projection', async () => {
    for (const result of [
      [rows[0], rows[0]],
      [rows[0]],
      [{ ...rows[0], receiver_masked: '251911111234' }, rows[1]],
    ]) {
      const control = new PostgresOwnerPaymentMethods({ query: async () => ({ rows: result }) });
      await expect(control.list(owner)).rejects.toBeInstanceOf(OwnerPaymentMethodsUnavailableError);
    }
  });

  it('rejects malformed requests before querying', async () => {
    const query = vi.fn<PaymentMethodsDatabase['query']>();
    const control = new PostgresOwnerPaymentMethods({ query });
    await expect(control.set(owner, 'not-a-request-id', 'telebirr', true)).rejects.toBeInstanceOf(
      OwnerPaymentMethodsRejectedError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('publishes only boolean availability flags', async () => {
    const control = new PostgresOwnerPaymentMethods({
      query: async () => ({
        rows: [
          { provider_code: 'cbe_birr', accepting: false },
          { provider_code: 'telebirr', accepting: true },
        ],
      }),
    });
    await expect(control.publicStatus()).resolves.toEqual({ cbe_birr: false, telebirr: true });
  });
});
