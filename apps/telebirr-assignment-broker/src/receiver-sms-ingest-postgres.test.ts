import { describe, expect, it, vi } from 'vitest';

import { createReceiverSmsIngestPostgresDatabase } from './receiver-sms-ingest-postgres.js';

describe('receiver SMS narrow SQL adapter', () => {
  it('keeps a source digest mismatch out of the private payment intake', async () => {
    const query = vi.fn(async (_sql: string, _values: readonly unknown[]) => ({
      rows: [{ status: 'recorded' }],
    }));
    const database = createReceiverSmsIngestPostgresDatabase({ query });
    await expect(
      database.recordPayment({
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
          paymentMethodCode: 'telebirr',
          canonicalReference: 'SYNTHETIC1234',
          amountMinor: 12_345,
          currencyCode: 'ETB',
          occurredAt: '2026-10-20T14:47:00.000Z',
          evidenceSource: 'receiver_sms',
          sourceDigest: `sha256:${'c'.repeat(64)}`,
          bankAuthenticationPerformed: false,
          receiverAccountBinding: { kind: 'not_attested' },
        },
        referenceDigest: `sha256:${'d'.repeat(64)}`,
        referenceFingerprint: 'e'.repeat(64),
        devicePublicKeySpkiSha256: `sha256:${'f'.repeat(64)}`,
      }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the existing status function for older phones during the rollout', async () => {
    const query = vi.fn(async (_sql: string, _values: readonly unknown[]) => ({
      rows: [{ recorded: true }],
    }));
    const database = createReceiverSmsIngestPostgresDatabase({ query });
    expect(
      await database.recordStatus({
        deviceId: 'receiver_device_001',
        keyId: 'receiver_key_001',
        state: 'ready',
        observedAt: '2026-11-06T19:00:00.000Z',
        bodyDigest: `sha256:${'a'.repeat(64)}`,
        devicePublicKeySpkiSha256: `sha256:${'b'.repeat(64)}`,
      }),
    ).toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain('app.record_receiver_sms_device_status(');
    expect(query.mock.calls[0]?.[1]).toHaveLength(6);
  });
  it('stores the verified queue count without SMS content', async () => {
    const query = vi.fn(async (_sql: string, _values: readonly unknown[]) => ({
      rows: [{ recorded: true }],
    }));
    const database = createReceiverSmsIngestPostgresDatabase({ query });
    expect(
      await database.recordStatus({
        deviceId: 'receiver_device_001',
        keyId: 'receiver_key_001',
        state: 'ready',
        observedAt: '2026-11-06T19:00:00.000Z',
        bodyDigest: `sha256:${'a'.repeat(64)}`,
        devicePublicKeySpkiSha256: `sha256:${'b'.repeat(64)}`,
        queuedSmsCount: 0,
      }),
    ).toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain('record_receiver_sms_device_status_with_queue');
    expect(query.mock.calls[0]?.[1]).toHaveLength(7);
    expect(query.mock.calls[0]?.[1]?.[6]).toBe(0);
  });
  it('uses the atomic display intake with only ciphertext after the migration', async () => {
    const query = vi.fn(async (_sql: string, _values: readonly unknown[]) => ({
      rows: [{ status: 'recorded' }],
    }));
    const database = createReceiverSmsIngestPostgresDatabase({ query });
    const ciphertext = 'sms-display-v1.cbe_birr.ciphertext';
    await database.recordPayment({
      event: {
        deviceId: 'receiver_device_001',
        keyId: 'receiver_key_001',
        sourceSubscriptionId: 0,
        sourceMessageDigest: 'sha256:' + 'a'.repeat(64),
        eventBodyDigest: 'sha256:' + 'b'.repeat(64),
        receivedAt: '2026-10-20T14:47:01.000Z',
        observedAt: '2026-10-20T14:47:02.000Z',
      },
      payment: {
        paymentMethodCode: 'cbe_birr',
        canonicalReference: 'SYNTHETIC1234',
        amountMinor: 12_345,
        currencyCode: 'ETB',
        occurredAt: '2026-10-20T14:47:00.000Z',
        evidenceSource: 'receiver_sms',
        sourceDigest: 'sha256:' + 'b'.repeat(64),
        bankAuthenticationPerformed: false,
        receiverAccountBinding: { kind: 'not_attested' },
      },
      referenceDigest: 'sha256:' + 'c'.repeat(64),
      referenceFingerprint: 'e'.repeat(64),
      devicePublicKeySpkiSha256: 'sha256:' + 'd'.repeat(64),
      displayReference: { ciphertext, masked: '***1234' },
    });
    expect(query.mock.calls[0]?.[0]).toContain('record_receiver_sms_payment_event_with_display');
    expect(query.mock.calls[0]?.[1]).toHaveLength(15);
    expect(query.mock.calls[0]?.[1]?.slice(-2)).toEqual([ciphertext, '***1234']);
    expect(query.mock.calls[0]?.[1]).not.toContain('SYNTHETIC1234');
  });
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
          paymentMethodCode: 'telebirr',
          canonicalReference: 'SYNTHETIC1234',
          amountMinor: 12_345,
          currencyCode: 'ETB',
          occurredAt: '2026-10-20T14:47:00.000Z',
          evidenceSource: 'receiver_sms',
          sourceDigest: `sha256:${'b'.repeat(64)}`,
          bankAuthenticationPerformed: false,
          receiverAccountBinding: { kind: 'not_attested' },
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
