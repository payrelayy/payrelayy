import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { digestReceiverSmsStatusBody } from '@fetanagent/telebirr-verification-foundation';

import {
  createReceiverSmsStatusBridgeHandler,
  RECEIVER_SMS_STATUS_CONTENT_TYPE,
  RECEIVER_SMS_STATUS_PATH,
  type ReceiverSmsStatusDependencies,
} from './receiver-sms-status-bridge.js';

const now = '2026-11-03T09:00:00.000Z';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = publicKey.export({ type: 'spki', format: 'der' });
const deviceId = 'receiver_phone_01';
const keyId = 'receiver_key_01';
const enrollment = {
  deviceId,
  keyId,
  publicKeySpkiSha256: `sha256:${createHash('sha256').update(key).digest('hex')}`,
  state: 'active',
  validFrom: '2026-11-02T00:00:00.000Z',
  validUntil: '2026-11-04T00:00:00.000Z',
};

function request(tamper = false, queuedSmsCount?: number) {
  const body = {
    contractVersion: 1,
    protocolMode: 'receiver_sms_status_v1',
    deviceId,
    keyId,
    state: 'ready',
    observedAt: now,
    ...(queuedSmsCount === undefined ? {} : { queuedSmsCount }),
  };
  const bodyDigest = digestReceiverSmsStatusBody(body)!;
  const signedStatus = {
    contractVersion: 1,
    protocolMode: 'receiver_sms_status_v1',
    bodyDigest,
    body: tamper ? { ...body, state: 'attention' } : body,
    signature: sign(
      'sha256',
      Buffer.from(JSON.stringify(['fetanagent:receiver-sms-status-signature:v1', bodyDigest])),
      { key: privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url'),
  };
  return {
    method: 'POST',
    path: RECEIVER_SMS_STATUS_PATH,
    headers: [['content-type', RECEIVER_SMS_STATUS_CONTENT_TYPE]] as const,
    body: Buffer.from(JSON.stringify({ publicKeySpki: key.toString('base64url'), signedStatus })),
  };
}

describe('receiver SMS status bridge', () => {
  it('forwards only a signed current paired-phone report', async () => {
    const recordStatus = vi.fn(
      async (_input: Parameters<ReceiverSmsStatusDependencies['recordStatus']>[0]) =>
        'recorded' as const,
    );
    const handler = createReceiverSmsStatusBridgeHandler({
      now: () => now,
      loadEnrollment: async () => enrollment,
      recordStatus,
    });
    expect((await handler(request(false, 17))).statusCode).toBe(202);
    expect(recordStatus).toHaveBeenCalledOnce();
    expect(recordStatus.mock.calls[0]?.[0].verified.queuedSmsCount).toBe(17);
    expect((await handler(request(true, 17))).statusCode).toBe(403);
    expect(recordStatus).toHaveBeenCalledOnce();
    expect((await handler(request())).statusCode).toBe(202);
  });
});
