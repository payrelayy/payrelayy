import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
  ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
  canonicalRoutineTelebirrLookupAssignmentSignatureBytes,
  digestRoutineTelebirrLookupAssignmentBody,
  digestRoutineTelebirrReceiverName,
} from './routine-signed-lookup-assignment.js';
import {
  ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION,
  canonicalRoutineTelebirrObservationSignatureBytes,
  digestRoutineTelebirrObservationBody,
  digestRoutineTelebirrObservationFacts,
} from './routine-signed-observation.js';
import {
  assessRoutineTelebirrNoMoneyAssignment,
  assessRoutineTelebirrNoMoneyEvidence,
} from './routine-no-money-evidence.js';
import { assessRoutineTelebirrPaidPhoneEvidence } from './routine-paid-phone-evidence.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const hash = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function fixture() {
  const signerKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerSpki = signerKey.publicKey.export({ type: 'spki', format: 'der' });
  const deviceSpki = deviceKey.publicKey.export({ type: 'spki', format: 'der' });
  const header = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
  };
  const trustedRawReference = 'SAMPLE9ABC1234';
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
    expectedReceiverNameDigest: digestRoutineTelebirrReceiverName('pilot receiver')!,
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
    rawReference: trustedRawReference,
    referenceFingerprint: trustedLookup.referenceFingerprint,
    referenceKeyVersion: trustedLookup.referenceKeyVersion,
    referenceProfileVersion: trustedLookup.referenceProfileVersion,
    submittedAt: trustedLookup.submittedAt,
    receiverRevisionId: trustedLookup.receiverRevisionId,
    receiverVersion: trustedLookup.receiverVersion,
    receiverProfileDigest: trustedLookup.receiverProfileDigest,
    receiverNameNormalizerVersion: ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized: 'pilot receiver',
    expectedReceiverNameDigest: trustedLookup.expectedReceiverNameDigest,
    deviceId: trustedLookup.deviceId,
    keyId: trustedLookup.keyId,
    challengeId: trustedLookup.challengeId,
    challengeDigest: trustedLookup.challengeDigest,
    sourceProfile: 'telebirr_official_receipt_v1',
    issuedAt: trustedLookup.issuedAt,
    expiresAt: trustedLookup.expiresAt,
  };
  const signedAssignment = (body: typeof assignmentBody) => ({
    ...header,
    transcriptVersion: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineTelebirrLookupAssignmentBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: trustedSigner.signerKeyId,
    body,
    signature: sign('sha256', canonicalRoutineTelebirrLookupAssignmentSignatureBytes(body)!, {
      key: signerKey.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
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
  const observationBody = (receiptFacts: typeof facts) => ({
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
    observedAt: '2026-10-05T18:03:00.000Z',
    facts: receiptFacts,
  });
  const signedObservation = (body: ReturnType<typeof observationBody>, key: KeyObject) => ({
    ...header,
    transcriptVersion: ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineTelebirrObservationBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body,
    signature: sign('sha256', canonicalRoutineTelebirrObservationSignatureBytes(body)!, {
      key,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
  const input = {
    assessedAt: '2026-10-05T18:04:00.000Z',
    trustedLookup,
    trustedRawReference,
    trustedSigner,
    deviceEnrollment,
    signedAssignment: signedAssignment(assignmentBody),
    signedObservation: signedObservation(observationBody(facts), deviceKey.privateKey),
  };
  return {
    input,
    signerSpki,
    deviceSpki,
    assignmentBody,
    signedAssignment,
    facts,
    observationBody,
    signedObservation,
    deviceKey,
  };
}

describe('routine TeleBirr no-money evidence boundary', () => {
  it('binds both signatures to one supplied lookup snapshot without enabling any money action', () => {
    const { input, signerSpki, deviceSpki } = fixture();
    const { signedObservation: _observation, ...assignmentInput } = input;
    expect(
      assessRoutineTelebirrNoMoneyAssignment(assignmentInput, signerSpki, deviceSpki),
    ).toMatchObject({
      serverSignatureVerified: true,
      providedSnapshotMatched: true,
      pollAuthorized: false,
      financialActionAllowed: false,
      disposition: 'would_forward_signed_lookup',
    });
    const result = assessRoutineTelebirrNoMoneyEvidence(input, signerSpki, deviceSpki);
    expect(result).toMatchObject({
      advisoryOnly: true,
      serverSignatureVerified: true,
      deviceSignatureVerified: true,
      providedSnapshotMatched: true,
      sourceAuthenticationPerformed: false,
      databaseWriteAllowed: false,
      claimAllowed: false,
      settlementAllowed: false,
      enqueueAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      disposition: 'would_forward_signed_evidence',
      reasonCode: 'signed_evidence_matches_policy',
    });
    expect(result.replayIdentity).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(input.trustedRawReference);
  });

  it('rejects even a valid server signature when its exact reference or database snapshot differs', () => {
    const { input, signerSpki, deviceSpki, assignmentBody, signedAssignment } = fixture();
    const differentReference = signedAssignment({
      ...assignmentBody,
      rawReference: 'SAMPLE9ABC9999',
    });
    expect(
      assessRoutineTelebirrNoMoneyEvidence(
        { ...input, signedAssignment: differentReference },
        signerSpki,
        deviceSpki,
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'lookup_snapshot_mismatch' });
    expect(
      assessRoutineTelebirrNoMoneyEvidence(
        { ...input, trustedLookup: { ...input.trustedLookup, receiverVersion: 4 } },
        signerSpki,
        deviceSpki,
      ).reasonCode,
    ).toBe('lookup_snapshot_mismatch');
  });

  it('rejects tampered signatures and an unrecognized enrolled device', () => {
    const { input, signerSpki, deviceSpki } = fixture();
    expect(
      assessRoutineTelebirrNoMoneyEvidence(
        { ...input, signedAssignment: { ...input.signedAssignment, signature: 'A'.repeat(86) } },
        signerSpki,
        deviceSpki,
      ).reasonCode,
    ).toBe('assignment_invalid');
    expect(
      assessRoutineTelebirrNoMoneyEvidence(
        { ...input, signedObservation: { ...input.signedObservation, signature: 'A'.repeat(86) } },
        signerSpki,
        deviceSpki,
      ).reasonCode,
    ).toBe('observation_invalid');
    const otherDeviceSpki = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    }).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    expect(
      assessRoutineTelebirrNoMoneyEvidence(input, signerSpki, otherDeviceSpki).reasonCode,
    ).toBe('assignment_invalid');
  });

  it('keeps a signed reversed or stale receipt in review', () => {
    const { input, signerSpki, deviceSpki, facts, observationBody, signedObservation, deviceKey } =
      fixture();
    const reversed = signedObservation(
      observationBody({ ...facts, providerFinalStatus: 'reversed' }),
      deviceKey.privateKey,
    );
    const result = assessRoutineTelebirrNoMoneyEvidence(
      { ...input, signedObservation: reversed },
      signerSpki,
      deviceSpki,
    );
    expect(result).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'receipt_policy_review',
      serverSignatureVerified: true,
      deviceSignatureVerified: true,
      financialActionAllowed: false,
    });
    expect(
      assessRoutineTelebirrNoMoneyEvidence(
        { ...input, assessedAt: '2026-10-05T18:05:00.000Z' },
        signerSpki,
        deviceSpki,
      ).reasonCode,
    ).toBe('assignment_invalid');
  });

  it('rejects extra input and never treats caller-supplied trust as provider authentication', () => {
    const { input, signerSpki, deviceSpki } = fixture();
    expect(
      assessRoutineTelebirrNoMoneyEvidence(
        { ...input, sourceAuthenticationPerformed: true },
        signerSpki,
        deviceSpki,
      ).reasonCode,
    ).toBe('invalid_request');
  });
});

describe('routine TeleBirr paid-phone evidence adapter', () => {
  it('rejects a legacy no-money challenge even when both signatures and receipt facts are valid', () => {
    const { input, signerSpki, deviceSpki } = fixture();
    expect(
      assessRoutineTelebirrPaidPhoneEvidence(
        { ...input, trustedIssuanceMode: 'no_money' },
        signerSpki,
        deviceSpki,
      ),
    ).toEqual({
      disposition: 'review',
      reasonCode: 'no_money_challenge',
      financialActionAllowed: false,
      evidence: null,
    });
  });

  it('returns a redacted TeleBirr-specific candidate for the shared atomic ledger', () => {
    const { input, signerSpki, deviceSpki } = fixture();
    const result = assessRoutineTelebirrPaidPhoneEvidence(
      { ...input, trustedIssuanceMode: 'paid' },
      signerSpki,
      deviceSpki,
    );
    expect(result).toMatchObject({
      disposition: 'paid_phone_observation_matches_policy',
      reasonCode: 'signed_paid_phone_receipt_matches_policy',
      financialActionAllowed: false,
      evidence: {
        providerCode: 'telebirr',
        candidateId: input.trustedLookup.candidateId,
        challengeId: input.trustedLookup.challengeId,
        referenceFingerprint: input.trustedLookup.referenceFingerprint,
        receiverRevisionId: input.trustedLookup.receiverRevisionId,
        receiverVersion: input.trustedLookup.receiverVersion,
        amountMinor: input.signedObservation.body.facts.amountMinor,
        currencyCode: 'ETB',
      },
    });
    expect(JSON.stringify(result)).not.toContain(input.trustedRawReference);
    expect(JSON.stringify(result)).not.toContain(input.signedAssignment.signature);
    expect(JSON.stringify(result)).not.toContain(input.signedObservation.signature);
  });

  it('keeps tampered, stale, and non-completed paid observations in review', () => {
    const { input, signerSpki, deviceSpki, facts, observationBody, signedObservation, deviceKey } =
      fixture();
    const paid = { ...input, trustedIssuanceMode: 'paid' };
    expect(
      assessRoutineTelebirrPaidPhoneEvidence(
        { ...paid, signedObservation: { ...input.signedObservation, signature: 'A'.repeat(86) } },
        signerSpki,
        deviceSpki,
      ),
    ).toMatchObject({ disposition: 'review', evidence: null });
    expect(
      assessRoutineTelebirrPaidPhoneEvidence(
        { ...paid, assessedAt: '2026-10-05T18:05:00.000Z' },
        signerSpki,
        deviceSpki,
      ),
    ).toMatchObject({ disposition: 'review', evidence: null });
    const reversed = signedObservation(
      observationBody({ ...facts, providerFinalStatus: 'reversed' }),
      deviceKey.privateKey,
    );
    expect(
      assessRoutineTelebirrPaidPhoneEvidence(
        { ...paid, signedObservation: reversed },
        signerSpki,
        deviceSpki,
      ),
    ).toMatchObject({ disposition: 'review', reasonCode: 'receipt_policy_review', evidence: null });
  });

  it('rejects a valid phone observation once its receipt is one hour old', () => {
    const {
      input,
      signerSpki,
      deviceSpki,
      assignmentBody,
      signedAssignment,
      facts,
      observationBody,
      signedObservation,
      deviceKey,
    } = fixture();
    const submittedAt = '2026-10-05T18:58:00.000Z';
    const issuedAt = '2026-10-05T18:59:00.000Z';
    const expiresAt = '2026-10-05T19:04:00.000Z';
    const receiptFacts = {
      ...facts,
      occurredAt: '2026-10-05T18:00:00.000Z',
      retrievedAt: '2026-10-05T18:59:30.000Z',
    };
    const result = assessRoutineTelebirrPaidPhoneEvidence(
      {
        ...input,
        assessedAt: '2026-10-05T19:00:00.000Z',
        trustedIssuanceMode: 'paid',
        trustedLookup: { ...input.trustedLookup, submittedAt, issuedAt, expiresAt },
        signedAssignment: signedAssignment({ ...assignmentBody, submittedAt, issuedAt, expiresAt }),
        signedObservation: signedObservation(
          { ...observationBody(receiptFacts), observedAt: receiptFacts.retrievedAt },
          deviceKey.privateKey,
        ),
      },
      signerSpki,
      deviceSpki,
    );
    expect(result).toMatchObject({
      disposition: 'review',
      reasonCode: 'payment_expired',
      financialActionAllowed: false,
      evidence: null,
    });
  });

  it('cannot accept another provider or caller-supplied financial authority', () => {
    const { input, signerSpki, deviceSpki } = fixture();
    expect(
      assessRoutineTelebirrPaidPhoneEvidence(
        { ...input, trustedIssuanceMode: 'cbe_birr' },
        signerSpki,
        deviceSpki,
      ),
    ).toMatchObject({ disposition: 'review', evidence: null });
    expect(
      assessRoutineTelebirrPaidPhoneEvidence(
        { ...input, trustedIssuanceMode: 'paid', claimAllowed: true },
        signerSpki,
        deviceSpki,
      ),
    ).toMatchObject({ disposition: 'review', reasonCode: 'invalid_request', evidence: null });
  });
});
