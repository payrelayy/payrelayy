import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  TELEBIRR_SIGNED_RELAY_ADAPTER_VERSION,
  TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM,
  TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION,
  TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
  TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
  TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE,
  TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM,
  TELEBIRR_SIGNED_RELAY_SIGNATURE_ENCODING,
  TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION,
  canonicalTelebirrRelayObservationBodyBytes,
  canonicalTelebirrRelayReceiptFactsBytes,
  canonicalTelebirrRelaySignatureTranscriptBytes,
  decodeTelebirrRelayEnrollmentEnvelope,
  decodeTelebirrRelayLeaseEnvelope,
  decodeTelebirrRelayObservationBody,
  decodeTelebirrRelayReceiptFacts,
  decodeTelebirrRelayRequestEnvelope,
  decodeTelebirrRelaySignedObservationEnvelope,
  deriveTelebirrRelayReplayIdentity,
  digestTelebirrRelayObservationBody,
  digestTelebirrRelayReceiptFacts,
  redactedTelebirrSignedRelayVerificationForLog,
  verifySyntheticTelebirrSignedRelayObservation,
  type TelebirrRelayEnrollmentEnvelope,
  type TelebirrRelayLeaseEnvelope,
  type TelebirrRelayObservationBody,
  type TelebirrRelayRequestEnvelope,
  type TelebirrRelaySignedObservationEnvelope,
  type TelebirrSignedRelayVerificationInput,
  type TelebirrSignedRelayVerificationResult,
} from './signed-relay-protocol.js';
import { TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE } from './synthetic-official-receipt.js';

const p256 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const otherP256 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
const publicKeySpki = p256.publicKey.export({ format: 'der', type: 'spki' });
const otherPublicKeySpki = otherP256.publicKey.export({ format: 'der', type: 'spki' });
const p384PublicKeySpki = p384.publicKey.export({ format: 'der', type: 'spki' });

const sha256 = (value: string | Buffer): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
const repeatedSha256 = (character: string): string => `sha256:${character.repeat(64)}`;
const referenceFingerprint = (character: string): string =>
  `fixture-hmac-sha256:${character.repeat(64)}`;

const foundFacts = Object.freeze({
  lookupOutcome: 'found' as const,
  evidenceSource: 'provider_receipt_lookup' as const,
  providerIdentity: 'matched' as const,
  providerFinalStatus: 'completed' as const,
  canonicalReferencePresent: true,
  referenceMatch: 'matched' as const,
  amountMinor: 12_500,
  currencyCode: 'ETB' as const,
  receiverMatch: 'matched' as const,
  maskedReceiverDiagnostic: 'matched' as const,
  paymentMode: 'telebirr' as const,
  paymentReason: 'send_money_to_registered_customer' as const,
  paymentChannel: 'api_app' as const,
  occurredAt: '2026-08-20T18:02:30.000Z',
  retrievedAt: '2026-08-20T18:03:00.000Z',
});

const enrollment: TelebirrRelayEnrollmentEnvelope = Object.freeze({
  contractVersion: 1,
  providerCode: 'telebirr',
  protocolMode: 'synthetic_shadow',
  enrollmentId: 'synthetic-enrollment-0001',
  deviceId: 'synthetic-device-0001',
  keyId: 'synthetic-key-0001',
  publicKeySpkiSha256: sha256(publicKeySpki),
  signatureAlgorithm: 'ecdsa-p256-sha256',
  state: 'active',
  enrolledAt: '2026-08-20T17:00:00.000Z',
  validFrom: '2026-08-20T17:00:00.000Z',
  validUntil: '2026-08-21T17:00:00.000Z',
  sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  receiverProfileId: 'synthetic-receiver-profile-0001',
  receiverProfileDigest: repeatedSha256('1'),
  parserVersion: TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
  normalizerVersion: TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
});

const request: TelebirrRelayRequestEnvelope = Object.freeze({
  contractVersion: 1,
  providerCode: 'telebirr',
  protocolMode: 'synthetic_shadow',
  requestId: 'synthetic-request-0001',
  jobId: 'synthetic-job-0001',
  attemptNumber: 1,
  referenceFingerprint: referenceFingerprint('2'),
  sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  receiverProfileId: enrollment.receiverProfileId,
  receiverProfileDigest: enrollment.receiverProfileDigest,
  parserVersion: TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
  normalizerVersion: TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
  requestedAt: '2026-08-20T18:01:30.000Z',
});

