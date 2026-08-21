import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
  canonicalTelebirrLivePilotAssignmentBodyBytes,
  canonicalTelebirrLivePilotAssignmentSignatureBytes,
  canonicalTelebirrLivePilotObservationBodyBytes,
  canonicalTelebirrLivePilotObservationSignatureBytes,
  decodeTelebirrLivePilotAssignmentBody,
  decodeTelebirrLivePilotReceiptFacts,
  deriveTelebirrLivePilotReferenceBindingDigest,
  deriveTelebirrLivePilotReplayIdentity,
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotObservationBody,
  digestTelebirrLivePilotReceiptFacts,
  digestTelebirrLivePilotReceiverName,
  normalizeTelebirrCreditedPartyFullName,
  verifyTelebirrLivePrivatePilotEvidence,
  type TelebirrLivePilotAssignmentBody,
  type TelebirrLivePilotDeviceEnrollment,
  type TelebirrLivePilotFoundFacts,
  type TelebirrLivePilotObservationBody,
  type TelebirrLivePilotReceiptFacts,
  type TelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedObservation,
  type TelebirrLivePilotTrustedAssignmentSigner,
  type TelebirrLivePilotVerificationInput,
} from './live-private-pilot-protocol.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const fingerprint = (character: string): string => `hmac-sha256:${character.repeat(64)}`;
const rawReference = 'PILOT9ABC1234';
const receiverName = 'pilot receiver';

function keyPair(): {
  readonly privateKey: KeyObject;
  readonly spki: Buffer;
  readonly digest: string;
} {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey: pair.privateKey,
    spki: Buffer.from(spki),
    digest: spkiDigest(Buffer.from(spki)),
  };
}

function spkiDigest(spki: Buffer): string {
  return `sha256:${createHash('sha256').update(spki).digest('hex')}`;
}

function p1363(privateKey: KeyObject, bytes: Uint8Array): string {
  return sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );
}

function assignmentBody(
  overrides: Partial<TelebirrLivePilotAssignmentBody> = {},
): TelebirrLivePilotAssignmentBody {
  const referenceFingerprint = overrides.referenceFingerprint ?? fingerprint('2');
  const selectedReference = overrides.rawReference ?? rawReference;
  const expectedReceiverNameNormalized = overrides.expectedReceiverNameNormalized ?? receiverName;
  return {
    contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
    providerCode: 'telebirr',
    protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
    assignmentId: 'pilot-assignment-0001',
    requestId: 'pilot-request-0001',
    jobId: 'pilot-job-0001',
    attemptNumber: 1,
    pilotRevisionId: 'pilot-revision-0001',
    deviceId: 'pilot-device-0001',
    keyId: 'pilot-device-key-0001',
    leaseNonceDigest: sha('3'),
    challengeId: 'pilot-challenge-0001',
    challengeDigest: sha('4'),
    rawReference: selectedReference,
    referenceFingerprint,
    referenceBindingProfile: TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
    referenceBindingDigest:
      deriveTelebirrLivePilotReferenceBindingDigest({
        rawReference: selectedReference,
        referenceFingerprint,
      }) ?? 'invalid',
    sourceProfile: 'telebirr_official_receipt_v1',
    receiverRevisionId: 'pilot-receiver-revision-0001',
    receiverProfileId: 'pilot-receiver-profile-0001',
    receiverProfileDigest: sha('1'),
    receiverConfigurationDigest: sha('0'),
    receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized,
    expectedReceiverNameDigest:
      digestTelebirrLivePilotReceiverName(expectedReceiverNameNormalized) ?? 'invalid',
    adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    factsNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
    issuedAt: '2026-08-20T18:02:00.000Z',
    expiresAt: '2026-08-20T18:04:00.000Z',
    ...overrides,
  };
}

function signedAssignment(
  body: TelebirrLivePilotAssignmentBody,
  signerKey: KeyObject,
  overrides: Partial<TelebirrLivePilotSignedAssignment> = {},
): TelebirrLivePilotSignedAssignment {
  const bodyDigest = digestTelebirrLivePilotAssignmentBody(body)!;
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    transcriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: 'pilot-server-key-0001',
    body,
    signature: p1363(signerKey, canonicalTelebirrLivePilotAssignmentSignatureBytes(body)!),
    ...overrides,
  };
}

