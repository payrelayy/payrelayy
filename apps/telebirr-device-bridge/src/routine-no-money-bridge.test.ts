import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ROUTINE_NO_MONEY_POLL_MODE,
  ROUTINE_NO_MONEY_POLL_TRANSCRIPT,
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
  ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION,
  ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
  canonicalRoutineNoMoneyPollSignatureBytes,
  canonicalRoutineTelebirrLookupAssignmentSignatureBytes,
  canonicalRoutineTelebirrObservationSignatureBytes,
  digestRoutineNoMoneyPollBody,
  digestRoutineTelebirrLookupAssignmentBody,
  digestRoutineTelebirrObservationBody,
  digestRoutineTelebirrObservationFacts,
  digestRoutineTelebirrReceiverName,
} from '@fetanagent/telebirr-verification-foundation';

import {
  ROUTINE_NO_MONEY_CONTENT_TYPE,
  ROUTINE_NO_MONEY_POLL_PATH,
  ROUTINE_NO_MONEY_UPLOAD_PATH,
  createRoutineNoMoneyBridgeHandler,
  type RoutineNoMoneyBridgeDependencies,
} from './routine-no-money-bridge.js';

const sha = (letter: string): string => `sha256:${letter.repeat(64)}`;
const keyHash = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const header = {
  contractVersion: 1,
  providerCode: 'telebirr',
  protocolMode: 'routine_signed_observation_v1',
};