const lease: TelebirrRelayLeaseEnvelope = Object.freeze({
  contractVersion: 1,
  providerCode: 'telebirr',
  protocolMode: 'synthetic_shadow',
  leaseId: 'synthetic-lease-0001',
  requestId: request.requestId,
  jobId: request.jobId,
  attemptNumber: request.attemptNumber,
  deviceId: enrollment.deviceId,
  keyId: enrollment.keyId,
  leaseNonceDigest: repeatedSha256('3'),
  challengeId: 'synthetic-challenge-0001',
  challengeDigest: repeatedSha256('4'),
  referenceFingerprint: request.referenceFingerprint,
  sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  receiverProfileId: enrollment.receiverProfileId,
  receiverProfileDigest: enrollment.receiverProfileDigest,
  parserVersion: TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
  normalizerVersion: TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
  issuedAt: '2026-08-20T18:02:00.000Z',
  expiresAt: '2026-08-20T18:04:00.000Z',
});

function observationBodyWith(
  overrides: Readonly<Record<string, unknown>> = {},
): TelebirrRelayObservationBody {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'synthetic_shadow',
    requestId: request.requestId,
    jobId: request.jobId,
    attemptNumber: request.attemptNumber,
    leaseId: lease.leaseId,
    deviceId: enrollment.deviceId,
    keyId: enrollment.keyId,
    leaseNonceDigest: lease.leaseNonceDigest,
    challengeId: lease.challengeId,
    challengeDigest: lease.challengeDigest,
    referenceFingerprint: request.referenceFingerprint,
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    receiverProfileId: enrollment.receiverProfileId,
    receiverProfileDigest: enrollment.receiverProfileDigest,
    adapterVersion: TELEBIRR_SIGNED_RELAY_ADAPTER_VERSION,
    parserVersion: TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
    normalizerVersion: TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
    sourceDocumentDigest: repeatedSha256('5'),
    normalizedFactsDigest: digestTelebirrRelayReceiptFacts(foundFacts)!,
    observedAt: '2026-08-20T18:03:00.000Z',
    facts: foundFacts,
    ...overrides,
  } as TelebirrRelayObservationBody;
}

