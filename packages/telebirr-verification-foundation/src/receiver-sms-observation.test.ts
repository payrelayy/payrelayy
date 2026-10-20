import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  RECEIVER_SMS_PROTOCOL_MODE,
  canonicalReceiverSmsEventSignatureBytes,
  digestReceiverSmsEventBody,
  verifyReceiverSmsEvent,
} from './receiver-sms-observation.js';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = publicKey.export({ format: 'der', type: 'spki' });
const sha256 = (value: string | Buffer) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
const sms =
  'You have received ETB 100.00 from Synthetic Sender on 20/10/2026 17:47:00. Your transaction number is SYNTHETIC001. Thank you for using telebirr';

function fixture() {
  const body = {
    contractVersion: 1,
    protocolMode: RECEIVER_SMS_PROTOCOL_MODE,
    deviceId: 'receiver_device_001',
    keyId: 'receiver_key_001',
    sourceSubscriptionId: 5,
    sourceMessageDigest: sha256(sms),
    providerCode: 'telebirr',
    transactionReference: 'SYNTHETIC001',
    amountMinor: 10_000,
    occurredAt: '2026-10-20T14:47:00.000Z',
    receivedAt: '2026-10-20T14:47:00.000Z',
    observedAt: '2026-10-20T14:48:00.000Z',
  };
  const signedEvent = {
    contractVersion: 1,
    protocolMode: RECEIVER_SMS_PROTOCOL_MODE,
    bodyDigest: digestReceiverSmsEventBody(body)!,
    body,
    signature: sign('sha256', canonicalReceiverSmsEventSignatureBytes(body)!, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  return {
    input: {
      assessedAt: '2026-10-20T14:48:03.000Z',
      trustedEnrollment: {
        deviceId: body.deviceId,
        keyId: body.keyId,
        publicKeySpkiSha256: sha256(spki),
        state: 'active',
        validFrom: '2026-10-20T00:00:00.000Z',
        validUntil: '2026-10-21T00:00:00.000Z',
      },
      signedEvent,
    },
    spki,
  };
}

describe('receiver SMS event authentication', () => {
  it('shares the Android event transcript digest', () => {
    const { input } = fixture();
    const body = {
      ...input.signedEvent.body,
      sourceMessageDigest: `sha256:${'e'.repeat(64)}`,
    };
    expect(digestReceiverSmsEventBody(body)).toBe(
      'sha256:56ba3d983fe669636fbfb379fbc2322c4584385b8ad51ae7653210786007d207',
    );
  });
  it('verifies signed payment fields and keeps the reference out of its result', () => {
    const { input, spki: key } = fixture();
    let delivered: string | undefined;
    const result = verifyReceiverSmsEvent(input, key, (value) => {
      delivered = value.transactionReference;
    });
    expect(result.disposition).toBe('verified_phone_sms');
    expect(result.bankAuthenticationPerformed).toBe(false);
    expect(result.financialActionAllowed).toBe(false);
    expect(delivered).toBe('SYNTHETIC001');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC001');
    expect(JSON.stringify(result)).not.toContain('ETB 100.00');
  });

  it('does not deliver altered messages or accept another device', () => {
    const { input, spki: key } = fixture();
    const otherKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
      format: 'der',
      type: 'spki',
    });
    const attempts = [
      {
        input: {
          ...input,
          signedEvent: {
            ...input.signedEvent,
            body: { ...input.signedEvent.body, transactionReference: 'SYNTHETIC002' },
          },
        },
        key,
      },
      { input, key: otherKey },
      {
        input: { ...input, trustedEnrollment: { ...input.trustedEnrollment, state: 'revoked' } },
        key,
      },
    ];
    for (const attempt of attempts) {
      let delivered = false;
      expect(
        verifyReceiverSmsEvent(attempt.input, attempt.key, () => {
          delivered = true;
        }).disposition,
      ).toBe('review');
      expect(delivered).toBe(false);
    }
  });

  it('accepts delayed upload but rejects an event older than seven days', () => {
    const { input, spki: key } = fixture();
    expect(verifyReceiverSmsEvent(input, key).disposition).toBe('verified_phone_sms');
    expect(
      verifyReceiverSmsEvent({ ...input, assessedAt: '2026-10-28T14:48:00.000Z' }, key).disposition,
    ).toBe('review');
  });
});
