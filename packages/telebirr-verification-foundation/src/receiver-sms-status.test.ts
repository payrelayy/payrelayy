import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { digestReceiverSmsStatusBody, verifyReceiverSmsStatus } from './receiver-sms-status.js';

const observedAt = '2026-11-03T09:00:00.000Z';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = publicKey.export({ type: 'spki', format: 'der' });
const deviceId = 'receiver_phone_01';
const keyId = 'receiver_key_01';
const enrollment = {
  deviceId,
  keyId,
  publicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
  state: 'active',
  validFrom: '2026-11-02T00:00:00.000Z',
  validUntil: '2026-11-04T00:00:00.000Z',
};

function signed(state: 'ready' | 'attention', queuedSmsCount?: number) {
  const body = {
    contractVersion: 1,
    protocolMode: 'receiver_sms_status_v1',
    deviceId,
    keyId,
    state,
    observedAt,
    ...(queuedSmsCount === undefined ? {} : { queuedSmsCount }),
  };
  const bodyDigest = digestReceiverSmsStatusBody(body)!;
  return {
    contractVersion: 1,
    protocolMode: 'receiver_sms_status_v1',
    bodyDigest,
    body,
    signature: sign(
      'sha256',
      Buffer.from(JSON.stringify(['fetanagent:receiver-sms-status-signature:v1', bodyDigest])),
      { key: privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url'),
  };
}

describe('receiver SMS status signature', () => {
  it('accepts a recent paired-phone report without payment data', () => {
    expect(verifyReceiverSmsStatus(signed('ready'), spki, enrollment, observedAt)).toMatchObject({
      deviceId,
      state: 'ready',
    });
  });

  it('verifies a signed queue count and rejects altered or invalid counts', () => {
    const report = signed('ready', 17);
    expect(verifyReceiverSmsStatus(report, spki, enrollment, observedAt)?.queuedSmsCount).toBe(17);
    expect(
      verifyReceiverSmsStatus(
        { ...report, body: { ...report.body, queuedSmsCount: 18 } },
        spki,
        enrollment,
        observedAt,
      ),
    ).toBeUndefined();
    for (const count of [-1, 100_001, 0.5]) {
      expect(
        digestReceiverSmsStatusBody({ ...report.body, queuedSmsCount: count }),
      ).toBeUndefined();
    }
  });

  it('rejects a changed state, stale report, and different enrollment', () => {
    const report = signed('ready');
    expect(
      verifyReceiverSmsStatus(
        { ...report, body: { ...report.body, state: 'attention' } },
        spki,
        enrollment,
        observedAt,
      ),
    ).toBeUndefined();
    expect(
      verifyReceiverSmsStatus(report, spki, enrollment, '2026-11-03T09:01:01.000Z'),
    ).toBeUndefined();
    expect(
      verifyReceiverSmsStatus(report, spki, { ...enrollment, state: 'revoked' }, observedAt),
    ).toBeUndefined();
  });
});