function signedEnvelope(
  body: TelebirrRelayObservationBody = observationBodyWith(),
  privateKey = p256.privateKey,
): TelebirrRelaySignedObservationEnvelope {
  const transcript = canonicalTelebirrRelaySignatureTranscriptBytes(body);
  const bodyDigest = digestTelebirrRelayObservationBody(body);
  if (!transcript || !bodyDigest) throw new Error('synthetic fixture invariant');
  return Object.freeze({
    contractVersion: 1,
    providerCode: 'telebirr' as const,
    protocolMode: 'synthetic_shadow' as const,
    transcriptVersion: TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM,
    signatureEncoding: TELEBIRR_SIGNED_RELAY_SIGNATURE_ENCODING,
    body,
    signature: sign('sha256', transcript, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
}

interface VerificationOverrides {
  readonly enrollment?: TelebirrRelayEnrollmentEnvelope;
  readonly request?: TelebirrRelayRequestEnvelope;
  readonly lease?: TelebirrRelayLeaseEnvelope;
  readonly signedObservation?: TelebirrRelaySignedObservationEnvelope;
  readonly assessedAt?: string;
  readonly serverComputedReplayIdentities?: readonly string[];
}

function verificationInput(
  overrides: VerificationOverrides = {},
): TelebirrSignedRelayVerificationInput {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'synthetic_shadow',
    assessedAt: overrides.assessedAt ?? '2026-08-20T18:03:05.000Z',
    enrollment: overrides.enrollment ?? enrollment,
    request: overrides.request ?? request,
    lease: overrides.lease ?? lease,
    signedObservation: overrides.signedObservation ?? signedEnvelope(),
    serverComputedReplayIdentities: overrides.serverComputedReplayIdentities ?? [],
  };
}

const allCapabilitiesDisabled = {
  transportAllowed: false,
  networkAllowed: false,
  providerInteractionAllowed: false,
  databaseWriteAllowed: false,
  persistenceAllowed: false,
  claimAllowed: false,
  settlementAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
} as const;

describe('synthetic TeleBirr signed relay protocol', () => {
  it('pins the exact protocol, digest, transcript, signature, parser, and normalizer versions', () => {
    expect(TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION).toBe(1);
    expect(TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE).toBe('synthetic_shadow');
    expect(TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION).toBe('telebirr-signed-relay-transcript-v1');
    expect(TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM).toBe('sha256');
    expect(TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM).toBe('ecdsa-p256-sha256');
    expect(TELEBIRR_SIGNED_RELAY_SIGNATURE_ENCODING).toBe('ieee-p1363-base64url');
    expect(TELEBIRR_SIGNED_RELAY_ADAPTER_VERSION).toBe('telebirr-synthetic-relay-adapter-v1');
    expect(TELEBIRR_SIGNED_RELAY_PARSER_VERSION).toBe('telebirr-official-receipt-parser-v1');
    expect(TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION).toBe(
      'telebirr-official-receipt-normalizer-v1',
    );
  });

  it('strictly decodes and freezes enrollment, request, lease, facts, body, and signed envelopes', () => {
    const body = observationBodyWith();
    const envelope = signedEnvelope(body);
    const decoded = [
      decodeTelebirrRelayEnrollmentEnvelope(enrollment),
      decodeTelebirrRelayRequestEnvelope(request),
      decodeTelebirrRelayLeaseEnvelope(lease),
      decodeTelebirrRelayReceiptFacts(foundFacts),
      decodeTelebirrRelayObservationBody(body),
      decodeTelebirrRelaySignedObservationEnvelope(envelope),
    ];
    expect(decoded.every((value) => value !== undefined && Object.isFrozen(value))).toBe(true);
  });

  it.each([
    [{ lookupOutcome: 'not_found' }, 'not_found'],
    [{ lookupOutcome: 'unavailable', uncertainty: 'device' }, 'unavailable'],
    [foundFacts, 'found'],
  ] as const)('strictly accepts the %s fact envelope', (facts, lookupOutcome) => {
    expect(decodeTelebirrRelayReceiptFacts(facts)).toMatchObject({ lookupOutcome });
    expect(digestTelebirrRelayReceiptFacts(facts)).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('uses deterministic length-prefixed canonical facts, body, and transcript bytes', () => {
    const reversedFacts = Object.fromEntries(Object.entries(foundFacts).reverse());
    const reversedBody = Object.fromEntries(Object.entries(observationBodyWith()).reverse());
    expect(canonicalTelebirrRelayReceiptFactsBytes(reversedFacts)).toEqual(
      canonicalTelebirrRelayReceiptFactsBytes(foundFacts),
    );
    expect(canonicalTelebirrRelayObservationBodyBytes(reversedBody)).toEqual(
      canonicalTelebirrRelayObservationBodyBytes(observationBodyWith()),
    );
    expect(canonicalTelebirrRelaySignatureTranscriptBytes(reversedBody)).toEqual(
      canonicalTelebirrRelaySignatureTranscriptBytes(observationBodyWith()),
    );
  });

  it('computes actual normalized-fact and body SHA-256 values', () => {
    const body = observationBodyWith();
    expect(body.normalizedFactsDigest).toBe(
      sha256(canonicalTelebirrRelayReceiptFactsBytes(foundFacts)!),
    );
    expect(digestTelebirrRelayObservationBody(body)).toBe(
      sha256(canonicalTelebirrRelayObservationBodyBytes(body)!),
    );
  });

  it('cryptographically verifies one P-256 observation without granting authority', () => {
    const verified = verifySyntheticTelebirrSignedRelayObservation(
      verificationInput(),
      publicKeySpki,
    );
    expect(verified).toMatchObject({
      disposition: 'would_forward_signed_observation',
      reasonCode: 'signed_observation_verified',
      verifiedBodyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      replayIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      ...allCapabilitiesDisabled,
    });
    expect(Object.isFrozen(verified)).toBe(true);
    expectTypeOf(verified).toMatchTypeOf<TelebirrSignedRelayVerificationResult>();
  });

  it('derives replay identity from canonical metadata and body digest, not signature bytes', () => {
    const first = signedEnvelope();
    const second = { ...first, signature: Buffer.alloc(64, 1).toString('base64url') };
    const third = { ...first, signature: Buffer.alloc(64, 2).toString('base64url') };
    expect(decodeTelebirrRelaySignedObservationEnvelope(second)).toBeDefined();
    expect(decodeTelebirrRelaySignedObservationEnvelope(third)).toBeDefined();
    expect(deriveTelebirrRelayReplayIdentity(second)).toBe(
      deriveTelebirrRelayReplayIdentity(third),
    );
  });

  it('rejects a previously server-computed canonical replay identity', () => {
    const envelope = signedEnvelope();
    const replayIdentity = deriveTelebirrRelayReplayIdentity(envelope)!;
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({
          signedObservation: envelope,
          serverComputedReplayIdentities: [replayIdentity],
        }),
        publicKeySpki,
      ),
    ).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'replay_detected',
      ...allCapabilitiesDisabled,
    });
  });

  it.each([
    ['requestId', 'synthetic-request-0002'],
    ['jobId', 'synthetic-job-0002'],
    ['attemptNumber', 2],
    ['leaseId', 'synthetic-lease-0002'],
    ['deviceId', 'synthetic-device-0002'],
    ['keyId', 'synthetic-key-0002'],
    ['leaseNonceDigest', repeatedSha256('6')],
    ['challengeId', 'synthetic-challenge-0002'],
    ['challengeDigest', repeatedSha256('7')],
    ['referenceFingerprint', referenceFingerprint('8')],
  ] as const)('detects exact %s mutation before trusting the signature', (field, value) => {
    const body = observationBodyWith({ [field]: value });
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ signedObservation: signedEnvelope(body) }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'binding_mismatch' });
  });

  it.each([
    ['receiverProfileId', 'synthetic-receiver-profile-0002'],
    ['receiverProfileDigest', repeatedSha256('9')],
  ] as const)('detects exact %s mismatch', (field, value) => {
    const body = observationBodyWith({ [field]: value });
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ signedObservation: signedEnvelope(body) }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'receiver_profile_mismatch' });
  });

  it('recomputes normalized facts instead of trusting the declared digest', () => {
    const body = observationBodyWith({ normalizedFactsDigest: repeatedSha256('a') });
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ signedObservation: signedEnvelope(body) }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'facts_digest_mismatch' });
  });

  it('recomputes the canonical body instead of trusting the envelope digest', () => {
    const envelope = { ...signedEnvelope(), bodyDigest: repeatedSha256('b') };
    expect(deriveTelebirrRelayReplayIdentity(envelope)).toBeUndefined();
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ signedObservation: envelope }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'body_digest_mismatch' });
  });

  it('rejects an observation mutated after it was signed', () => {
    const signed = signedEnvelope();
    const mutatedBody = observationBodyWith({ sourceDocumentDigest: repeatedSha256('c') });
    const mutated = { ...signed, body: mutatedBody };
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ signedObservation: mutated }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'body_digest_mismatch' });
  });

  it('requires the separately injected enrolled public key fingerprint', () => {
    expect(
      verifySyntheticTelebirrSignedRelayObservation(verificationInput(), otherPublicKeySpki),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'key_fingerprint_mismatch' });

    const mismatchedEnrollment = {
      ...enrollment,
      publicKeySpkiSha256: repeatedSha256('d'),
    };
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ enrollment: mismatchedEnrollment }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'key_fingerprint_mismatch' });
  });

  it.each([
    ['malformed', Buffer.from('not-spki')],
    ['empty', Buffer.alloc(0)],
    ['wrong curve', p384PublicKeySpki],
    ['non-byte object', { publicKey: publicKeySpki }],
  ])('rejects a %s injected public key', (_label, key) => {
    expect(verifySyntheticTelebirrSignedRelayObservation(verificationInput(), key)).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'public_key_invalid',
      ...allCapabilitiesDisabled,
    });
  });

  it('performs real signature verification and rejects a validly shaped mutation', () => {
    const envelope = signedEnvelope();
    const signatureBytes = Buffer.from(envelope.signature, 'base64url');
    signatureBytes[0] = signatureBytes[0]! ^ 1;
    const mutated = { ...envelope, signature: signatureBytes.toString('base64url') };
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ signedObservation: mutated }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'signature_invalid' });
  });

  it('rejects a correctly signed envelope from a different private key', () => {
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({
          signedObservation: signedEnvelope(observationBodyWith(), otherP256.privateKey),
        }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'signature_invalid' });
  });

  it('fails a revoked device, expired enrollment, expired lease, and invalid observation time closed', () => {
    const cases = [
      {
        input: verificationInput({ enrollment: { ...enrollment, state: 'revoked' } }),
        reasonCode: 'device_revoked',
      },
      {
        input: verificationInput({ assessedAt: enrollment.validUntil }),
        reasonCode: 'enrollment_expired',
      },
      {
        input: verificationInput({ assessedAt: lease.expiresAt }),
        reasonCode: 'lease_expired',
      },
      {
        input: verificationInput({
          signedObservation: signedEnvelope(observationBodyWith({ observedAt: lease.expiresAt })),
        }),
        reasonCode: 'observation_time_invalid',
      },
    ];
    for (const fixture of cases) {
      expect(
        verifySyntheticTelebirrSignedRelayObservation(fixture.input, publicKeySpki),
      ).toMatchObject({ disposition: 'would_review', reasonCode: fixture.reasonCode });
    }
  });

  it('accepts request, lease, observation, and assessment exactly at enrollment validFrom', () => {
    const boundary = '2026-08-20T18:02:00.000Z';
    const boundaryEnrollment = { ...enrollment, validFrom: boundary };
    const boundaryRequest = { ...request, requestedAt: boundary };
    const boundaryLease = { ...lease, issuedAt: boundary };
    const boundaryFacts = {
      ...foundFacts,
      occurredAt: boundary,
      retrievedAt: boundary,
    };
    const boundaryBody = observationBodyWith({
      observedAt: boundary,
      facts: boundaryFacts,
      normalizedFactsDigest: digestTelebirrRelayReceiptFacts(boundaryFacts),
    });

    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({
          enrollment: boundaryEnrollment,
          request: boundaryRequest,
          lease: boundaryLease,
          signedObservation: signedEnvelope(boundaryBody),
          assessedAt: boundary,
        }),
        publicKeySpki,
      ),
    ).toMatchObject({
      disposition: 'would_forward_signed_observation',
      reasonCode: 'signed_observation_verified',
    });
  });

  it.each([
    ['request', { request: { ...request, requestedAt: enrollment.validUntil } }],
    [
      'lease',
      {
        lease: { ...lease, issuedAt: enrollment.validUntil, expiresAt: '2026-08-21T17:01:00.000Z' },
      },
    ],
    [
      'observation',
      {
        signedObservation: signedEnvelope(
          observationBodyWith({ observedAt: enrollment.validUntil }),
        ),
      },
    ],
    ['assessment', { assessedAt: enrollment.validUntil }],
  ] as const)('rejects %s exactly at enrollment validUntil', (_label, overrides) => {
    expect(
      verifySyntheticTelebirrSignedRelayObservation(verificationInput(overrides), publicKeySpki),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'enrollment_expired' });
  });

  it('rejects a retroactively valid key even when assessment occurs after key activation', () => {
    const retroactiveEnrollment = {
      ...enrollment,
      validFrom: '2026-08-20T18:02:30.000Z',
    };
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ enrollment: retroactiveEnrollment }),
        publicKeySpki,
      ),
    ).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'enrollment_expired',
      verifiedBodyDigest: null,
      replayIdentity: null,
    });
  });

  it.each([
    [
      'request before key validity',
      {
        enrollment: { ...enrollment, validFrom: '2026-08-20T18:01:31.000Z' },
      },
    ],
    [
      'lease before key validity',
      {
        enrollment: { ...enrollment, validFrom: '2026-08-20T18:02:01.000Z' },
        request: { ...request, requestedAt: '2026-08-20T18:02:01.000Z' },
      },
    ],
    [
      'observation before key validity',
      {
        enrollment: { ...enrollment, validFrom: '2026-08-20T18:03:00.001Z' },
        request: { ...request, requestedAt: '2026-08-20T18:03:00.001Z' },
        lease: { ...lease, issuedAt: '2026-08-20T18:03:00.001Z' },
      },
    ],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(
      verifySyntheticTelebirrSignedRelayObservation(verificationInput(overrides), publicKeySpki),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'enrollment_expired' });
  });

  it.each([
    ['source profile', { sourceProfile: 'telebirr_official_receipt_v2' }],
    ['parser version', { parserVersion: 'telebirr-official-receipt-parser-v2' }],
    ['normalizer version', { normalizerVersion: 'telebirr-official-receipt-normalizer-v2' }],
    ['adapter version', { adapterVersion: 'telebirr-synthetic-relay-adapter-v2' }],
  ])('rejects an unrecognized %s at the exact codec boundary', (_label, override) => {
    const candidate = observationBodyWith(override);
    expect(decodeTelebirrRelayObservationBody(candidate)).toBeUndefined();
    expect(canonicalTelebirrRelayObservationBodyBytes(candidate)).toBeUndefined();
  });

  it.each([
    ['enrollment', enrollment, decodeTelebirrRelayEnrollmentEnvelope],
    ['request', request, decodeTelebirrRelayRequestEnvelope],
    ['lease', lease, decodeTelebirrRelayLeaseEnvelope],
    ['facts', foundFacts, decodeTelebirrRelayReceiptFacts],
    ['body', observationBodyWith(), decodeTelebirrRelayObservationBody],
    ['signed envelope', signedEnvelope(), decodeTelebirrRelaySignedObservationEnvelope],
  ] as const)('rejects extra data in the exact %s codec', (_label, candidate, decoder) => {
    expect(decoder({ ...candidate, rawReceipt: 'synthetic-raw-material' })).toBeUndefined();
  });

  it('rejects accessors and proxies without invoking hostile code', () => {
    const getter = vi.fn(() => 1);
    const accessor = Object.defineProperty({}, 'contractVersion', {
      enumerable: true,
      get: getter,
    });
    expect(decodeTelebirrRelayEnrollmentEnvelope(accessor)).toBeUndefined();
    expect(decodeTelebirrRelayRequestEnvelope(new Proxy(request, {}))).toBeUndefined();
    expect(decodeTelebirrRelayLeaseEnvelope(new Proxy(lease, {}))).toBeUndefined();
    expect(
      decodeTelebirrRelayObservationBody(new Proxy(observationBodyWith(), {})),
    ).toBeUndefined();
    expect(
      decodeTelebirrRelaySignedObservationEnvelope(new Proxy(signedEnvelope(), {})),
    ).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ['duplicate replay identity', [repeatedSha256('e'), repeatedSha256('e')]],
    ['malformed replay identity', ['caller-says-clear']],
  ])('rejects a %s instead of accepting a trustable replay boolean', (_label, identities) => {
    expect(
      verifySyntheticTelebirrSignedRelayObservation(
        verificationInput({ serverComputedReplayIdentities: identities }),
        publicKeySpki,
      ),
    ).toMatchObject({ disposition: 'invalid_request', reasonCode: 'invalid_request' });
  });

  it('rejects sparse or decorated server replay arrays', () => {
    const sparse = new Array(1) as string[];
    const decorated = Object.assign([repeatedSha256('f')], { trusted: true });
    for (const identities of [sparse, decorated]) {
      expect(
        verifySyntheticTelebirrSignedRelayObservation(
          verificationInput({ serverComputedReplayIdentities: identities }),
          publicKeySpki,
        ),
      ).toMatchObject({ disposition: 'invalid_request' });
    }
  });

  it('does not accept a caller-provided signature-valid or replay-clear authority boolean', () => {
    const candidate = {
      ...verificationInput(),
      signatureValid: true,
      replayClear: true,
    };
    expect(verifySyntheticTelebirrSignedRelayObservation(candidate, publicKeySpki)).toMatchObject({
      disposition: 'invalid_request',
      ...allCapabilitiesDisabled,
    });
  });

  it('requires canonical 64-byte P1363 base64url signatures', () => {
    const envelope = signedEnvelope();
    for (const signature of [
      `${envelope.signature}=`,
      envelope.signature.slice(1),
      `+${envelope.signature.slice(1)}`,
      'A'.repeat(88),
    ]) {
      expect(
        decodeTelebirrRelaySignedObservationEnvelope({ ...envelope, signature }),
      ).toBeUndefined();
    }
  });

  it('projects only fixed redacted fields and revalidates disabled capabilities', () => {
    const verified = verifySyntheticTelebirrSignedRelayObservation(
      verificationInput(),
      publicKeySpki,
    );
    const redacted = redactedTelebirrSignedRelayVerificationForLog(verified);
    const serialized = JSON.stringify(redacted);
    expect(redacted).toMatchObject({
      disposition: 'would_forward_signed_observation',
      reasonCode: 'signed_observation_verified',
      ...allCapabilitiesDisabled,
    });
    for (const forbidden of [
      enrollment.deviceId,
      enrollment.keyId,
      request.requestId,
      request.jobId,
      lease.leaseId,
      lease.challengeId,
      request.referenceFingerprint,
      verified.verifiedBodyDigest!,
      verified.replayIdentity!,
      'amountMinor',
      signedEnvelope().signature,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      redactedTelebirrSignedRelayVerificationForLog({ ...verified, networkAllowed: true }),
    ).toMatchObject({ disposition: 'invalid_request', ...allCapabilitiesDisabled });
  });

  it('accepts only exact internally consistent redacted result variants', () => {
    const forward = verifySyntheticTelebirrSignedRelayObservation(
      verificationInput(),
      publicKeySpki,
    );
    const earlyReview = verifySyntheticTelebirrSignedRelayObservation(
      verificationInput({
        signedObservation: signedEnvelope(
          observationBodyWith({ requestId: 'synthetic-request-0002' }),
        ),
      }),
      publicKeySpki,
    );
    const validEnvelope = signedEnvelope();
    const signatureBytes = Buffer.from(validEnvelope.signature, 'base64url');
    signatureBytes[0] = signatureBytes[0]! ^ 1;
    const lateReview = verifySyntheticTelebirrSignedRelayObservation(
      verificationInput({
        signedObservation: {
          ...validEnvelope,
          signature: signatureBytes.toString('base64url'),
        },
      }),
      publicKeySpki,
    );

    expect(redactedTelebirrSignedRelayVerificationForLog(forward)).toMatchObject({
      disposition: 'would_forward_signed_observation',
      reasonCode: 'signed_observation_verified',
    });
    expect(redactedTelebirrSignedRelayVerificationForLog(earlyReview)).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'binding_mismatch',
    });
    expect(redactedTelebirrSignedRelayVerificationForLog(lateReview)).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'signature_invalid',
    });

    const forged = [
      { ...forward, disposition: 'invalid_request' },
      { ...forward, disposition: 'would_review' },
      { ...forward, reasonCode: 'binding_mismatch' },
      { ...forward, verifiedBodyDigest: null },
      { ...forward, replayIdentity: null },
      {
        ...earlyReview,
        reasonCode: 'signed_observation_verified',
      },
      {
        ...earlyReview,
        verifiedBodyDigest: repeatedSha256('1'),
        replayIdentity: repeatedSha256('2'),
      },
      { ...lateReview, verifiedBodyDigest: null },
      { ...lateReview, replayIdentity: null },
      { ...lateReview, reasonCode: 'binding_mismatch' },
      { ...forward, unexpectedVariantKey: 'synthetic' },
    ];
    for (const candidate of forged) {
      expect(redactedTelebirrSignedRelayVerificationForLog(candidate)).toMatchObject({
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        ...allCapabilitiesDisabled,
      });
    }

    const { reasonCode: _removedReason, ...missingVariantKey } = forward;
    expect(redactedTelebirrSignedRelayVerificationForLog(missingVariantKey)).toMatchObject({
      disposition: 'invalid_request',
      reasonCode: 'invalid_request',
    });
  });

  it.each(Object.keys(allCapabilitiesDisabled))(
    'rejects forged enabled %s in the redacted projector',
    (capability) => {
      const verified = verifySyntheticTelebirrSignedRelayObservation(
        verificationInput(),
        publicKeySpki,
      );
      expect(
        redactedTelebirrSignedRelayVerificationForLog({
          ...verified,
          [capability]: true,
        }),
      ).toMatchObject({
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        ...allCapabilitiesDisabled,
      });
    },
  );
});