function foundFacts(
  overrides: Partial<TelebirrLivePilotFoundFacts> = {},
): TelebirrLivePilotFoundFacts {
  return {
    lookupOutcome: 'found',
    evidenceSource: 'provider_receipt_lookup',
    layoutAttestation: 'recognized_layout_v1',
    providerFinalStatus: 'completed',
    canonicalReferencePresent: true,
    referenceMatch: 'matched',
    amountMinor: 2_500,
    currencyCode: 'ETB',
    receiverMatch: 'matched',
    creditedPartyNameDigest: digestTelebirrLivePilotReceiverName(receiverName)!,
    paymentMode: 'telebirr',
    paymentReason: 'send_money_to_registered_customer',
    paymentChannel: 'api_app',
    occurredAt: '2026-08-20T18:01:45.000Z',
    retrievedAt: '2026-08-20T18:03:00.000Z',
    ...overrides,
  };
}

function observationBody(
  assignment: TelebirrLivePilotAssignmentBody,
  facts: TelebirrLivePilotReceiptFacts = foundFacts(),
  overrides: Partial<TelebirrLivePilotObservationBody> = {},
): TelebirrLivePilotObservationBody {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    assignmentId: assignment.assignmentId,
    requestId: assignment.requestId,
    jobId: assignment.jobId,
    attemptNumber: assignment.attemptNumber,
    pilotRevisionId: assignment.pilotRevisionId,
    deviceId: assignment.deviceId,
    keyId: assignment.keyId,
    leaseNonceDigest: assignment.leaseNonceDigest,
    challengeId: assignment.challengeId,
    challengeDigest: assignment.challengeDigest,
    assignmentBodyDigest: digestTelebirrLivePilotAssignmentBody(assignment)!,
    referenceFingerprint: assignment.referenceFingerprint,
    referenceBindingDigest: assignment.referenceBindingDigest,
    sourceProfile: assignment.sourceProfile,
    receiverRevisionId: assignment.receiverRevisionId,
    receiverProfileId: assignment.receiverProfileId,
    receiverProfileDigest: assignment.receiverProfileDigest,
    receiverConfigurationDigest: assignment.receiverConfigurationDigest,
    receiverNameNormalizerVersion: assignment.receiverNameNormalizerVersion,
    expectedReceiverNameDigest: assignment.expectedReceiverNameDigest,
    adapterVersion: assignment.adapterVersion,
    parserVersion: assignment.parserVersion,
    factsNormalizerVersion: assignment.factsNormalizerVersion,
    sourceDocumentDigest: sha('5'),
    normalizedFactsDigest: digestTelebirrLivePilotReceiptFacts(facts)!,
    observedAt: '2026-08-20T18:03:00.000Z',
    facts,
    ...overrides,
  };
}

function signedObservation(
  body: TelebirrLivePilotObservationBody,
  deviceKey: KeyObject,
  overrides: Partial<TelebirrLivePilotSignedObservation> = {},
): TelebirrLivePilotSignedObservation {
  const bodyDigest = digestTelebirrLivePilotObservationBody(body)!;
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    transcriptVersion: TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body,
    signature: p1363(deviceKey, canonicalTelebirrLivePilotObservationSignatureBytes(body)!),
    ...overrides,
  };
}

interface Fixture {
  readonly signer: ReturnType<typeof keyPair>;
  readonly device: ReturnType<typeof keyPair>;
  readonly assignmentBody: TelebirrLivePilotAssignmentBody;
  readonly assignment: TelebirrLivePilotSignedAssignment;
  readonly observationBody: TelebirrLivePilotObservationBody;
  readonly observation: TelebirrLivePilotSignedObservation;
  readonly input: TelebirrLivePilotVerificationInput;
}

