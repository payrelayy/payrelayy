import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  RECEIVER_SMS_PROTOCOL_MODE,
  canonicalReceiverSmsEventSignatureBytes,
  digestReceiverSmsEventBody,
  type ReceiverSmsVerifiedPayment,
} from '@fetanagent/telebirr-verification-foundation';

import {
  createReceiverSmsUploadBridgeHandler,
  RECEIVER_SMS_UPLOAD_CONTENT_TYPE,
  RECEIVER_SMS_UPLOAD_PATH,
} from './receiver-sms-upload-bridge.js';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = publicKey.export({ format: 'der', type: 'spki' });
const digest = (value: string | Buffer) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

function fixture() {
  const body = {
    contractVersion: 1,
    protocolMode: RECEIVER_SMS_PROTOCOL_MODE,
    deviceId: 'receiver_device_001',
    keyId: 'receiver_key_001',
    sourceSubscriptionId: 1,
    sourceMessageDigest: digest('synthetic payment SMS'),
    providerCode: 'cbe_birr',
    transactionReference: 'SYNTHCBE001',
    amountMinor: 50_000,
    occurredAt: '2026-10-20T14:47:00.000Z',
    receivedAt: '2026-10-20T14:47:05.000Z',
    observedAt: '2026-10-20T14:48:00.000Z',
  };
  const signedEvent = {
    contractVersion: 1,
    protocolMode: RECEIVER_SMS_PROTOCOL_MODE,
    bodyDigest: digestReceiverSmsEventBody(body),
    body,
    signature: sign('sha256', canonicalReceiverSmsEventSignatureBytes(body)!, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  const enrollment = {
    deviceId: body.deviceId,
    keyId: body.keyId,
    publicKeySpkiSha256: digest(spki),
    state: 'active',
    validFrom: '2026-10-20T00:00:00.000Z',
    validUntil: '2026-10-21T00:00:00.000Z',
  };
  const request = (event: unknown = signedEvent) => ({
    method: 'POST',
    path: RECEIVER_SMS_UPLOAD_PATH,
    headers: [['Content-Type', RECEIVER_SMS_UPLOAD_CONTENT_TYPE]] as const,
    body: Buffer.from(
      JSON.stringify({ publicKeySpki: spki.toString('base64url'), signedEvent: event }),
    ),
  });
  return { body, signedEvent, enrollment, request };
}

describe('receiver SMS upload bridge', () => {
  it('records a signed CBE payment without returning a reference or credit action', async () => {
    const f = fixture();
    const recordPayment = vi.fn(
      async (_input: { payment: ReceiverSmsVerifiedPayment }) => 'recorded' as const,
    );
    const handler = createReceiverSmsUploadBridgeHandler({
      now: () => '2026-10-20T14:48:03.000Z',
      loadEnrollment: async () => f.enrollment,
      recordPayment,
    });
    const result = await handler(f.request());
    expect(result.statusCode).toBe(202);
    expect(recordPayment).toHaveBeenCalledOnce();
    expect(recordPayment.mock.calls[0]?.[0].payment).toEqual({
      providerCode: 'cbe_birr',
      transactionReference: 'SYNTHCBE001',
      amountMinor: 50_000,
      occurredAt: '2026-10-20T14:47:00.000Z',
    });
    expect(result.body.toString()).not.toContain('SYNTHCBE001');
    expect(JSON.parse(result.body.toString())).toEqual({
      outcome: 'receiver_sms_recorded',
      advisoryOnly: true,
      pairedPhoneEvidenceVerified: true,
      sourceAuthenticationPerformed: false,
      financialActionAllowed: false,
    });
  });

  it('never records altered fields, an unpaired key, or an unavailable enrollment', async () => {
    const f = fixture();
    const recordPayment = vi.fn(
      async (_input: { payment: ReceiverSmsVerifiedPayment }) => 'recorded' as const,
    );
    const handler = createReceiverSmsUploadBridgeHandler({
      now: () => '2026-10-20T14:48:03.000Z',
      loadEnrollment: async () => f.enrollment,
      recordPayment,
    });
    expect(
      (
        await handler(
          f.request({
            ...f.signedEvent,
            body: {
              ...f.body,
              amountMinor: 900_000,
            },
          }),
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await handler(
          f.request({
            ...f.signedEvent,
            body: {
              ...f.body,
              deviceId: 'another_device_001',
            },
          }),
        )
      ).statusCode,
    ).toBe(403);
    expect(recordPayment).not.toHaveBeenCalled();
  });
});
