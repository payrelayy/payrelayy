import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ROUTINE_PAID_POLL_MODE,
  ROUTINE_PAID_POLL_TRANSCRIPT,
  canonicalRoutinePaidPollSignatureBytes,
  digestRoutinePaidPollBody,
  verifyRoutinePaidPollRequest,
} from './routine-paid-poll.js';
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
    protocolMode: ROUTINE_PAID_POLL_MODE,
    enrollmentId: enrollment.enrollmentId,
    deviceId: enrollment.deviceId,
    keyId: enrollment.keyId,
    receiverRevisionId: enrollment.receiverRevisionId,
    receiverProfileDigest: enrollment.receiverProfileDigest,
    requestId: 'aa7665c4-9aba-478d-a561-624164313426',
    issuedAt: '2026-10-07T12:00:00.000Z',
    expiresAt: '2026-10-07T12:01:00.000Z',
    paymentVerificationRequested: true,
    financialActionAllowed: false,
  };
  const signed = (requestBody: typeof body) => ({
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_PAID_POLL_MODE,
    transcriptVersion: ROUTINE_PAID_POLL_TRANSCRIPT,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutinePaidPollBody(requestBody)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body: requestBody,
    signature: sign('sha256', canonicalRoutinePaidPollSignatureBytes(requestBody)!, {
      key: keys.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
  return { enrollment, body, signed, spki, privateKey: keys.privateKey };
}

describe('routine paid phone poll request', () => {
  it('authenticates the paired phone without granting a payment or poll capability', () => {
    const { enrollment, body, signed, spki } = fixture();
    expect(digestRoutinePaidPollBody(body)).toBe(
      'sha256:9bb55d3a6405c4c9e763fd32489aad7e34ea5a6d1be9617db75cacb5f1f637ba',
    );
    const assessment = verifyRoutinePaidPollRequest(
      signed(body),
      enrollment,
      spki,
      '2026-10-07T12:00:30.000Z',
    );
    expect(assessment).toMatchObject({
      deviceSignatureVerified: true,
      databaseBindingPerformed: false,
      pollAuthorized: false,
      financialActionAllowed: false,
      disposition: 'signed_paid_poll_matches_enrollment',
      reasonCode: 'signed_request_matches_enrollment',
    });
    expect(assessment.replayIdentity).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(assessment)).not.toContain(body.deviceId);
  });

  it('is not interchangeable with a signed no-money poll', () => {
    const { enrollment, body, signed, spki, privateKey } = fixture();
    const request = signed(body);
    expect(
      verifyRoutineNoMoneyPollRequest(request, enrollment, spki, '2026-10-07T12:00:30.000Z')
        .disposition,
    ).toBe('would_review');
    expect(
      verifyRoutinePaidPollRequest(
        { ...request, body: { ...body, evidenceOnly: true } },
        enrollment,
        spki,
        '2026-10-07T12:00:30.000Z',
      ).reasonCode,
    ).toBe('invalid_request');
    const noMoneyBody = {
      ...body,
      protocolMode: ROUTINE_NO_MONEY_POLL_MODE,
      evidenceOnly: true,
    };
    const { paymentVerificationRequested: _purpose, ...noMoneyExactBody } = noMoneyBody;
    const noMoneyRequest = {
      ...request,
      protocolMode: ROUTINE_NO_MONEY_POLL_MODE,
      transcriptVersion: ROUTINE_NO_MONEY_POLL_TRANSCRIPT,
      bodyDigest: digestRoutineNoMoneyPollBody(noMoneyExactBody)!,
      body: noMoneyExactBody,
      signature: sign('sha256', canonicalRoutineNoMoneyPollSignatureBytes(noMoneyExactBody)!, {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url'),
    };
    expect(
      verifyRoutinePaidPollRequest(noMoneyRequest, enrollment, spki, '2026-10-07T12:00:30.000Z')
        .disposition,
    ).toBe('review');
  });

  it('rejects another key, revoked enrollment, altered signature, and expiry', () => {
    const { enrollment, body, signed, spki } = fixture();
    const request = signed(body);
    const time = '2026-10-07T12:00:30.000Z';
    const otherSpki = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
      format: 'der',
      type: 'spki',
    });
    expect(verifyRoutinePaidPollRequest(request, enrollment, otherSpki, time).reasonCode).toBe(
      'device_unavailable',
    );
    expect(
      verifyRoutinePaidPollRequest(request, { ...enrollment, state: 'revoked' }, spki, time)
        .reasonCode,
    ).toBe('device_unavailable');
    expect(
      verifyRoutinePaidPollRequest(
        { ...request, signature: 'A'.repeat(86) },
        enrollment,
        spki,
        time,
      ).reasonCode,
    ).toBe('signature_invalid');
    expect(
      verifyRoutinePaidPollRequest(request, enrollment, spki, '2026-10-07T12:01:00.000Z')
        .reasonCode,
    ).toBe('request_expired');
  });
});
