import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ROUTINE_TELEBIRR_OBSERVATION_PROTOCOL_MODE,
  ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION,
  canonicalRoutineTelebirrObservationSignatureBytes,
  digestRoutineTelebirrObservationBody,
  digestRoutineTelebirrObservationFacts,
  verifyRoutineTelebirrSignedObservation,
} from './routine-signed-observation.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const candidateId = '8b9b4a1c-616d-495b-a259-56d39ffef5d1';
const receiverRevisionId = '98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803';
const challengeId = '328535af-2636-44cd-84be-6effdfe9cac1';

function fixture() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
  const header = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_TELEBIRR_OBSERVATION_PROTOCOL_MODE,
  };
  const trustedLookup = {
    ...header,
    candidateId,
    referenceFingerprint: 'a'.repeat(64),
    referenceKeyVersion: 2,
    referenceProfileVersion: 2,
    submittedAt: '2026-10-05T18:00:00.000Z',
    receiverRevisionId,
    receiverVersion: 3,
    receiverProfileDigest: sha('b'),
    expectedReceiverNameDigest: sha('c'),
    deviceId: 'routine-device-0001',
    keyId: 'routine-device-key-0001',
    challengeId,
    challengeDigest: sha('d'),
    issuedAt: '2026-10-05T18:02:00.000Z',
    expiresAt: '2026-10-05T18:05:00.000Z',
  };
  const deviceEnrollment = {
    ...header,
    deviceId: trustedLookup.deviceId,
    keyId: trustedLookup.keyId,
    publicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
    receiverRevisionId,
    receiverVersion: 3,
    receiverProfileDigest: trustedLookup.receiverProfileDigest,
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
  const body = {
    ...header,
    candidateId,
    referenceFingerprint: trustedLookup.referenceFingerprint,
    receiverRevisionId,
    receiverVersion: 3,
    receiverProfileDigest: trustedLookup.receiverProfileDigest,
    expectedReceiverNameDigest: trustedLookup.expectedReceiverNameDigest,
    deviceId: trustedLookup.deviceId,
    keyId: trustedLookup.keyId,
    challengeId,
    challengeDigest: trustedLookup.challengeDigest,
    sourceDocumentDigest: sha('e'),
    normalizedFactsDigest: digestRoutineTelebirrObservationFacts(facts)!,
    observedAt: '2026-10-05T18:03:00.000Z',
    facts,
  };
  const signedObservation = {
    ...header,
    transcriptVersion: ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineTelebirrObservationBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body,
    signature: sign('sha256', canonicalRoutineTelebirrObservationSignatureBytes(body)!, {
      key: pair.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  return {
    spki,
    privateKey: pair.privateKey,
    input: {
      assessedAt: '2026-10-05T18:04:00.000Z',
      trustedLookup,
      deviceEnrollment,
      signedObservation,
    },
  };
}

describe('routine TeleBirr paired-device observation', () => {
  it('verifies the device signature and matching policy, but grants no financial authority', () => {
    const { input, spki } = fixture();
    const result = verifyRoutineTelebirrSignedObservation(input, spki);
    expect(result).toMatchObject({
      advisoryOnly: true,
      deviceSignatureVerified: true,
      sourceAuthenticationPerformed: false,
      databaseWriteAllowed: false,
      disposition: 'would_forward_signed_observation',
      reasonCode: 'signed_observation_matches_policy',
      claimAllowed: false,
      settlementAllowed: false,
      enqueueAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
    });
    expect(result.replayIdentity).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(verifyRoutineTelebirrSignedObservation(input, spki).replayIdentity).toBe(
      result.replayIdentity,
    );
  });

  it('rejects unsigned mutations and different enrolled keys', () => {
    const { input, spki } = fixture();
    const mutated = {
      ...input,
      signedObservation: {
        ...input.signedObservation,
        body: { ...input.signedObservation.body, referenceFingerprint: 'b'.repeat(64) },
      },
    };
    expect(verifyRoutineTelebirrSignedObservation(mutated, spki).disposition).toBe('would_review');
    expect(verifyRoutineTelebirrSignedObservation(mutated, spki).reasonCode).toBe(
      'binding_mismatch',
    );
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    expect(verifyRoutineTelebirrSignedObservation(input, other).reasonCode).toBe(
      'device_key_mismatch',
    );
  });

  it('rejects revoked enrollment, expired challenge, and receiver-rotation mismatch', () => {
    const { input, spki } = fixture();
    expect(
      verifyRoutineTelebirrSignedObservation(
        {
          ...input,
          deviceEnrollment: { ...input.deviceEnrollment, state: 'revoked' },
        },
        spki,
      ).reasonCode,
    ).toBe('device_revoked_or_expired');
    expect(
      verifyRoutineTelebirrSignedObservation(
        {
          ...input,
          assessedAt: '2026-10-05T18:05:00.000Z',
        },
        spki,
      ).reasonCode,
    ).toBe('lookup_expired');
    expect(
      verifyRoutineTelebirrSignedObservation(
        {
          ...input,
          trustedLookup: { ...input.trustedLookup, receiverVersion: 4 },
        },
        spki,
      ).reasonCode,
    ).toBe('binding_mismatch');
  });

  it('rejects stale fact/body digests, invalid signature, and observation outside the lease', () => {
    const { input, spki } = fixture();
    expect(
      verifyRoutineTelebirrSignedObservation(
        {
          ...input,
          signedObservation: {
            ...input.signedObservation,
            body: { ...input.signedObservation.body, normalizedFactsDigest: sha('f') },
          },
        },
        spki,
      ).reasonCode,
    ).toBe('facts_digest_mismatch');
    expect(
      verifyRoutineTelebirrSignedObservation(
        {
          ...input,
          signedObservation: { ...input.signedObservation, bodyDigest: sha('f') },
        },
        spki,
      ).reasonCode,
    ).toBe('body_digest_mismatch');
    expect(
      verifyRoutineTelebirrSignedObservation(
        {
          ...input,
          signedObservation: {
            ...input.signedObservation,
            signature: `${input.signedObservation.signature[0] === 'A' ? 'B' : 'A'}${input.signedObservation.signature.slice(1)}`,
          },
        },
        spki,
      ).reasonCode,
    ).toBe('signature_invalid');
    expect(
      verifyRoutineTelebirrSignedObservation(
        {
          ...input,
          signedObservation: {
            ...input.signedObservation,
            body: { ...input.signedObservation.body, observedAt: '2026-10-05T18:01:59.000Z' },
          },
        },
        spki,
      ).reasonCode,
    ).toBe('observation_time_invalid');
  });

  it('routes signed but non-completed receipt facts to review', () => {
    const { input, spki, privateKey } = fixture();
    const facts = { ...input.signedObservation.body.facts, providerFinalStatus: 'pending' };
    const body = {
      ...input.signedObservation.body,
      facts,
      normalizedFactsDigest: digestRoutineTelebirrObservationFacts(facts)!,
    };
    const signedObservation = {
      ...input.signedObservation,
      body,
      bodyDigest: digestRoutineTelebirrObservationBody(body)!,
      signature: sign('sha256', canonicalRoutineTelebirrObservationSignatureBytes(body)!, {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url'),
    };
    expect(
      verifyRoutineTelebirrSignedObservation({ ...input, signedObservation }, spki).reasonCode,
    ).toBe('receipt_policy_review');
    expect(
      verifyRoutineTelebirrSignedObservation({ ...input, signedObservation }, spki),
    ).toMatchObject({ deviceSignatureVerified: true, financialActionAllowed: false });
  });

  it('rejects extra fields, accessors, and pilot envelopes', () => {
    const { input, spki } = fixture();
    expect(verifyRoutineTelebirrSignedObservation({ ...input, extra: true }, spki).reasonCode).toBe(
      'invalid_request',
    );
    const getter = Object.defineProperty({ ...input }, 'assessedAt', {
      get: () => input.assessedAt,
    });
    expect(verifyRoutineTelebirrSignedObservation(getter, spki).reasonCode).toBe('invalid_request');
    expect(
      verifyRoutineTelebirrSignedObservation(
        {
          ...input,
          signedObservation: { ...input.signedObservation, protocolMode: 'live_private_pilot_v1' },
        },
        spki,
      ).reasonCode,
    ).toBe('invalid_request');
  });
});
