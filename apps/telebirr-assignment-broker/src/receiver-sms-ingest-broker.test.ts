import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  RECEIVER_SMS_PROTOCOL_MODE,
  canonicalReceiverSmsEventSignatureBytes,
  digestReceiverSmsEventBody,
} from '@fetanagent/telebirr-verification-foundation';

import { createReceiverSmsIngestBroker } from './receiver-sms-ingest-broker.js';
import type { ReceiverSmsIngestDatabase } from './receiver-sms-ingest-broker.js';

const sha256 = (value: string | Buffer) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

function fixture(providerCode: 'telebirr' | 'cbe_birr' = 'telebirr') {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = keys.publicKey.export({ format: 'der', type: 'spki' });
  const body = {
    contractVersion: 1,
    protocolMode: RECEIVER_SMS_PROTOCOL_MODE,
    deviceId: 'receiver_device_001',
    keyId: 'receiver_key_001',
    sourceSubscriptionId: 0,
    sourceMessageDigest: sha256('synthetic SMS'),
    providerCode,
    transactionReference: 'SYNTHETIC1234',
    amountMinor: 12_345,
    occurredAt: '2026-10-20T14:47:00.000Z',
    receivedAt: '2026-10-20T14:47:01.000Z',
    observedAt: '2026-10-20T14:47:02.000Z',
  };
  const signedEvent = {
    contractVersion: 1,
    protocolMode: RECEIVER_SMS_PROTOCOL_MODE,
    bodyDigest: digestReceiverSmsEventBody(body),
    body,
    signature: sign('sha256', canonicalReceiverSmsEventSignatureBytes(body)!, {
      key: keys.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  const enrollment = {
    deviceId: body.deviceId,
    keyId: body.keyId,
    publicKeySpkiSha256: sha256(spki),
    state: 'active',
    validFrom: '2026-10-20T00:00:00.000Z',
    validUntil: '2026-10-21T00:00:00.000Z',
  };
  return { body, signedEvent, enrollment, publicKeySpki: spki.toString('base64url') };
}

describe('private receiver SMS ingestion', () => {
  it.each(['telebirr', 'cbe_birr'] as const)(
    'records one paired-phone %s fact using only a reference digest',
    async (providerCode) => {
      const f = fixture(providerCode);
      const recordPayment = vi.fn(
        async (_input: Parameters<ReceiverSmsIngestDatabase['recordPayment']>[0]) =>
          'recorded' as const,
      );
      const broker = createReceiverSmsIngestBroker(
        {
          loadEnrollment: async () => f.enrollment,
          recordPayment,
        },
        () => '2026-10-20T14:47:03.000Z',
      );
      expect(await broker.verifyAndRecord(f)).toBe('recorded');
      expect(recordPayment).toHaveBeenCalledOnce();
      const recorded = recordPayment.mock.calls[0]?.[0];
      expect(recorded?.payment.amountMinor).toBe(12_345);
      expect(recorded?.payment.providerCode).toBe(providerCode);
      expect(recorded?.referenceDigest).toBe(sha256('SYNTHETIC1234'));
    },
  );

  it('does not store altered amount or an unenrolled phone event', async () => {
    const f = fixture();
    const recordPayment = vi.fn(
      async (_input: Parameters<ReceiverSmsIngestDatabase['recordPayment']>[0]) =>
        'recorded' as const,
    );
    const broker = createReceiverSmsIngestBroker(
      {
        loadEnrollment: async () => f.enrollment,
        recordPayment,
      },
      () => '2026-10-20T14:47:03.000Z',
    );
    expect(
      await broker.verifyAndRecord({
        publicKeySpki: f.publicKeySpki,
        signedEvent: { ...f.signedEvent, body: { ...f.body, amountMinor: 90_000 } },
      }),
    ).toBe('review');
    expect(recordPayment).not.toHaveBeenCalled();
    const missing = createReceiverSmsIngestBroker(
      {
        loadEnrollment: async () => undefined,
        recordPayment,
      },
      () => '2026-10-20T14:47:03.000Z',
    );
    expect(await missing.verifyAndRecord(f)).toBe('review');
    expect(recordPayment).not.toHaveBeenCalled();
  });
});
