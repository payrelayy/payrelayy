import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_MODE,
  ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_TRANSCRIPT,
  canonicalRoutineTelebirrEnrollmentReceiptSignatureBytes,
  decodeSignedRoutineTelebirrEnrollmentReceipt,
  digestRoutineTelebirrEnrollmentReceiptBody,
  verifySignedRoutineTelebirrEnrollmentReceipt,
} from './routine-enrollment-receipt.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

function fixture() {
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = server.publicKey.export({ format: 'der', type: 'spki' });
  const body = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_MODE,
    enrollmentId: '55f26210-6754-4b93-8c8d-4ca7cf33e279',
    pairingEvidenceDigest: sha('a'),
    deviceId: 'routine-device-0001',
    keyId: 'routine-key-0001',
    devicePublicKeySpkiSha256: sha('b'),
    receiverRevisionId: '98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803',
    receiverVersion: 3,
    receiverProfileDigest: sha('c'),
    expectedReceiverNameDigest: sha('d'),
    validFrom: '2026-10-06T12:00:00.000Z',
    validUntil: '2026-11-05T12:00:00.000Z',
    issuedAt: '2026-10-06T12:00:01.000Z',
    assignmentPollingAllowed: false,
    financialActionAllowed: false,
    moneyMovementAllowed: false,
  };
  const signerKeyId = 'routine-server-signer-0001';
  function signed(value = body) {
    return {
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_MODE,
      transcriptVersion: ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_TRANSCRIPT,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestRoutineTelebirrEnrollmentReceiptBody(value)!,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      signerKeyId,
      body: value,
      signature: sign(
        'sha256',
        canonicalRoutineTelebirrEnrollmentReceiptSignatureBytes(value, signerKeyId)!,
        { key: server.privateKey, dsaEncoding: 'ieee-p1363' },
      ).toString('base64url'),
    };
  }
  const trustedSigner = {
    signerKeyId,
    publicKeySpki: spki.toString('base64url'),
    publicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
    validFrom: '2026-10-06T00:00:00.000Z',
    validUntil: '2026-11-06T00:00:00.000Z',
    state: 'active',
  };
  const binding = {
    pairingEvidenceDigest: body.pairingEvidenceDigest,
    deviceId: body.deviceId,
    keyId: body.keyId,
    devicePublicKeySpkiSha256: body.devicePublicKeySpkiSha256,
    receiverRevisionId: body.receiverRevisionId,
    receiverVersion: body.receiverVersion,
    receiverProfileDigest: body.receiverProfileDigest,
    expectedReceiverNameDigest: body.expectedReceiverNameDigest,
  };
  return { body, signed, trustedSigner, binding, assessedAt: '2026-10-07T12:00:00.000Z' };
}

describe('routine-only TeleBirr signed enrollment receipt', () => {
  it('authenticates only the exact trusted signer, enrolled phone, receiver and time', () => {
    const { signed, trustedSigner, binding, assessedAt } = fixture();
    expect(
      verifySignedRoutineTelebirrEnrollmentReceipt(signed(), trustedSigner, binding, assessedAt),
    ).toBe(true);
    expect(decodeSignedRoutineTelebirrEnrollmentReceipt(signed())).toBeDefined();
  });

  it('pins a cross-runtime body digest and rejects pilot relabeling', () => {
    const { body } = fixture();
    expect(digestRoutineTelebirrEnrollmentReceiptBody(body)).toBe(
      'sha256:216dcfc9894a15bfd2ea197c60f47fa7f165d013aaa87e3460169e255ccfd6eb',
    );
    expect(
      digestRoutineTelebirrEnrollmentReceiptBody({
        ...body,
        protocolMode: 'device_bridge_no_money_v1',
      }),
    ).toBeUndefined();
  });

  it('rejects changed body, binding, signer, signature, expiry and financial authority', () => {
    const { body, signed, trustedSigner, binding, assessedAt } = fixture();
    const receipt = signed();
    const check = (
      candidate: unknown,
      signer: unknown = trustedSigner,
      expected: unknown = binding,
      time: unknown = assessedAt,
    ) => verifySignedRoutineTelebirrEnrollmentReceipt(candidate, signer, expected, time);
    expect(check({ ...receipt, body: { ...body, receiverVersion: 4 } })).toBe(false);
    expect(check(receipt, trustedSigner, { ...binding, keyId: 'different-key-0001' })).toBe(false);
    expect(check(receipt, { ...trustedSigner, state: 'revoked' })).toBe(false);
    expect(check(receipt, { ...trustedSigner, signerKeyId: 'different-signer-0001' })).toBe(false);
    expect(check({ ...receipt, signature: 'A'.repeat(86) })).toBe(false);
    expect(check(receipt, trustedSigner, binding, body.validUntil)).toBe(false);
    expect(check({ ...receipt, body: { ...body, assignmentPollingAllowed: true } })).toBe(false);
    expect(check({ ...receipt, body: { ...body, financialActionAllowed: true } })).toBe(false);
    expect(check({ ...receipt, body: { ...body, moneyMovementAllowed: true } })).toBe(false);
    expect(check({ ...receipt, body: { ...body, pilotEnrollmentId: body.enrollmentId } })).toBe(
      false,
    );
  });

  it('rejects malformed, accessor, proxy, and untrusted key material without throwing', () => {
    const { signed, trustedSigner, binding, assessedAt } = fixture();
    const receipt = signed();
    expect(
      verifySignedRoutineTelebirrEnrollmentReceipt(
        new Proxy(receipt, {}),
        trustedSigner,
        binding,
        assessedAt,
      ),
    ).toBe(false);
    expect(
      verifySignedRoutineTelebirrEnrollmentReceipt(
        receipt,
        { ...trustedSigner, publicKeySpkiSha256: sha('f') },
        binding,
        assessedAt,
      ),
    ).toBe(false);
    const accessor = Object.defineProperty({ ...receipt }, 'signature', {
      enumerable: true,
      get: () => receipt.signature,
    });
    expect(decodeSignedRoutineTelebirrEnrollmentReceipt(accessor)).toBeUndefined();
  });
});
