import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { digestTelebirrLivePilotReceiverName } from './live-private-pilot-protocol.js';
import {
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
  ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
  canonicalRoutineTelebirrLookupAssignmentSignatureBytes,
  digestRoutineTelebirrLookupAssignmentBody,
  digestRoutineTelebirrReceiverName,
  verifyRoutineTelebirrSignedLookupAssignment,
} from './routine-signed-lookup-assignment.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const candidateId = '8b9b4a1c-616d-495b-a259-56d39ffef5d1';
const receiverRevisionId = '98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803';
const challengeId = '328535af-2636-44cd-84be-6effdfe9cac1';

function fixture() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
  const devicePair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceSpki = devicePair.publicKey.export({ type: 'spki', format: 'der' });
  const header = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
  };
  const body = {
    ...header,
    candidateId,
    rawReference: 'PILOT9ABC1234',
    referenceFingerprint: 'a'.repeat(64),
    referenceKeyVersion: 2,
    referenceProfileVersion: 2,
    submittedAt: '2026-10-05T18:00:00.000Z',
    receiverRevisionId,
    receiverVersion: 3,
    receiverProfileDigest: sha('b'),
    receiverNameNormalizerVersion: ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized: 'pilot receiver',
    expectedReceiverNameDigest: digestRoutineTelebirrReceiverName('pilot receiver')!,
    deviceId: 'routine-device-0001',
    keyId: 'routine-device-key-0001',
    challengeId,
    challengeDigest: sha('d'),
    sourceProfile: 'telebirr_official_receipt_v1',
    issuedAt: '2026-10-05T18:02:00.000Z',
    expiresAt: '2026-10-05T18:05:00.000Z',
  };
  const trustedSigner = {
    ...header,
    signerKeyId: 'routine-server-key-0001',
    publicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
  };
  const deviceEnrollment = {
    ...header,
    deviceId: body.deviceId,
    keyId: body.keyId,
    publicKeySpkiSha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    state: 'active',
    validFrom: '2026-10-05T17:00:00.000Z',
    validUntil: '2026-10-06T17:00:00.000Z',
    receiverRevisionId,
    receiverVersion: 3,
    receiverProfileDigest: body.receiverProfileDigest,
  };
  const signedAssignment = {
    ...header,
    transcriptVersion: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineTelebirrLookupAssignmentBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: trustedSigner.signerKeyId,
    body,
    signature: sign('sha256', canonicalRoutineTelebirrLookupAssignmentSignatureBytes(body)!, {
      key: pair.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
  return {
    spki,
    input: {
      assessedAt: '2026-10-05T18:03:00.000Z',
      trustedSigner,
      deviceEnrollment,
      localDevicePublicKeySpkiDer: deviceSpki,
      signedAssignment,
    },
  };
}

describe('routine TeleBirr signed lookup assignment', () => {
  it('verifies a routine server signature without asserting database or financial authority', () => {
    const { input, spki } = fixture();
    expect(verifyRoutineTelebirrSignedLookupAssignment(input, spki)).toEqual({
      advisoryOnly: true,
      serverSignatureVerified: true,
      candidateDatabaseBindingPerformed: false,
      databaseWriteAllowed: false,
      claimAllowed: false,
      settlementAllowed: false,
      enqueueAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      disposition: 'would_accept_signed_assignment',
      reasonCode: 'signed_assignment_matches_binding',
    });
  });

  it('uses a routine-only digest for the normalized receiver name', () => {
    const routine = digestRoutineTelebirrReceiverName('  PILOT\tRECEIVER  ');
    expect(routine).toBe(digestRoutineTelebirrReceiverName('pilot receiver'));
    expect(routine).toBe('sha256:6f4b944f412c74330943d7cedb2a1b96906fe1b3d19f493551bead5d29ce03bd');
    expect(routine).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(routine).not.toBe(digestTelebirrLivePilotReceiverName('pilot receiver'));
    expect(digestRoutineTelebirrReceiverName('bad\u0000name')).toBeUndefined();
  });

  it('rejects unsigned changes, different signer or local device keys, and a bad signature', () => {
    const { input, spki } = fixture();
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        {
          ...input,
          signedAssignment: {
            ...input.signedAssignment,
            body: { ...input.signedAssignment.body, rawReference: 'PILOT9ABC9999' },
          },
        },
        spki,
      ).reasonCode,
    ).toBe('body_digest_mismatch');
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    expect(verifyRoutineTelebirrSignedLookupAssignment(input, other).reasonCode).toBe(
      'signer_key_mismatch',
    );
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        { ...input, localDevicePublicKeySpkiDer: other },
        spki,
      ).reasonCode,
    ).toBe('device_key_mismatch');
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        {
          ...input,
          signedAssignment: {
            ...input.signedAssignment,
            signature: `${input.signedAssignment.signature[0] === 'A' ? 'B' : 'A'}${input.signedAssignment.signature.slice(1)}`,
          },
        },
        spki,
      ).reasonCode,
    ).toBe('signature_invalid');
  });

  it('rejects revoked or expired signers and devices, plus receiver rotation', () => {
    const { input, spki } = fixture();
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        { ...input, trustedSigner: { ...input.trustedSigner, state: 'revoked' } },
        spki,
      ).reasonCode,
    ).toBe('signer_revoked_or_expired');
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        { ...input, deviceEnrollment: { ...input.deviceEnrollment, state: 'revoked' } },
        spki,
      ).reasonCode,
    ).toBe('device_revoked_or_expired');
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        { ...input, deviceEnrollment: { ...input.deviceEnrollment, receiverVersion: 4 } },
        spki,
      ).reasonCode,
    ).toBe('device_binding_mismatch');
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        { ...input, assessedAt: '2026-10-05T18:05:00.000Z' },
        spki,
      ).reasonCode,
    ).toBe('lookup_expired');
  });

  it('rejects pilot envelopes, malformed receiver digests, accessors, and extra fields', () => {
    const { input, spki } = fixture();
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        {
          ...input,
          signedAssignment: {
            ...input.signedAssignment,
            protocolMode: 'live_private_pilot_v1',
          },
        },
        spki,
      ).reasonCode,
    ).toBe('invalid_request');
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        {
          ...input,
          signedAssignment: {
            ...input.signedAssignment,
            body: { ...input.signedAssignment.body, expectedReceiverNameDigest: sha('9') },
          },
        },
        spki,
      ).reasonCode,
    ).toBe('invalid_request');
    expect(
      verifyRoutineTelebirrSignedLookupAssignment({ ...input, extra: true }, spki).reasonCode,
    ).toBe('invalid_request');
    const accessor = Object.defineProperty({ ...input }, 'assessedAt', {
      get: () => input.assessedAt,
    });
    expect(verifyRoutineTelebirrSignedLookupAssignment(accessor, spki).reasonCode).toBe(
      'invalid_request',
    );
  });
});
