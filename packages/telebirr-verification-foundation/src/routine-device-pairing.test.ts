import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ROUTINE_TELEBIRR_DEVICE_PAIRING_PROTOCOL_MODE,
  ROUTINE_TELEBIRR_DEVICE_PAIRING_TRANSCRIPT_VERSION,
  assessRoutineTelebirrDevicePairingProof,
  canonicalRoutineTelebirrDevicePairingSignatureBytes,
  digestRoutineTelebirrDevicePairingBody,
} from './routine-device-pairing.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const pairingId = '55f26210-6754-4b93-8c8d-4ca7cf33e279';
const receiverRevisionId = '98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803';
const issuedAt = '2026-10-06T12:00:00.000Z';
const expiresAt = '2026-10-06T12:05:00.000Z';

function fixture() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  const header = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_TELEBIRR_DEVICE_PAIRING_PROTOCOL_MODE,
  };
  const binding = {
    pairingId,
    pairingNonceDigest: sha('a'),
    receiverRevisionId,
    receiverVersion: 3,
    receiverProfileDigest: sha('b'),
    expectedReceiverNameDigest: sha('c'),
  };
  const trustedChallenge = {
    ...header,
    ...binding,
    issuedAt: '2026-10-06T11:59:00.000Z',
    expiresAt: '2026-10-06T23:59:00.000Z',
    state: 'issued',
  };
  const body = {
    ...header,
    ...binding,
    deviceId: 'routine-device-0001',
    keyId: 'routine-device-key-0001',
    devicePublicKeySpki: spki.toString('base64url'),
    devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
    issuedAt,
    expiresAt,
  };
  function signedRequest(requestBody = body) {
    return {
      ...header,
      transcriptVersion: ROUTINE_TELEBIRR_DEVICE_PAIRING_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestRoutineTelebirrDevicePairingBody(requestBody)!,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      body: requestBody,
      signature: sign('sha256', canonicalRoutineTelebirrDevicePairingSignatureBytes(requestBody)!, {
        key: pair.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url'),
    };
  }
  return {
    body,
    trustedChallenge,
    signedRequest,
    input: {
      assessedAt: '2026-10-06T12:02:00.000Z',
      trustedChallenge,
      signedRequest: signedRequest(),
    },
  };
}

describe('routine-only TeleBirr device pairing proof', () => {
  it('verifies possession without consuming a challenge, enrolling, polling, or granting money', () => {
    const { input } = fixture();
    expect(assessRoutineTelebirrDevicePairingProof(input)).toEqual({
      advisoryOnly: true,
      deviceSignatureVerified: true,
      challengeConsumptionPerformed: false,
      enrollmentAllowed: false,
      databaseWriteAllowed: false,
      assignmentPollingAllowed: false,
      financialActionAllowed: false,
      disposition: 'would_forward_pairing_proof',
      reasonCode: 'device_proof_matches_challenge',
      pairingEvidenceDigest: input.signedRequest.bodyDigest,
    });
  });

  it('pins the Kotlin cross-runtime digest for a fixed synthetic public key', () => {
    const { body } = fixture();
    const spki =
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZl_5JsOZvoSviWoLO7NLMkWIxu4s2lmHNEbAY_-WhY6CGVICyKcxwVUSpWve1CrjjNY79QYUfCoUgGxQM4AhMg';
    const fixed = {
      ...body,
      devicePublicKeySpki: spki,
      devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(Buffer.from(spki, 'base64url')).digest('hex')}`,
    };
    expect(digestRoutineTelebirrDevicePairingBody(fixed)).toBe(
      'sha256:735665c0e0b6a5ce1bd8aab46974defb99be1bdc2bf8fced0b50fd63bab792d5',
    );
    expect(
      digestRoutineTelebirrDevicePairingBody({
        ...fixed,
        protocolMode: 'device_bridge_no_money_v1',
      }),
    ).toBeUndefined();
  });

  it('rejects a tampered signature, body, key and any pilot relabeling', () => {
    const { input, body, signedRequest } = fixture();
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        signedRequest: {
          ...input.signedRequest,
          body: { ...body, deviceId: 'routine-device-9999' },
        },
      }).reasonCode,
    ).toBe('body_digest_mismatch');
    const badSignature = 'A'.repeat(86);
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        signedRequest: { ...input.signedRequest, signature: badSignature },
      }).reasonCode,
    ).toBe('signature_invalid');
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
      format: 'der',
      type: 'spki',
    });
    const wrongKey = {
      ...body,
      devicePublicKeySpki: other.toString('base64url'),
      devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(other).digest('hex')}`,
    };
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        signedRequest: signedRequest(wrongKey),
      }).reasonCode,
    ).toBe('signature_invalid');
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        signedRequest: { ...input.signedRequest, protocolMode: 'device_bridge_no_money_v1' },
      }).reasonCode,
    ).toBe('invalid_request');
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        signedRequest: { ...input.signedRequest, body: { ...body, pilotRevisionId: pairingId } },
      }).reasonCode,
    ).toBe('invalid_request');
  });

  it('requires the independently trusted exact challenge and an unspent short window', () => {
    const { input, trustedChallenge } = fixture();
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        trustedChallenge: { ...trustedChallenge, state: 'consumed' },
      }).reasonCode,
    ).toBe('challenge_unavailable');
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        trustedChallenge: { ...trustedChallenge, pairingNonceDigest: sha('d') },
      }).reasonCode,
    ).toBe('challenge_binding_mismatch');
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        trustedChallenge: { ...trustedChallenge, receiverVersion: 2_147_483_648 },
      }).reasonCode,
    ).toBe('invalid_request');
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        trustedChallenge: { ...trustedChallenge, expiresAt: '2026-10-07T00:00:00.000Z' },
      }).reasonCode,
    ).toBe('challenge_expired');
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        assessedAt: '2026-10-07T00:00:00.000Z',
      }).reasonCode,
    ).toBe('challenge_expired');
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        assessedAt: '2026-10-06T12:06:00.000Z',
      }).reasonCode,
    ).toBe('request_expired');
  });

  it('rejects non-canonical keys, extra fields, and proxy input without throwing', () => {
    const { input, body } = fixture();
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        signedRequest: {
          ...input.signedRequest,
          body: { ...body, devicePublicKeySpki: `${body.devicePublicKeySpki}=` },
        },
      }).reasonCode,
    ).toBe('invalid_request');
    expect(
      assessRoutineTelebirrDevicePairingProof({
        ...input,
        signedRequest: { ...input.signedRequest, assignmentPollingAllowed: true },
      }).reasonCode,
    ).toBe('invalid_request');
    expect(assessRoutineTelebirrDevicePairingProof(new Proxy(input, {})).reasonCode).toBe(
      'invalid_request',
    );
  });
});