function fixture(): Fixture {
  const signerBase = keyPair();
  const deviceBase = keyPair();
  const signer = { ...signerBase, digest: spkiDigest(signerBase.spki) };
  const device = { ...deviceBase, digest: spkiDigest(deviceBase.spki) };
  const body = assignmentBody();
  const assignment = signedAssignment(body, signer.privateKey);
  const observed = observationBody(body);
  const observation = signedObservation(observed, device.privateKey);
  const trustedAssignmentSigner: TelebirrLivePilotTrustedAssignmentSigner = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    signerKeyId: assignment.signerKeyId,
    publicKeySpkiSha256: signer.digest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    state: 'active',
    validFrom: '2026-08-20T17:00:00.000Z',
    validUntil: '2026-08-21T17:00:00.000Z',
  };
  const deviceEnrollment: TelebirrLivePilotDeviceEnrollment = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    enrollmentId: 'pilot-enrollment-0001',
    deviceId: body.deviceId,
    keyId: body.keyId,
    publicKeySpkiSha256: device.digest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    state: 'active',
    validFrom: '2026-08-20T17:00:00.000Z',
    validUntil: '2026-08-21T17:00:00.000Z',
    pilotRevisionId: body.pilotRevisionId,
    receiverRevisionId: body.receiverRevisionId,
    receiverProfileId: body.receiverProfileId,
    receiverProfileDigest: body.receiverProfileDigest,
    receiverConfigurationDigest: body.receiverConfigurationDigest,
  };
  const trustedRequestBinding = {
    assignmentId: body.assignmentId,
    requestId: body.requestId,
    jobId: body.jobId,
    attemptNumber: body.attemptNumber,
    pilotRevisionId: body.pilotRevisionId,
    deviceId: body.deviceId,
    keyId: body.keyId,
    referenceFingerprint: body.referenceFingerprint,
    receiverRevisionId: body.receiverRevisionId,
    receiverProfileId: body.receiverProfileId,
    receiverProfileDigest: body.receiverProfileDigest,
    receiverConfigurationDigest: body.receiverConfigurationDigest,
    expectedReceiverNameDigest: body.expectedReceiverNameDigest,
  } as const;
  return {
    signer,
    device,
    assignmentBody: body,
    assignment,
    observationBody: observed,
    observation,
    input: {
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      assessedAt: '2026-08-20T18:03:05.000Z',
      trustedAssignmentSigner,
      trustedRequestBinding,
      deviceEnrollment,
      signedAssignment: assignment,
      signedObservation: observation,
      serverComputedReplayIdentities: [],
    },
  };
}

const allCapabilitiesDisabled = {
  transportAllowed: false,
  networkAllowed: false,
  providerInteractionAllowed: false,
  databaseReadAllowed: false,
  databaseWriteAllowed: false,
  persistenceAllowed: false,
  claimAllowed: false,
  settlementAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
} as const;