function fixture() {
  const serverKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerSpki = serverKey.publicKey.export({ format: 'der', type: 'spki' });
  const deviceSpki = deviceKey.publicKey.export({ format: 'der', type: 'spki' });
  const enrollmentId = 'e0b29bed-3337-4a3d-8c31-87bec24f2056';
  const rawReference = 'SAMPLE9ABC1234';
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
    publicKeySpkiSha256: keyHash(signerSpki),
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
  };
  const deviceEnrollment = {
    ...header,
    deviceId: trustedLookup.deviceId,
    keyId: trustedLookup.keyId,
    publicKeySpkiSha256: keyHash(deviceSpki),
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
    receiverRevisionId: trustedLookup.receiverRevisionId,
    receiverVersion: trustedLookup.receiverVersion,
    receiverProfileDigest: trustedLookup.receiverProfileDigest,
  };
  const pollEnrollment = {
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
    rawReference,
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
      { key: serverKey.privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url'),
  };
  const facts = {
    amountMinor: 2_500,
    canonicalReferencePresent: true,
    creditedPartyNameDigest: trustedLookup.expectedReceiverNameDigest,
    currencyCode: 'ETB',
    evidenceSource: 'provider_receipt_lookup',
    occurredAt: '2026-10-05T18:01:00.000Z',
    paymentChannel: 'api_app',
    paymentMode: 'telebirr',
    paymentReason: 'send_money_to_registered_customer',
    providerFinalStatus: 'completed',
    providerIdentity: 'matched',
    receiverMatch: 'matched',
    referenceMatch: 'matched',
    retrievedAt: '2026-10-05T18:03:00.000Z',
    sourceProfile: 'telebirr_official_receipt_v1',
  };
  const makeObservation = (receiptFacts: typeof facts) => {
    const body = {
      ...header,
      candidateId: trustedLookup.candidateId,
      referenceFingerprint: trustedLookup.referenceFingerprint,
      receiverRevisionId: trustedLookup.receiverRevisionId,
      receiverVersion: trustedLookup.receiverVersion,
      receiverProfileDigest: trustedLookup.receiverProfileDigest,
      expectedReceiverNameDigest: trustedLookup.expectedReceiverNameDigest,
      deviceId: trustedLookup.deviceId,
      keyId: trustedLookup.keyId,
      challengeId: trustedLookup.challengeId,
      challengeDigest: trustedLookup.challengeDigest,
      sourceDocumentDigest: sha('e'),
      normalizedFactsDigest: digestRoutineTelebirrObservationFacts(receiptFacts)!,
      observedAt: receiptFacts.retrievedAt,
      facts: receiptFacts,
    };
    return {
      ...header,
      transcriptVersion: ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestRoutineTelebirrObservationBody(body)!,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      body,
      signature: sign('sha256', canonicalRoutineTelebirrObservationSignatureBytes(body)!, {
        key: deviceKey.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url'),
    };
  };
  const pollBody = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_NO_MONEY_POLL_MODE,
    enrollmentId,
    deviceId: deviceEnrollment.deviceId,
    keyId: deviceEnrollment.keyId,
    receiverRevisionId: deviceEnrollment.receiverRevisionId,
    receiverProfileDigest: deviceEnrollment.receiverProfileDigest,
    requestId: 'aa7665c4-9aba-478d-a561-624164313426',
    issuedAt: '2026-10-05T18:02:00.000Z',
    expiresAt: '2026-10-05T18:03:00.000Z',
    evidenceOnly: true,
    financialActionAllowed: false,
  };
  const pollRequest = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_NO_MONEY_POLL_MODE,
    transcriptVersion: ROUTINE_NO_MONEY_POLL_TRANSCRIPT,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineNoMoneyPollBody(pollBody)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body: pollBody,
    signature: sign('sha256', canonicalRoutineNoMoneyPollSignatureBytes(pollBody)!, {
      key: deviceKey.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  const context = {
    enrollmentId,
    trustedLookup,
    trustedRawReference: rawReference,
    trustedSigner,
    deviceEnrollment,
    trustedSignerSpkiDer: signerSpki,
  };
  return {
    pollEnrollment,
    deviceSpki,
    publicKeySpki: deviceSpki.toString('base64url'),
    pollRequest,
    signedAssignment,
    makeObservation,
    facts,
    context,
    rawReference,
  };
}

function http(path: string, body: unknown) {
  return {
    method: 'POST',
    path,
    headers: [['content-type', ROUTINE_NO_MONEY_CONTENT_TYPE]] as const,
    body: Buffer.from(JSON.stringify(body), 'utf8'),
  };
}

function decoded(body: Uint8Array): Record<string, unknown> {
  return JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
}

describe('dormant routine no-money bridge handler', () => {
  it('authenticates the phone and returns only a database-bound signed lookup', async () => {
    const f = fixture();
    let claimed = 0;
    const dependencies: RoutineNoMoneyBridgeDependencies = {
      now: () => '2026-10-05T18:02:30.000Z',
      loadEnrollment: async () => ({
        enrollment: f.pollEnrollment,
      }),
      claimAndIssuePoll: async (input) => {
        claimed += 1;
        expect(input.enrollmentId).toBe(f.context.enrollmentId);
        expect(input.replayIdentity).toMatch(/^sha256:[0-9a-f]{64}$/u);
        return {
          kind: 'assignment',
          context: { ...f.context, signedAssignment: f.signedAssignment },
        };
      },
      loadObservation: async () => undefined,
      stageObservationDigest: async () => 'retry',
    };
    const handler = createRoutineNoMoneyBridgeHandler(dependencies);
    const response = await handler(
      http(ROUTINE_NO_MONEY_POLL_PATH, {
        publicKeySpki: f.publicKeySpki,
        signedRequest: f.pollRequest,
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(decoded(response.body)).toMatchObject({
      outcome: 'assignment',
      advisoryOnly: true,
      financialActionAllowed: false,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(claimed).toBe(1);
    const invalid = await handler(
      http(ROUTINE_NO_MONEY_POLL_PATH, {
        publicKeySpki: f.publicKeySpki,
        signedRequest: { ...f.pollRequest, signature: 'A'.repeat(86) },
      }),
    );
    expect(invalid.statusCode).toBe(401);
    expect(claimed).toBe(1);
  });

  it('does not deliver an assignment that contradicts the protected lookup snapshot', async () => {
    const f = fixture();
    const handler = createRoutineNoMoneyBridgeHandler({
      now: () => '2026-10-05T18:02:30.000Z',
      loadEnrollment: async () => ({
        enrollment: f.pollEnrollment,
      }),
      claimAndIssuePoll: async () => ({
        kind: 'assignment',
        context: {
          ...f.context,
          trustedRawReference: 'DIFFERENT9ABC1234',
          signedAssignment: f.signedAssignment,
        },
      }),
      loadObservation: async () => undefined,
      stageObservationDigest: async () => 'retry',
    });
    const response = await handler(
      http(ROUTINE_NO_MONEY_POLL_PATH, {
        publicKeySpki: f.publicKeySpki,
        signedRequest: f.pollRequest,
      }),
    );
    expect(response.statusCode).toBe(503);
    expect(decoded(response.body)).toEqual({ code: 'temporarily_unavailable' });
    expect(Buffer.from(response.body).toString('utf8')).not.toContain(f.rawReference);
  });

  it('treats the supplied public key as a hint, never as enrollment authority', async () => {
    const f = fixture();
    let claims = 0;
    const handler = createRoutineNoMoneyBridgeHandler({
      now: () => '2026-10-05T18:02:30.000Z',
      loadEnrollment: async () => ({ enrollment: f.pollEnrollment }),
      claimAndIssuePoll: async () => {
        claims += 1;
        return { kind: 'none' };
      },
      loadObservation: async () => undefined,
      stageObservationDigest: async () => 'retry',
    });
    const wrongKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64url');
    expect(
      (
        await handler(
          http(ROUTINE_NO_MONEY_POLL_PATH, {
            publicKeySpki: wrongKey,
            signedRequest: f.pollRequest,
          }),
        )
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await handler(
          http(ROUTINE_NO_MONEY_POLL_PATH, {
            signedRequest: f.pollRequest,
          }),
        )
      ).statusCode,
    ).toBe(400);
    expect(claims).toBe(0);
  });

  it('records only validated signed-observation digests, never a payment claim', async () => {
    const f = fixture();
    let staged: unknown;
    const dependencies: RoutineNoMoneyBridgeDependencies = {
      now: () => '2026-10-05T18:04:00.000Z',
      loadEnrollment: async () => undefined,
      claimAndIssuePoll: async () => ({ kind: 'none' }),
      loadObservation: async (challengeId) => {
        expect(challengeId).toBe(f.context.trustedLookup.challengeId);
        return f.context;
      },
      stageObservationDigest: async (input) => {
        staged = input;
        return 'recorded';
      },
    };
    const handler = createRoutineNoMoneyBridgeHandler(dependencies);
    const signedObservation = f.makeObservation(f.facts);
    const response = await handler(
      http(ROUTINE_NO_MONEY_UPLOAD_PATH, {
        publicKeySpki: f.publicKeySpki,
        signedAssignment: f.signedAssignment,
        signedObservation,
      }),
    );
    expect(response.statusCode).toBe(202);
    expect(decoded(response.body)).toMatchObject({
      outcome: 'signed_evidence_received_for_review',
      advisoryOnly: true,
      sourceAuthenticationPerformed: false,
      financialActionAllowed: false,
    });
    expect(staged).toMatchObject({
      challengeId: f.context.trustedLookup.challengeId,
      assignmentBodyDigest: f.signedAssignment.bodyDigest,
      observationBodyDigest: signedObservation.bodyDigest,
      signedObservation,
      serverPolicyResult: 'signed_evidence_matches_policy',
    });
    expect(JSON.stringify(staged)).not.toContain(f.rawReference);
    expect(Buffer.from(response.body).toString('utf8')).not.toContain(f.rawReference);

    staged = undefined;
    const reversed = await handler(
      http(ROUTINE_NO_MONEY_UPLOAD_PATH, {
        publicKeySpki: f.publicKeySpki,
        signedAssignment: f.signedAssignment,
        signedObservation: f.makeObservation({ ...f.facts, providerFinalStatus: 'reversed' }),
      }),
    );
    expect(reversed.statusCode).toBe(202);
    expect(decoded(reversed.body)).toEqual({
      outcome: 'signed_evidence_recorded_for_policy_review',
      advisoryOnly: true,
      sourceAuthenticationPerformed: false,
      financialActionAllowed: false,
    });
    expect(staged).toMatchObject({
      challengeId: f.context.trustedLookup.challengeId,
      assignmentBodyDigest: f.signedAssignment.bodyDigest,
      serverPolicyResult: 'receipt_policy_review',
    });
    expect(JSON.stringify(staged)).not.toContain(f.rawReference);
  });

  it('never acknowledges a signed policy review when its durable digest cannot be staged', async () => {
    const f = fixture();
    const reversed = f.makeObservation({ ...f.facts, providerFinalStatus: 'reversed' });
    for (const stageResult of ['retry', 'conflict'] as const) {
      const handler = createRoutineNoMoneyBridgeHandler({
        now: () => '2026-10-05T18:04:00.000Z',
        loadEnrollment: async () => undefined,
        claimAndIssuePoll: async () => ({ kind: 'none' }),
        loadObservation: async () => f.context,
        stageObservationDigest: async () => stageResult,
      });
      const result = await handler(
        http(ROUTINE_NO_MONEY_UPLOAD_PATH, {
          publicKeySpki: f.publicKeySpki,
          signedAssignment: f.signedAssignment,
          signedObservation: reversed,
        }),
      );
      expect(result.statusCode).toBe(stageResult === 'retry' ? 503 : 409);
      expect(decoded(result.body)).toEqual({
        code: stageResult === 'retry' ? 'temporarily_unavailable' : 'observation_conflict',
      });
    }
  });

  it('rejects duplicate JSON keys and unsigned or mismatched uploads without staging', async () => {
    const f = fixture();
    let calls = 0;
    const handler = createRoutineNoMoneyBridgeHandler({
      now: () => '2026-10-05T18:04:00.000Z',
      loadEnrollment: async () => undefined,
      claimAndIssuePoll: async () => ({ kind: 'none' }),
      loadObservation: async () => f.context,
      stageObservationDigest: async () => {
        calls += 1;
        return 'recorded';
      },
    });
    const duplicate = http(ROUTINE_NO_MONEY_UPLOAD_PATH, {
      publicKeySpki: f.publicKeySpki,
      signedAssignment: f.signedAssignment,
      signedObservation: f.makeObservation(f.facts),
    });
    const duplicateBytes = Buffer.from(duplicate.body)
      .toString('utf8')
      .replace('"signedAssignment":', '"signedAssignment":null,"signedAssignment":');
    expect((await handler({ ...duplicate, body: Buffer.from(duplicateBytes) })).statusCode).toBe(
      400,
    );
    const tampered = f.makeObservation(f.facts);
    expect(
      (
        await handler(
          http(ROUTINE_NO_MONEY_UPLOAD_PATH, {
            publicKeySpki: f.publicKeySpki,
            signedAssignment: f.signedAssignment,
            signedObservation: { ...tampered, signature: 'A'.repeat(86) },
          }),
        )
      ).statusCode,
    ).toBe(401);
    expect(calls).toBe(0);
  });
});
