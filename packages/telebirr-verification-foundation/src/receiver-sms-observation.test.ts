import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  RECEIVER_SMS_PROTOCOL_MODE,
  RECEIVER_SMS_SOURCE_PROFILE,
  canonicalReceiverSmsObservationSignatureBytes,
  digestReceiverSmsObservationBody,
  verifyReceiverSmsObservation,
} from './receiver-sms-observation.js';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = publicKey.export({ format: 'der', type: 'spki' });
const spkiDigest = `sha256:${createHash('sha256').update(spki).digest('hex')}`;
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function fixture(
  providerCode: 'telebirr' | 'cbe_birr' = 'telebirr',
  occurredAt = '2026-10-20T14:41:00.000Z',
) {
  const assignment = {
    providerCode,
    candidateId: 'a681cdd0-4d74-47c1-a420-07a14521550b',
    referenceFingerprint: 'a'.repeat(64),
    receiverRevisionId: '43119b2b-6644-4ce4-adc3-38ab89031704',
    receiverVersion: 3,
    receiverProfileDigest: digest('b'),
    expectedReceiverNameDigest: digest('c'),
    deviceId: 'receiver_device_001',
    keyId: 'receiver_key_001',
    challengeId: 'a2f47ba0-2a89-4f68-ac66-289603f34922',
    challengeDigest: digest('d'),
    sourceSubscriptionId: 5,
    submittedAt: '2026-10-20T14:44:00.000Z',
    issuedAt: '2026-10-20T14:47:00.000Z',
    expiresAt: '2026-10-20T14:50:00.000Z',
  };
  const enrollment = {
    deviceId: assignment.deviceId,
    keyId: assignment.keyId,
    publicKeySpkiSha256: spkiDigest,
    receiverRevisionId: assignment.receiverRevisionId,
    receiverVersion: assignment.receiverVersion,
    receiverProfileDigest: assignment.receiverProfileDigest,
    state: 'active',
    validFrom: '2026-10-20T00:00:00.000Z',
    validUntil: '2026-10-21T00:00:00.000Z',
  };
  const body = {
    contractVersion: 1,
    protocolMode: RECEIVER_SMS_PROTOCOL_MODE,
    sourceProfile: RECEIVER_SMS_SOURCE_PROFILE,
    providerCode,
    candidateId: assignment.candidateId,
    referenceFingerprint: assignment.referenceFingerprint,
    receiverRevisionId: assignment.receiverRevisionId,
    receiverVersion: assignment.receiverVersion,
    receiverProfileDigest: assignment.receiverProfileDigest,
    expectedReceiverNameDigest: assignment.expectedReceiverNameDigest,
    deviceId: assignment.deviceId,
    keyId: assignment.keyId,
    challengeId: assignment.challengeId,
    challengeDigest: assignment.challengeDigest,
    sourceSubscriptionId: assignment.sourceSubscriptionId,
    sourceMessageDigest: digest('e'),
    amountMinor: 10_000,
    currencyCode: 'ETB',
    occurredAt,
    receivedAt: '2026-10-20T14:42:00.000Z',
    observedAt: '2026-10-20T14:48:00.000Z',
  };
  const signedObservation = {
    contractVersion: 1,
    protocolMode: RECEIVER_SMS_PROTOCOL_MODE,
    bodyDigest: digestReceiverSmsObservationBody(body)!,
    body,
    signature: sign('sha256', canonicalReceiverSmsObservationSignatureBytes(body)!, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  return {
    input: {
      assessedAt: '2026-10-20T14:48:03.000Z',
      trustedAssignment: assignment,
      trustedEnrollment: enrollment,
      signedObservation,
    },
    spki,
  };
}

describe('direct receiver SMS observation', () => {
  it.each(['telebirr', 'cbe_birr'] as const)(
    'authenticates a signed %s match without granting money authority',
    (provider) => {
      const { input, spki: key } = fixture(provider);
      const result = verifyReceiverSmsObservation(input, key);
      expect(result.disposition).toBe('signed_sms_matches_assignment');
      expect(result.phoneSignatureVerified).toBe(true);
      expect(result.bankAuthenticationPerformed).toBe(false);
      expect(result.financialActionAllowed).toBe(false);
      if (result.evidence) expect(result.evidence.providerCode).toBe(provider);
    },
  );

  it('sends a signed old payment to Owner approval', () => {
    const { input, spki: key } = fixture('cbe_birr', '2026-10-20T13:41:00.000Z');
    const result = verifyReceiverSmsObservation(input, key);
    expect(result.disposition).toBe('old_sms_requires_owner_approval');
  });

  it('rejects changed amount, provider, SIM, or receiver binding', () => {
    const { input, spki: key } = fixture();
    for (const change of [
      { amountMinor: 20_000 },
      { providerCode: 'cbe_birr' },
      { sourceSubscriptionId: 1 },
      { receiverVersion: 4 },
    ]) {
      const changed = {
        ...input,
        signedObservation: {
          ...input.signedObservation,
          body: { ...input.signedObservation.body, ...change },
        },
      };
      expect(verifyReceiverSmsObservation(changed, key).disposition).toBe('review');
    }
  });

  it('rejects a different paired key, stale enrollment, and replay after upload window', () => {
    const { input, spki: key } = fixture();
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
      format: 'der',
      type: 'spki',
    });
    expect(verifyReceiverSmsObservation(input, other).disposition).toBe('review');
    expect(
      verifyReceiverSmsObservation(
        { ...input, trustedEnrollment: { ...input.trustedEnrollment, state: 'revoked' } },
        key,
      ).disposition,
    ).toBe('review');
    expect(
      verifyReceiverSmsObservation({ ...input, assessedAt: '2026-10-20T15:10:00.000Z' }, key)
        .disposition,
    ).toBe('review');
  });
});
