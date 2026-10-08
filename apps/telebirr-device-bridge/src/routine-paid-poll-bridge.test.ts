import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ROUTINE_PAID_POLL_MODE,
  ROUTINE_PAID_POLL_TRANSCRIPT,
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
  ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
  canonicalRoutinePaidPollSignatureBytes,
  canonicalRoutineTelebirrLookupAssignmentSignatureBytes,
  digestRoutinePaidPollBody,
  digestRoutineTelebirrLookupAssignmentBody,
  digestRoutineTelebirrReceiverName,
} from '@fetanagent/telebirr-verification-foundation';

import {
  ROUTINE_PAID_POLL_CONTENT_TYPE,
  ROUTINE_PAID_POLL_PATH,
  createRoutinePaidPollBridgeHandler,
} from './routine-paid-poll-bridge.js';

const sha = (letter: string) => `sha256:${letter.repeat(64)}`;
const hash = (value: Uint8Array) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const header = {
  contractVersion: 1,
  providerCode: 'telebirr',
  protocolMode: 'routine_signed_observation_v1',
};

function fixture() {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceDer = device.publicKey.export({ format: 'der', type: 'spki' });
  const signerDer = signer.publicKey.export({ format: 'der', type: 'spki' });
  const enrollmentId = 'e0b29bed-3337-4a3d-8c31-87bec24f2056';
  const reference = 'SAMPLE9ABC1234';
  const trustedLookup = {
    ...header,
    candidateId: '8b9b4a1c-616d-495b-a259-56d39ffef5d1',
    referenceFingerprint: 'a'.repeat(64),
    referenceKeyVersion: 2,
    referenceProfileVersion: 2,
    submittedAt: '2026-10-05T18:00:00.000Z',
    receiverRevisionId: '98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803',
    receiverVersion: 3,
    receiverProfileDigest: sha('b'),
    expectedReceiverNameDigest: digestRoutineTelebirrReceiverName('sample receiver')!,
    deviceId: 'routine-device-0001',
    keyId: 'routine-device-key-0001',
    challengeId: '328535af-2636-44cd-84be-6effdfe9cac1',
    challengeDigest: sha('d'),
    issuedAt: '2026-10-05T18:02:00.000Z',
    expiresAt: '2026-10-05T18:05:00.000Z',
  };
  const trustedSigner = {
    ...header,
    signerKeyId: 'routine-server-key-0001',
    publicKeySpkiSha256: hash(signerDer),
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
  };
  const deviceEnrollment = {
    ...header,
    deviceId: trustedLookup.deviceId,
    keyId: trustedLookup.keyId,
    publicKeySpkiSha256: hash(deviceDer),
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
    receiverRevisionId: trustedLookup.receiverRevisionId,
    receiverVersion: trustedLookup.receiverVersion,
    receiverProfileDigest: trustedLookup.receiverProfileDigest,
  };
  const enrollment = {
    enrollmentId,
    deviceId: deviceEnrollment.deviceId,
    keyId: deviceEnrollment.keyId,
    publicKeySpkiSha256: deviceEnrollment.publicKeySpkiSha256,
    state: deviceEnrollment.state,
    validFrom: deviceEnrollment.validFrom,
    validUntil: deviceEnrollment.validUntil,
    receiverRevisionId: deviceEnrollment.receiverRevisionId,
    receiverProfileDigest: deviceEnrollment.receiverProfileDigest,
  };
  const assignmentBody = {
    ...header,
    candidateId: trustedLookup.candidateId,
    rawReference: reference,
    referenceFingerprint: trustedLookup.referenceFingerprint,
    referenceKeyVersion: trustedLookup.referenceKeyVersion,
    referenceProfileVersion: trustedLookup.referenceProfileVersion,
    submittedAt: trustedLookup.submittedAt,
    receiverRevisionId: trustedLookup.receiverRevisionId,
    receiverVersion: trustedLookup.receiverVersion,
    receiverProfileDigest: trustedLookup.receiverProfileDigest,
    receiverNameNormalizerVersion: ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized: 'sample receiver',
    expectedReceiverNameDigest: trustedLookup.expectedReceiverNameDigest,
    deviceId: trustedLookup.deviceId,
    keyId: trustedLookup.keyId,
    challengeId: trustedLookup.challengeId,
    challengeDigest: trustedLookup.challengeDigest,
    sourceProfile: 'telebirr_official_receipt_v1',
    issuedAt: trustedLookup.issuedAt,
    expiresAt: trustedLookup.expiresAt,
  };
  const signedAssignment = {
    ...header,
    transcriptVersion: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineTelebirrLookupAssignmentBody(assignmentBody)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: trustedSigner.signerKeyId,
    body: assignmentBody,
    signature: sign(
      'sha256',
      canonicalRoutineTelebirrLookupAssignmentSignatureBytes(assignmentBody)!,
      {
        key: signer.privateKey,
        dsaEncoding: 'ieee-p1363',
      },
    ).toString('base64url'),
  };
  const pollBody = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_PAID_POLL_MODE,
    enrollmentId,
    deviceId: enrollment.deviceId,
    keyId: enrollment.keyId,
    receiverRevisionId: enrollment.receiverRevisionId,
    receiverProfileDigest: enrollment.receiverProfileDigest,
    requestId: 'aa7665c4-9aba-478d-a561-624164313426',
    issuedAt: '2026-10-05T18:02:00.000Z',
    expiresAt: '2026-10-05T18:03:00.000Z',
    paymentVerificationRequested: true,
    financialActionAllowed: false,
  };
  const signedRequest = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_PAID_POLL_MODE,
    transcriptVersion: ROUTINE_PAID_POLL_TRANSCRIPT,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutinePaidPollBody(pollBody)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body: pollBody,
    signature: sign('sha256', canonicalRoutinePaidPollSignatureBytes(pollBody)!, {
      key: device.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  return {
    enrollment,
    signedRequest,
    publicKeySpki: deviceDer.toString('base64url'),
    context: {
      enrollmentId,
      trustedLookup,
      trustedRawReference: reference,
      trustedSigner,
      deviceEnrollment,
      trustedSignerSpkiDer: signerDer,
      signedAssignment,
    },
  };
}

function request(body: unknown, contentType: string = ROUTINE_PAID_POLL_CONTENT_TYPE) {
  return {
    method: 'POST',
    path: ROUTINE_PAID_POLL_PATH,
    headers: [['content-type', contentType]] as const,
    body: Buffer.from(JSON.stringify(body)),
  };
}

const decoded = (body: Uint8Array) => JSON.parse(Buffer.from(body).toString('utf8')) as unknown;

describe('dormant routine paid phone poll bridge', () => {
  it('returns only a valid signed assignment after phone verification and database claim', async () => {
    const f = fixture();
    const claim = vi.fn(async (_input: unknown) => ({
      kind: 'assignment' as const,
      context: f.context,
    }));
    const handler = createRoutinePaidPollBridgeHandler({
      now: () => '2026-10-05T18:02:30.000Z',
      loadEnrollment: async () => ({ enrollment: f.enrollment }),
      claimAndIssuePoll: claim,
    });
    const result = await handler(
      request({ publicKeySpki: f.publicKeySpki, signedRequest: f.signedRequest }),
    );
    expect(result.statusCode).toBe(200);
    expect(decoded(result.body)).toEqual({
      outcome: 'assignment',
      advisoryOnly: true,
      paymentVerificationRequested: true,
      financialActionAllowed: false,
      signedAssignment: f.context.signedAssignment,
    });
    expect(claim).toHaveBeenCalledOnce();
    expect(claim.mock.calls[0]?.[0]).toMatchObject({
      enrollmentId: f.enrollment.enrollmentId,
      requestId: f.signedRequest.body.requestId,
      replayIdentity: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
  });

  it('rejects forged, cross-mode, and wrong-media requests before a paid claim', async () => {
    const f = fixture();
    const claim = vi.fn(async () => ({ kind: 'none' as const }));
    const handler = createRoutinePaidPollBridgeHandler({
      now: () => '2026-10-05T18:02:30.000Z',
      loadEnrollment: async () => ({ enrollment: f.enrollment }),
      claimAndIssuePoll: claim,
    });
    const forged = { ...f.signedRequest, signature: 'A'.repeat(86) };
    expect(
      (await handler(request({ publicKeySpki: f.publicKeySpki, signedRequest: forged })))
        .statusCode,
    ).toBe(401);
    const crossMode = { ...f.signedRequest, protocolMode: 'routine_no_money_poll_v1' };
    expect(
      (await handler(request({ publicKeySpki: f.publicKeySpki, signedRequest: crossMode })))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await handler(
          request(
            { publicKeySpki: f.publicKeySpki, signedRequest: f.signedRequest },
            'application/json',
          ),
        )
      ).statusCode,
    ).toBe(400);
    expect(claim).not.toHaveBeenCalled();
  });

  it('fails closed when the broker snapshot contradicts enrollment or assignment', async () => {
    const f = fixture();
    for (const context of [
      { ...f.context, deviceEnrollment: { ...f.context.deviceEnrollment, keyId: 'wrong-key' } },
      { ...f.context, trustedRawReference: 'DIFFERENT9ABC1234' },
    ]) {
      const handler = createRoutinePaidPollBridgeHandler({
        now: () => '2026-10-05T18:02:30.000Z',
        loadEnrollment: async () => ({ enrollment: f.enrollment }),
        claimAndIssuePoll: async () => ({ kind: 'assignment', context }),
      });
      const result = await handler(
        request({ publicKeySpki: f.publicKeySpki, signedRequest: f.signedRequest }),
      );
      expect(result.statusCode).toBe(503);
      expect(decoded(result.body)).toEqual({ code: 'temporarily_unavailable' });
    }
  });
});
