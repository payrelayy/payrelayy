import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  assessRoutineTelebirrPaidPhoneEvidence,
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
  ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_TRANSCRIPT_VERSION,
  ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
  canonicalRoutineTelebirrLookupAssignmentSignatureBytes,
  canonicalRoutineTelebirrObservationSignatureBytes,
  digestRoutineTelebirrLookupAssignmentBody,
  digestRoutineTelebirrObservationBody,
  digestRoutineTelebirrObservationFacts,
  digestRoutineTelebirrReceiverName,
} from '@fetanagent/telebirr-verification-foundation';

import {
  ROUTINE_PAID_UPLOAD_CONTENT_TYPE,
  ROUTINE_PAID_UPLOAD_PATH,
  createRoutinePaidUploadBridgeHandler,
  type RoutinePaidUploadBridgeDependencies,
} from './routine-paid-upload-bridge.js';

const sha = (letter: string): string => `sha256:${letter.repeat(64)}`;
const hash = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const header = {
  contractVersion: 1,
  providerCode: 'telebirr',
  protocolMode: 'routine_signed_observation_v1',
};
const originHeader = {
  contractVersion: 2,
  providerCode: 'telebirr',
  protocolMode: 'routine_signed_observation_v2',
};

function fixture() {
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerSpki = server.publicKey.export({ type: 'spki', format: 'der' });
  const deviceSpki = device.publicKey.export({ type: 'spki', format: 'der' });
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
    publicKeySpkiSha256: hash(signerSpki),
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
  };
  const deviceEnrollment = {
    ...header,
    deviceId: trustedLookup.deviceId,
    keyId: trustedLookup.keyId,
    publicKeySpkiSha256: hash(deviceSpki),
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
    receiverRevisionId: trustedLookup.receiverRevisionId,
    receiverVersion: trustedLookup.receiverVersion,
    receiverProfileDigest: trustedLookup.receiverProfileDigest,
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
      {
        key: server.privateKey,
        dsaEncoding: 'ieee-p1363',
      },
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
    sourceOriginAttestation: 'official_tls_origin',
  };
  const observationBody = {
    ...originHeader,
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
    normalizedFactsDigest: digestRoutineTelebirrObservationFacts(facts)!,
    observedAt: facts.retrievedAt,
    facts,
  };
  const signedObservation = {
    ...originHeader,
    transcriptVersion: ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineTelebirrObservationBody(observationBody)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body: observationBody,
    signature: sign('sha256', canonicalRoutineTelebirrObservationSignatureBytes(observationBody)!, {
      key: device.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  const context = {
    trustedLookup,
    trustedRawReference: rawReference,
    trustedSigner,
    deviceEnrollment,
    trustedSignerSpkiDer: signerSpki,
    trustedIssuanceMode: 'paid' as const,
  };
  const frame = {
    publicKeySpki: deviceSpki.toString('base64url'),
    signedAssignment,
    signedObservation,
  };
  const withFacts = (
    changes: Partial<typeof facts>,
    sourceDocumentDigest = observationBody.sourceDocumentDigest,
  ) => {
    const changedFacts = { ...facts, ...changes };
    const body = {
      ...observationBody,
      sourceDocumentDigest,
      normalizedFactsDigest: digestRoutineTelebirrObservationFacts(changedFacts)!,
      facts: changedFacts,
    };
    return {
      ...frame,
      signedObservation: {
        ...signedObservation,
        body,
        bodyDigest: digestRoutineTelebirrObservationBody(body)!,
        signature: sign('sha256', canonicalRoutineTelebirrObservationSignatureBytes(body)!, {
          key: device.privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url'),
      },
    };
  };
  return { context, frame, rawReference, withFacts };
}

function http(path: string, contentType: string, body: unknown) {
  return {
    method: 'POST',
    path,
    headers: [['content-type', contentType]] as const,
    body: Buffer.from(JSON.stringify(body), 'utf8'),
  };
}

function decoded(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
}

describe('paid TeleBirr phone observation upload boundary', () => {
  it('stages only independently verified paid phone evidence and acknowledges exact replay', async () => {
    const { context, frame, rawReference } = fixture();
    const stageObservation = vi
      .fn<RoutinePaidUploadBridgeDependencies['stageObservation']>()
      .mockResolvedValueOnce('recorded')
      .mockResolvedValueOnce('exact_replay');
    const handler = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:05:30.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => context,
      stageObservation,
      recordTerminalRejection: async () => 'recorded',
    });
    const request = http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, frame);
    const responses: Uint8Array[] = [];
    for (let index = 0; index < 2; index += 1) {
      const result = await handler(request);
      responses.push(result.body);
      expect(result.statusCode).toBe(202);
      expect(decoded(result.body)).toEqual({
        outcome: 'signed_paid_observation_staged',
        advisoryOnly: true,
        paymentVerificationRequested: true,
        pairedPhoneEvidenceVerified: true,
        sourceAuthenticationPerformed: false,
        financialActionAllowed: false,
      });
    }
    expect(stageObservation).toHaveBeenCalledTimes(2);
    expect(stageObservation.mock.calls[0]?.[0].evidence).toMatchObject({
      providerCode: 'telebirr',
      candidateId: context.trustedLookup.candidateId,
      challengeId: context.trustedLookup.challengeId,
      amountMinor: 2500,
    });
    expect(JSON.stringify(stageObservation.mock.calls)).not.toContain(rawReference);
    expect(JSON.stringify(decoded(responses[0]!))).not.toContain(rawReference);
  });

  it('rejects no-money mode, forged signatures and stale uploads without staging', async () => {
    const { context, frame } = fixture();
    const stageObservation = vi.fn<RoutinePaidUploadBridgeDependencies['stageObservation']>();
    const contextFor = (trustedIssuanceMode: 'paid') => ({ ...context, trustedIssuanceMode });
    const noMoney = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:04:00.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => ({ ...context, trustedIssuanceMode: 'no_money' }) as never,
      stageObservation,
      recordTerminalRejection: async () => 'recorded',
    });
    expect(
      (await noMoney(http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, frame)))
        .statusCode,
    ).toBe(403);
    const forged = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:04:00.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => contextFor('paid'),
      stageObservation,
      recordTerminalRejection: async () => 'recorded',
    });
    expect(
      (
        await forged(
          http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, {
            ...frame,
            signedObservation: { ...frame.signedObservation, signature: 'A'.repeat(86) },
          }),
        )
      ).statusCode,
    ).toBe(403);
    const late = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:18:00.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => contextFor('paid'),
      stageObservation,
      recordTerminalRejection: async () => 'recorded',
    });
    expect(
      (await late(http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, frame)))
        .statusCode,
    ).toBe(403);
    expect(stageObservation).not.toHaveBeenCalled();
  });

  it('retires only authenticated immutable receipt mismatches, not pending or forged evidence', async () => {
    const { context, frame, withFacts } = fixture();
    const stageObservation = vi.fn<RoutinePaidUploadBridgeDependencies['stageObservation']>();
    const recordTerminalRejection = vi.fn<
      RoutinePaidUploadBridgeDependencies['recordTerminalRejection']
    >(async () => 'recorded' as const);
    const handler = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:04:00.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => context,
      stageObservation,
      recordTerminalRejection,
    });
    for (const changed of [
      withFacts({ receiverMatch: 'mismatched', creditedPartyNameDigest: sha('f') }),
      withFacts({ occurredAt: '2026-10-05T16:59:00.000Z' }),
    ]) {
      const response = await handler(
        http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, changed),
      );
      expect(response.statusCode).toBe(410);
      expect(decoded(response.body)).toEqual({ code: 'paid_observation_terminal_review' });
      const forged = await handler(
        http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, {
          ...changed,
          signedObservation: { ...changed.signedObservation, signature: 'A'.repeat(86) },
        }),
      );
      expect(forged.statusCode).toBe(403);
    }
    const pending = await handler(
      http(
        ROUTINE_PAID_UPLOAD_PATH,
        ROUTINE_PAID_UPLOAD_CONTENT_TYPE,
        withFacts({ providerFinalStatus: 'pending' }),
      ),
    );
    expect(pending.statusCode).toBe(403);
    expect(stageObservation).not.toHaveBeenCalled();
    expect(recordTerminalRejection).toHaveBeenCalledTimes(1);
    expect(recordTerminalRejection.mock.calls[0]?.[0]).toMatchObject({
      challengeId: frame.signedObservation.body.challengeId,
    });
    expect(frame.signedObservation.body.facts.receiverMatch).toBe('matched');
  });

  it('keeps a signed wrong-receiver upload retryable until the final bot result is durable', async () => {
    const { context, withFacts } = fixture();
    const changed = withFacts({
      receiverMatch: 'mismatched',
      creditedPartyNameDigest: sha('f'),
    });
    const handler = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:04:00.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => context,
      stageObservation: async () => 'conflict',
      recordTerminalRejection: async () => 'retry',
    });
    const response = await handler(
      http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, changed),
    );
    expect(response.statusCode).toBe(503);
    expect(decoded(response.body)).toEqual({ code: 'temporarily_unavailable' });
  });

  it.each([
    'sha256:91afbccab306bb594b924b41b38a065c02e39e8ef89f97c2edd21b1b1006b3b2',
    'sha256:cdc7494ceb7b145858e52bef7f76607373b8c523b2430590859066ac3ae2b707',
  ])('records the signed exact invalid-page result %s without a Player credit', async (digest) => {
    const { context, withFacts } = fixture();
    const stageObservation = vi.fn<RoutinePaidUploadBridgeDependencies['stageObservation']>();
    const recordTerminalRejection = vi.fn<
      RoutinePaidUploadBridgeDependencies['recordTerminalRejection']
    >(async () => 'recorded' as const);
    const handler = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:04:00.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => context,
      stageObservation,
      recordTerminalRejection,
    });
    const negative = withFacts(
      {
        amountMinor: 0,
        canonicalReferencePresent: false,
        creditedPartyNameDigest: sha('0'),
        currencyCode: 'unknown',
        occurredAt: '2026-10-05T18:03:00.000Z',
        paymentChannel: 'unknown',
        paymentMode: 'unknown',
        paymentReason: 'unknown',
        providerFinalStatus: 'unknown',
        receiverMatch: 'unknown',
        referenceMatch: 'unknown',
      },
      digest,
    );
    const assessment = assessRoutineTelebirrPaidPhoneEvidence(
      {
        assessedAt: '2026-10-05T18:04:00.000Z',
        trustedLookup: context.trustedLookup,
        trustedRawReference: context.trustedRawReference,
        trustedSigner: context.trustedSigner,
        deviceEnrollment: context.deviceEnrollment,
        signedAssignment: negative.signedAssignment,
        signedObservation: negative.signedObservation,
        trustedIssuanceMode: 'paid',
      },
      context.trustedSignerSpkiDer,
      Buffer.from(negative.publicKeySpki, 'base64url'),
    );
    expect(assessment).toMatchObject({ terminalReasonCode: 'explicit_invalid_reference' });
    const response = await handler(
      http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, negative),
    );
    expect(response.statusCode).toBe(410);
    expect(recordTerminalRejection).toHaveBeenCalledOnce();
    expect(stageObservation).not.toHaveBeenCalled();
  });

  it('cannot accept the no-money path, media type, caller authority, or duplicate keys', async () => {
    const { context, frame } = fixture();
    const stageObservation = vi.fn<RoutinePaidUploadBridgeDependencies['stageObservation']>();
    const handler = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:04:00.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => context,
      stageObservation,
      recordTerminalRejection: async () => 'recorded',
    });
    for (const request of [
      http('/v1/telebirr/routine/observations:upload', ROUTINE_PAID_UPLOAD_CONTENT_TYPE, frame),
      http(
        ROUTINE_PAID_UPLOAD_PATH,
        'application/vnd.fetanagent.telebirr-routine-no-money.v1+json',
        frame,
      ),
      http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, {
        ...frame,
        financialActionAllowed: true,
      }),
      {
        ...http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, frame),
        body: Buffer.from('{"publicKeySpki":"a","publicKeySpki":"b"}', 'utf8'),
      },
    ]) {
      expect((await handler(request)).statusCode).toBe(400);
    }
    expect(stageObservation).not.toHaveBeenCalled();
  });

  it('keeps conflicting signed observations out of the paid inbox', async () => {
    const { context, frame } = fixture();
    const handler = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:04:00.000Z',
      classifyTerminal: async () => false,
      loadObservation: async () => context,
      stageObservation: async () => 'conflict',
      recordTerminalRejection: async () => 'recorded',
    });
    const result = await handler(
      http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, frame),
    );
    expect(result.statusCode).toBe(409);
    expect(decoded(result.body)).toEqual({ code: 'observation_conflict' });
  });

  it('returns terminal only after private challenge and device binding confirmation', async () => {
    const { frame } = fixture();
    const classifyTerminal = vi
      .fn<RoutinePaidUploadBridgeDependencies['classifyTerminal']>()
      .mockResolvedValue(true);
    const loadObservation = vi.fn<RoutinePaidUploadBridgeDependencies['loadObservation']>();
    const stageObservation = vi.fn<RoutinePaidUploadBridgeDependencies['stageObservation']>();
    const handler = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:20:00.000Z',
      classifyTerminal,
      loadObservation,
      stageObservation,
      recordTerminalRejection: async () => 'recorded',
    });
    const result = await handler(
      http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, frame),
    );
    expect(result.statusCode).toBe(410);
    expect(decoded(result.body)).toEqual({ code: 'paid_observation_terminal_expired' });
    expect(classifyTerminal).toHaveBeenCalledWith({
      challengeId: frame.signedAssignment.body.challengeId,
      challengeDigest: frame.signedAssignment.body.challengeDigest,
      devicePublicKeySpkiSha256: hash(Buffer.from(frame.publicKeySpki, 'base64url')),
    });
    expect(loadObservation).not.toHaveBeenCalled();
    expect(stageObservation).not.toHaveBeenCalled();
    const mismatch = await handler(
      http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, {
        ...frame,
        signedObservation: {
          ...frame.signedObservation,
          body: { ...frame.signedObservation.body, challengeDigest: sha('f') },
        },
      }),
    );
    expect(mismatch.statusCode).toBe(400);
    expect(classifyTerminal).toHaveBeenCalledTimes(1);
  });

  it('does not claim terminal expiry during a database outage', async () => {
    const { frame } = fixture();
    const handler = createRoutinePaidUploadBridgeHandler({
      now: () => '2026-10-05T18:20:00.000Z',
      classifyTerminal: async () => {
        throw new Error('database offline');
      },
      loadObservation: async () => {
        throw new Error('must not run');
      },
      stageObservation: async () => {
        throw new Error('must not run');
      },
      recordTerminalRejection: async () => {
        throw new Error('must not run');
      },
    });
    const result = await handler(
      http(ROUTINE_PAID_UPLOAD_PATH, ROUTINE_PAID_UPLOAD_CONTENT_TYPE, frame),
    );
    expect(result.statusCode).toBe(503);
  });
});
