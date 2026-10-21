import { describe, expect, it, vi } from 'vitest';

import { createReceiverSmsIngestPostgresDatabase } from './receiver-sms-ingest-postgres.js';

describe('receiver SMS narrow SQL adapter', () => {
  it('passes a digest instead of a raw reference to the database', async () => {
    const query = vi.fn(async (_sql: string, _values: readonly unknown[]) => ({
      rows: [{ status: 'recorded' }],
    }));
    const database = createReceiverSmsIngestPostgresDatabase({ query });
    expect(
      await database.recordPayment({
        event: {
          deviceId: 'receiver_device_001',
          keyId: 'receiver_key_001',
          sourceSubscriptionId: 0,
          sourceMessageDigest: `sha256:${'a'.repeat(64)}`,
          eventBodyDigest: `sha256:${'b'.repeat(64)}`,
          receivedAt: '2026-10-20T14:47:01.000Z',
          observedAt: '2026-10-20T14:47:02.000Z',
        },
        payment: {
          providerCode: 'telebirr',
          transactionReference: 'SYNTHETIC1234',
          amountMinor: 12_345,
          occurredAt: '2026-10-20T14:47:00.000Z',
        },
        referenceDigest: `sha256:${'c'.repeat(64)}`,
        referenceFingerprint: 'e'.repeat(64),
        devicePublicKeySpkiSha256: `sha256:${'d'.repeat(64)}`,
      }),
    ).toBe('recorded');
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('app.record_receiver_sms_payment_event');
    expect(query.mock.calls[0]?.[1]).not.toContain('SYNTHETIC1234');
    expect(query.mock.calls[0]?.[1]?.[1]).toBe(`sha256:${'c'.repeat(64)}`);
    expect(query.mock.calls[0]?.[1]?.[2]).toBe('e'.repeat(64));
  });
});
