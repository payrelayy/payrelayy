import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ROUTINE_NO_MONEY_POLL_MODE,
  ROUTINE_NO_MONEY_POLL_TRANSCRIPT,
  canonicalRoutineNoMoneyPollSignatureBytes,
  digestRoutineNoMoneyPollBody,
  verifyRoutineNoMoneyPollRequest,
} from './routine-no-money-poll.js';

function fixture() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = keys.publicKey.export({ format: 'der', type: 'spki' });
  const enrollment = {
    enrollmentId: 'e0b29bed-3337-4a3d-8c31-87bec24f2056',
    deviceId: 'routine-device-0001',
    keyId: 'routine-device-key-0001',
    publicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
    state: 'active',
    validFrom: '2026-10-07T10:00:00.000Z',
    validUntil: '2026-10-08T10:00:00.000Z',
    receiverRevisionId: '20c66227-44ea-414c-9673-63e7b320375d',
    receiverProfileDigest: `sha256:${'a'.repeat(64)}`,
  };
  const body = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_NO_MONEY_POLL_MODE,
    enrollmentId: enrollment.enrollmentId,
    deviceId: enrollment.deviceId,
    keyId: enrollment.keyId,
    receiverRevisionId: enrollment.receiverRevisionId,
    receiverProfileDigest: enrollment.receiverProfileDigest,
    requestId: 'aa7665c4-9aba-478d-a561-624164313426',
    issuedAt: '2026-10-07T12:00:00.000Z',
    expiresAt: '2026-10-07T12:01:00.000Z',
    evidenceOnly: true,
    financialActionAllowed: false,
  };
  const signed = (requestBody: typeof body) => ({
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_NO_MONEY_POLL_MODE,
    transcriptVersion: ROUTINE_NO_MONEY_POLL_TRANSCRIPT,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineNoMoneyPollBody(requestBody)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body: requestBody,
    signature: sign('sha256', canonicalRoutineNoMoneyPollSignatureBytes(requestBody)!, {
      key: keys.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
  return { enrollment, body, signed, spki };
}

describe('routine no-money phone poll request', () => {
  it('authenticates the device without granting a poll, database, or money capability', () => {
    const { enrollment, body, signed, spki } = fixture();
    expect(digestRoutineNoMoneyPollBody(body)).toBe(
      'sha256:1156e01f06f84f3c96e72321a07f32dec8af36cf7045c3d949691b5cc127f804',
    );
    const assessment = verifyRoutineNoMoneyPollRequest(
      signed(body),
      enrollment,
      spki,
      '2026-10-07T12:00:30.000Z',
    );
    expect(assessment).toMatchObject({
      advisoryOnly: true,
      deviceSignatureVerified: true,
      databaseBindingPerformed: false,
      pollAuthorized: false,
      financialActionAllowed: false,
      disposition: 'would_consider_no_money_poll',
      reasonCode: 'signed_request_matches_enrollment',
    });
    expect(assessment.replayIdentity).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(assessment)).not.toContain(body.deviceId);
  });

  it('rejects a mismatched enrollment, a revoked phone, and another public key', () => {
    const { enrollment, body, signed, spki } = fixture();
    const request = signed(body);
    expect(
      verifyRoutineNoMoneyPollRequest(
        request,
        { ...enrollment, receiverProfileDigest: `sha256:${'b'.repeat(64)}` },
        spki,
        '2026-10-07T12:00:30.000Z',
      ).reasonCode,
    ).toBe('binding_mismatch');
    expect(
      verifyRoutineNoMoneyPollRequest(
        request,
        { ...enrollment, state: 'revoked' },
        spki,
        '2026-10-07T12:00:30.000Z',
      ).reasonCode,
    ).toBe('device_unavailable');
    const otherSpki = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
      format: 'der',
      type: 'spki',
    });
    expect(
      verifyRoutineNoMoneyPollRequest(request, enrollment, otherSpki, '2026-10-07T12:00:30.000Z')
        .reasonCode,
    ).toBe('device_unavailable');
  });

  it('rejects altered signatures, extra fields, and expired requests', () => {
    const { enrollment, body, signed, spki } = fixture();
    const request = signed(body);
    expect(
      verifyRoutineNoMoneyPollRequest(
        { ...request, signature: 'A'.repeat(86) },
        enrollment,
        spki,
        '2026-10-07T12:00:30.000Z',
      ).reasonCode,
    ).toBe('signature_invalid');
    expect(
      verifyRoutineNoMoneyPollRequest(
        { ...request, body: { ...body, sourceAuthenticationPerformed: true } },
        enrollment,
        spki,
        '2026-10-07T12:00:30.000Z',
      ).reasonCode,
    ).toBe('invalid_request');
    expect(
      verifyRoutineNoMoneyPollRequest(request, enrollment, spki, '2026-10-07T12:01:00.000Z')
        .reasonCode,
    ).toBe('request_expired');
    expect(
      verifyRoutineNoMoneyPollRequest(
        signed({ ...body, expiresAt: '2026-10-07T12:02:00.000Z' }),
        enrollment,
        spki,
        '2026-10-07T12:00:30.000Z',
      ).reasonCode,
    ).toBe('request_expired');
  });
});