describe('TeleBirr live private-pilot signed evidence protocol', () => {
  it('uses a distinct jointly versioned live mode while granting zero authority', () => {
    const value = fixture();
    const verified = verifyTelebirrLivePrivatePilotEvidence(
      value.input,
      value.signer.spki,
      value.device.spki,
    );
    expect(verified).toMatchObject({
      contractVersion: 1,
      protocolMode: 'live_private_pilot_v1',
      assignmentTranscriptVersion: 'telebirr-live-private-pilot-assignment-transcript-v1',
      observationTranscriptVersion: 'telebirr-live-private-pilot-observation-transcript-v1',
      advisoryEvidenceOnly: true,
      disposition: 'would_forward_signed_evidence',
      reasonCode: 'signed_evidence_verified',
      ...allCapabilitiesDisabled,
    });
    expect(verified.replayIdentity).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(verified)).toBe(true);
  });

  it('normalizes and digests the exact credited-party name deterministically', () => {
    expect(normalizeTelebirrCreditedPartyFullName('  PILOT\tReceiver  ')).toBe('pilot receiver');
    expect(normalizeTelebirrCreditedPartyFullName('ፓይለት  ተቀባይ')).toBe('ፓይለት ተቀባይ');
    expect(normalizeTelebirrCreditedPartyFullName('x\u0000y')).toBeUndefined();
    expect(digestTelebirrLivePilotReceiverName('PILOT RECEIVER')).toBe(
      digestTelebirrLivePilotReceiverName(receiverName),
    );
  });

  it('binds the exact raw reference to the provider-domain fingerprint', () => {
    const baseline = assignmentBody();
    expect(decodeTelebirrLivePilotAssignmentBody(baseline)).toBeDefined();
    expect(
      decodeTelebirrLivePilotAssignmentBody({ ...baseline, rawReference: 'PILOT9ABC9999' }),
    ).toBeUndefined();
    expect(
      deriveTelebirrLivePilotReferenceBindingDigest({
        rawReference: 'PILOT9ABC9999',
        referenceFingerprint: baseline.referenceFingerprint,
      }),
    ).not.toBe(baseline.referenceBindingDigest);
  });

  it.each([
    ['jobId', 'pilot-job-0002', 'binding_mismatch'],
    ['referenceFingerprint', fingerprint('8'), 'reference_binding_mismatch'],
    ['receiverRevisionId', 'pilot-receiver-revision-0002', 'receiver_binding_mismatch'],
    ['receiverProfileId', 'pilot-receiver-profile-0002', 'receiver_binding_mismatch'],
    ['receiverProfileDigest', sha('8'), 'receiver_binding_mismatch'],
    ['receiverConfigurationDigest', sha('7'), 'receiver_binding_mismatch'],
    ['expectedReceiverNameDigest', sha('6'), 'receiver_binding_mismatch'],
  ] as const)(
    'compares signed %s against the independently trusted server request binding',
    (field, value, reasonCode) => {
      const baseline = fixture();
      expect(
        verifyTelebirrLivePrivatePilotEvidence(
          {
            ...baseline.input,
            trustedRequestBinding: {
              ...baseline.input.trustedRequestBinding,
              [field]: value,
            },
          },
          baseline.signer.spki,
          baseline.device.spki,
        ),
      ).toMatchObject({ disposition: 'would_review', reasonCode });
    },
  );

  it('matches stable cross-language canonical vectors', () => {
    const assignment = assignmentBody();
    const observation = observationBody(assignment);
    expect({
      assignmentBodyBytes: canonicalTelebirrLivePilotAssignmentBodyBytes(assignment)?.length,
      assignmentBodyDigest: digestTelebirrLivePilotAssignmentBody(assignment),
      assignmentSignatureBytes:
        canonicalTelebirrLivePilotAssignmentSignatureBytes(assignment)?.length,
      factsDigest: digestTelebirrLivePilotReceiptFacts(observation.facts),
      observationBodyBytes: canonicalTelebirrLivePilotObservationBodyBytes(observation)?.length,
      observationBodyDigest: digestTelebirrLivePilotObservationBody(observation),
      observationSignatureBytes:
        canonicalTelebirrLivePilotObservationSignatureBytes(observation)?.length,
    }).toEqual({
      assignmentBodyBytes: 2021,
      assignmentBodyDigest:
        'sha256:21dc18df68841c6bb4ebc27d19d3ebc52c2c6649689222a846a6f34e7249489d',
      assignmentSignatureBytes: 507,
      factsDigest: 'sha256:6462f519dfaa861b7090dd03677fa6ca010be53a7b8f94e893623fe3a247baae',
      observationBodyBytes: 2905,
      observationBodyDigest:
        'sha256:ca5b5995c472c96fa068617d8b9302cb93342f2854838c70376869d3598357aa',
      observationSignatureBytes: 509,
    });
  });

  it.each([
    ['assignmentId', 'pilot-assignment-0002'],
    ['requestId', 'pilot-request-0002'],
    ['jobId', 'pilot-job-0002'],
    ['attemptNumber', 2],
    ['pilotRevisionId', 'pilot-revision-0002'],
    ['deviceId', 'pilot-device-0002'],
    ['keyId', 'pilot-device-key-0002'],
    ['leaseNonceDigest', sha('8')],
    ['challengeId', 'pilot-challenge-0002'],
    ['challengeDigest', sha('9')],
  ] as const)('routes a signed observation with mutated %s binding to review', (field, value) => {
    const baseline = fixture();
    const body = observationBody(baseline.assignmentBody, foundFacts(), { [field]: value });
    const observation = signedObservation(body, baseline.device.privateKey);
    expect(
      verifyTelebirrLivePrivatePilotEvidence(
        { ...baseline.input, signedObservation: observation },
        baseline.signer.spki,
        baseline.device.spki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'binding_mismatch' });
  });

  it.each([
    ['referenceFingerprint', fingerprint('8')],
    ['referenceBindingDigest', sha('8')],
  ] as const)('routes a signed %s mismatch to review', (field, value) => {
    const baseline = fixture();
    const body = observationBody(baseline.assignmentBody, foundFacts(), { [field]: value });
    expect(
      verifyTelebirrLivePrivatePilotEvidence(
        {
          ...baseline.input,
          signedObservation: signedObservation(body, baseline.device.privateKey),
        },
        baseline.signer.spki,
        baseline.device.spki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'reference_binding_mismatch' });
  });

  it.each([
    ['receiverRevisionId', 'pilot-receiver-revision-0002'],
    ['receiverProfileId', 'pilot-receiver-profile-0002'],
    ['receiverProfileDigest', sha('8')],
    ['receiverConfigurationDigest', sha('7')],
    ['expectedReceiverNameDigest', sha('9')],
  ] as const)('routes a signed %s mismatch to review', (field, value) => {
    const baseline = fixture();
    const body = observationBody(baseline.assignmentBody, foundFacts(), { [field]: value });
    expect(
      verifyTelebirrLivePrivatePilotEvidence(
        {
          ...baseline.input,
          signedObservation: signedObservation(body, baseline.device.privateKey),
        },
        baseline.signer.spki,
        baseline.device.spki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'receiver_binding_mismatch' });
  });

  it.each([
    ['provider_not_found_unattested', '2026-08-20T18:03:00.000Z'],
    ['provider_unavailable', '2026-08-20T18:03:00.000Z'],
    ['network_unavailable', null],
    ['unknown_layout', '2026-08-20T18:03:00.000Z'],
    ['invalid_layout', '2026-08-20T18:03:00.000Z'],
    ['parser_uncertain', '2026-08-20T18:03:00.000Z'],
    ['device_error', null],
  ] as const)('routes %s evidence to review, never reject/absent', (reviewReason, retrievedAt) => {
    const baseline = fixture();
    const facts: TelebirrLivePilotReceiptFacts = {
      lookupOutcome: 'review_required',
      reviewReason,
      retrievedAt,
    };
    const body = observationBody(baseline.assignmentBody, facts);
    const outcome = verifyTelebirrLivePrivatePilotEvidence(
      { ...baseline.input, signedObservation: signedObservation(body, baseline.device.privateKey) },
      baseline.signer.spki,
      baseline.device.spki,
    );
    expect(outcome).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'receipt_requires_review',
      ...allCapabilitiesDisabled,
    });
    expect(JSON.stringify(outcome)).not.toMatch(/reject|absent/u);
  });

  it('does not admit a definitive not-found receipt fact', () => {
    expect(decodeTelebirrLivePilotReceiptFacts({ lookupOutcome: 'not_found' })).toBeUndefined();
  });

  it.each([
    [foundFacts({ referenceMatch: 'mismatched' }), 'reference_mismatch'],
    [
      foundFacts({
        receiverMatch: 'mismatched',
        creditedPartyNameDigest: digestTelebirrLivePilotReceiverName('different receiver')!,
      }),
      'receiver_mismatch',
    ],
    [foundFacts({ providerFinalStatus: 'pending' }), 'provider_status_not_completed'],
    [foundFacts({ amountMinor: null, currencyCode: 'unknown' }), 'receipt_semantics_incomplete'],
    [foundFacts({ paymentMode: 'other' }), 'receipt_semantics_incomplete'],
    [foundFacts({ paymentReason: 'other' }), 'receipt_semantics_incomplete'],
    [foundFacts({ paymentChannel: 'other' }), 'receipt_semantics_incomplete'],
    [foundFacts({ occurredAt: null }), 'receipt_semantics_incomplete'],
    [foundFacts({ retrievedAt: '2026-08-20T18:02:59.999Z' }), 'receipt_semantics_incomplete'],
  ] as const)('routes a semantically incomplete found receipt to review', (facts, reasonCode) => {
    const baseline = fixture();
    const body = observationBody(baseline.assignmentBody, facts);
    expect(
      verifyTelebirrLivePrivatePilotEvidence(
        {
          ...baseline.input,
          signedObservation: signedObservation(body, baseline.device.privateKey),
        },
        baseline.signer.spki,
        baseline.device.spki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode });
  });

  it.each([
    [
      'signer revoked',
      { trustedAssignmentSigner: { state: 'revoked' } },
      'assignment_signer_revoked',
    ],
    ['device revoked', { deviceEnrollment: { state: 'revoked' } }, 'device_revoked'],
    [
      'signer expired',
      { trustedAssignmentSigner: { validUntil: '2026-08-20T18:03:05.000Z' } },
      'assignment_signer_expired',
    ],
    [
      'device expired',
      { deviceEnrollment: { validUntil: '2026-08-20T18:03:05.000Z' } },
      'device_enrollment_expired',
    ],
    [
      'retroactively valid signer',
      { trustedAssignmentSigner: { validFrom: '2026-08-20T18:02:00.001Z' } },
      'assignment_signer_expired',
    ],
    [
      'retroactively valid device',
      { deviceEnrollment: { validFrom: '2026-08-20T18:02:00.001Z' } },
      'device_enrollment_expired',
    ],
  ] as const)('fails %s closed', (_label, patch, reasonCode) => {
    const baseline = fixture();
    const input = {
      ...baseline.input,
      trustedAssignmentSigner: {
        ...baseline.input.trustedAssignmentSigner,
        ...('trustedAssignmentSigner' in patch ? patch.trustedAssignmentSigner : {}),
      },
      deviceEnrollment: {
        ...baseline.input.deviceEnrollment,
        ...('deviceEnrollment' in patch ? patch.deviceEnrollment : {}),
      },
    };
    expect(
      verifyTelebirrLivePrivatePilotEvidence(input, baseline.signer.spki, baseline.device.spki),
    ).toMatchObject({ disposition: 'would_review', reasonCode });
  });

  it.each([
    ['assessment at expiry', '2026-08-20T18:04:00.000Z', undefined, 'assignment_expired'],
    [
      'observation before issue',
      '2026-08-20T18:03:05.000Z',
      '2026-08-20T18:01:59.999Z',
      'observation_time_invalid',
    ],
    [
      'observation at expiry',
      '2026-08-20T18:03:05.000Z',
      '2026-08-20T18:04:00.000Z',
      'observation_time_invalid',
    ],
  ] as const)('fails the $0 boundary closed', (_label, assessedAt, observedAt, reasonCode) => {
    const baseline = fixture();
    const body = observedAt
      ? observationBody(baseline.assignmentBody, foundFacts(), { observedAt })
      : baseline.observationBody;
    const input = {
      ...baseline.input,
      assessedAt,
      signedObservation: signedObservation(body, baseline.device.privateKey),
    };
    expect(
      verifyTelebirrLivePrivatePilotEvidence(input, baseline.signer.spki, baseline.device.spki),
    ).toMatchObject({ disposition: 'would_review', reasonCode });
  });

  it('detects server-side replay identity reuse', () => {
    const baseline = fixture();
    const replayIdentity = deriveTelebirrLivePilotReplayIdentity(
      baseline.assignment,
      baseline.observation,
    )!;
    expect(
      verifyTelebirrLivePrivatePilotEvidence(
        { ...baseline.input, serverComputedReplayIdentities: [replayIdentity] },
        baseline.signer.spki,
        baseline.device.spki,
      ),
    ).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'replay_detected',
      replayIdentity,
    });
  });

  it('detects assignment and device key/signature mutations', () => {
    const baseline = fixture();
    const other = keyPair();
    const cases = [
      verifyTelebirrLivePrivatePilotEvidence(baseline.input, other.spki, baseline.device.spki),
      verifyTelebirrLivePrivatePilotEvidence(baseline.input, baseline.signer.spki, other.spki),
      verifyTelebirrLivePrivatePilotEvidence(
        {
          ...baseline.input,
          signedAssignment: { ...baseline.assignment, signature: 'A'.repeat(86) },
        },
        baseline.signer.spki,
        baseline.device.spki,
      ),
      verifyTelebirrLivePrivatePilotEvidence(
        {
          ...baseline.input,
          signedObservation: { ...baseline.observation, signature: 'A'.repeat(86) },
        },
        baseline.signer.spki,
        baseline.device.spki,
      ),
    ];
    expect(cases.map((value) => value.reasonCode)).toEqual([
      'assignment_signer_key_mismatch',
      'device_key_mismatch',
      'assignment_signature_invalid',
      'device_signature_invalid',
    ]);
  });

  it('rejects extras, accessors, proxies, and malformed replay identities without reading getters', () => {
    const baseline = fixture();
    const getter = vi.fn(() => 1);
    const accessor = Object.defineProperty({}, 'contractVersion', {
      enumerable: true,
      get: getter,
    });
    const candidates = [
      { ...baseline.input, rawReference: rawReference },
      new Proxy(baseline.input, {}),
      accessor,
      { ...baseline.input, serverComputedReplayIdentities: [sha('8'), sha('8')] },
    ];
    for (const candidate of candidates) {
      expect(
        verifyTelebirrLivePrivatePilotEvidence(
          candidate,
          baseline.signer.spki,
          baseline.device.spki,
        ),
      ).toMatchObject({
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        ...allCapabilitiesDisabled,
      });
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
