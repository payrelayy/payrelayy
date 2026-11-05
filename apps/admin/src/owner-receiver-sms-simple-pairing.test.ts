import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  PostgresOwnerReceiverSmsSimplePairing,
  ReceiverSmsSimplePairingRejectedError,
  receiverSmsPairingTranscript,
  type ReceiverSmsSimplePairingRequest,
} from './owner-receiver-sms-simple-pairing.js';

const OWNER = '6f7f0832-03dc-430f-a9ab-5cf767a25554';
const ENROLLMENT = 'e14d77f8-24a5-4579-8517-797a69e3c108';

function signedRequest(code: string): ReceiverSmsSimplePairingRequest {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const fingerprint = createHash('sha256').update(spki).digest('hex');
  const request = {
    code,
    deviceId: `routine_device_${fingerprint}`,
    keyId: `routine_key_${fingerprint}`,
    publicKeySpki: spki.toString('base64url'),
    signature: '',
  };
  return {
    ...request,
    signature: sign('sha256', receiverSmsPairingTranscript(request), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
}

describe('one-code receiver SMS phone pairing', () => {
  it('issues exactly 12 allowed characters and stores only a digest', async () => {
    const query = vi.fn(async (_sql: string, values: readonly string[]) => {
      expect(values[0]).toBe(OWNER);
      expect(values[1]).toMatch(/^sha256:[0-9a-f]{64}$/u);
      return { rows: [{ pairing_id: '1ed8e2ed-ab2b-4051-921f-6553574f4440' }] };
    });
    const result = await new PostgresOwnerReceiverSmsSimplePairing({ query }).issue(OWNER);
    expect(result.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/u);
    expect(JSON.stringify(query.mock.calls)).not.toContain(result.code);
  });

  it('accepts a phone-owned P-256 key and rejects a changed code or device ID', async () => {
    const query = vi.fn(async (_sql: string, values: readonly string[]) => {
      expect(values[0]).toBe(`sha256:${createHash('sha256').update('ABCDEFGHJKLM').digest('hex')}`);
      expect(values[1]).toMatch(/^sha256:[0-9a-f]{64}$/u);
      return { rows: [{ enrollment_id: ENROLLMENT, already_enrolled: false }] };
    });
    const pairing = new PostgresOwnerReceiverSmsSimplePairing({ query });
    const request = signedRequest('ABCDEFGHJKLM');
    await expect(pairing.activate(request)).resolves.toEqual({
      enrollmentId: ENROLLMENT,
      deviceId: request.deviceId,
      keyId: request.keyId,
      alreadyEnrolled: false,
    });
    await expect(pairing.activate({ ...request, code: 'ABCDEFGHJKLN' })).rejects.toBeInstanceOf(
      ReceiverSmsSimplePairingRejectedError,
    );
    await expect(
      pairing.activate({ ...request, deviceId: 'routine_device_fake' }),
    ).rejects.toBeInstanceOf(ReceiverSmsSimplePairingRejectedError);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
