import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto';

import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';
import {
  TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  TELEBIRR_REFERENCE_OPENING_PROVIDER,
  TELEBIRR_REFERENCE_OPENING_PURPOSE,
  type TelebirrScopedReferenceOpeningKey,
} from '@fetanagent/telebirr-reference-opening';
import {
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
  digestRoutineTelebirrReceiverName,
  digestRoutineTelebirrReceiverProfile,
  verifyRoutineTelebirrSignedLookupAssignment,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  RoutineTelebirrAssignmentUnavailableError,
  buildRoutineTelebirrSignedLookupAssignment,
  decodeRoutineTelebirrAssignmentMaterialRow,
} from './routine-telebirr-assignment-builder.js';

const ids = {
  candidate: '11111111-1111-4111-8111-111111111111',
  challenge: '22222222-2222-4222-8222-222222222222',
  receiver: '33333333-3333-4333-8333-333333333333',
  enrollment: '44444444-4444-4444-8444-444444444444',
  signer: '55555555-5555-4555-8555-555555555555',
} as const;
const encryptionMaster = 'a'.repeat(64);
const fingerprintMaster = 'b'.repeat(64);
const receiverName = '  ROUTINE\tRECEIVER  ';
const receiverReferenceFingerprint = 'c'.repeat(64);
const issuedAt = '2026-10-06T13:02:00.000Z';
const expiresAt = '2026-10-06T13:07:00.000Z';
const assessedAt = '2026-10-06T13:03:00.000Z';
const signerPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const signerSpki = Buffer.from(signerPair.publicKey.export({ type: 'spki', format: 'der' }));
const devicePair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const deviceSpki = Buffer.from(devicePair.publicKey.export({ type: 'spki', format: 'der' }));
const spkiDigest = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function openingKey(): TelebirrScopedReferenceOpeningKey {
  const master = Buffer.from(encryptionMaster, 'hex');
  const child = createHmac('sha256', master)
    .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:telebirr', 'utf8')
    .digest();
  master.fill(0);
  const key = {
    contractVersion: TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
    providerCode: TELEBIRR_REFERENCE_OPENING_PROVIDER,
    purpose: TELEBIRR_REFERENCE_OPENING_PURPOSE,
    keyVersion: TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
    keyId: spkiDigest(child),
    keyHex: child.toString('hex'),
  } as const;
  child.fill(0);
  return key;
}

function sqlRow() {
  const protectedReference = protectDepositProofReference(
    {
      provider: 'telebirr',
      reference: 'FTAN12345678',
      secrets: {
        encryptionSecret: encryptionMaster,
        fingerprintSecret: fingerprintMaster,
      },
    },
    { nonce: () => Buffer.from('000102030405060708090a0b', 'hex') },
  );
  return {
    challenge_id: ids.challenge,
    challenge_digest: `sha256:${'d'.repeat(64)}`,
    issued_at: new Date(issuedAt),
    expires_at: new Date(expiresAt),
    candidate_id: ids.candidate,
    candidate_submitted_at: new Date('2026-10-06T13:00:00.000Z'),
    candidate_reference_ciphertext: protectedReference.ciphertext,
    candidate_reference_fingerprint: protectedReference.fingerprint,
    reference_encryption_key_version: 2,
    reference_profile_version: 2,
    receiver_revision_id: ids.receiver,
    receiver_version: 3,
    receiver_reference_fingerprint: receiverReferenceFingerprint,
    receiver_profile_digest: digestRoutineTelebirrReceiverProfile({
      receiverRevisionId: ids.receiver,
      receiverVersion: 3,
      receiverReferenceFingerprint,
      receiverName,
    })!,
    receiver_name: receiverName,
    expected_receiver_name_digest: digestRoutineTelebirrReceiverName(receiverName)!,
    device_enrollment_id: ids.enrollment,
    device_id: 'routine_device_0001',
    device_key_id: 'routine_device_key_0001',
    device_public_key_spki_sha256: spkiDigest(deviceSpki),
    device_valid_from: new Date('2026-10-06T12:00:00.000Z'),
    device_valid_until: new Date('2026-10-07T12:00:00.000Z'),
    assignment_signer_id: ids.signer,
    assignment_signer_key_id: 'routine_signer_key_0001',
    assignment_signer_public_key_spki_sha256: spkiDigest(signerSpki),
    signer_valid_from: new Date('2026-10-06T12:00:00.000Z'),
    signer_valid_until: new Date('2026-10-07T12:00:00.000Z'),
    source_profile: 'telebirr_official_receipt_v1',
  };
}

function signer() {
  return {
    assignmentSignerId: ids.signer,
    keyId: 'routine_signer_key_0001',
    publicKeySpkiDer: signerSpki,
    signP1363: vi.fn(async (transcript: Uint8Array) =>
      sign('sha256', transcript, {
        key: signerPair.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url'),
    ),
  };
}

describe('dormant routine TeleBirr lookup assignment builder', () => {
  it('opens the protected reference and signs exactly the reserved receiver/device challenge', async () => {
    const row = sqlRow();
    const material = decodeRoutineTelebirrAssignmentMaterialRow(row);
    expect(material).toBeDefined();
    const key = signer();
    const assignment = await buildRoutineTelebirrSignedLookupAssignment(
      material,
      openingKey(),
      key,
      () => assessedAt,
    );
    expect(key.signP1363).toHaveBeenCalledTimes(1);
    expect(assignment.body.rawReference).toBe('FTAN12345678');
    expect(assignment.body.challengeId).toBe(ids.challenge);
    expect(assignment.body.receiverProfileDigest).toBe(row.receiver_profile_digest);
    expect(assignment.body.expectedReceiverNameNormalized).toBe('routine receiver');
    expect(assignment.protocolMode).toBe(ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE);
    const header = {
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
    };
    expect(
      verifyRoutineTelebirrSignedLookupAssignment(
        {
          assessedAt,
          trustedSigner: {
            ...header,
            signerKeyId: key.keyId,
            publicKeySpkiSha256: spkiDigest(signerSpki),
            state: 'active',
            validFrom: '2026-10-06T12:00:00.000Z',
            validUntil: '2026-10-07T12:00:00.000Z',
          },
          deviceEnrollment: {
            ...header,
            deviceId: row.device_id,
            keyId: row.device_key_id,
            publicKeySpkiSha256: spkiDigest(deviceSpki),
            state: 'active',
            validFrom: '2026-10-06T12:00:00.000Z',
            validUntil: '2026-10-07T12:00:00.000Z',
            receiverRevisionId: ids.receiver,
            receiverVersion: 3,
            receiverProfileDigest: row.receiver_profile_digest,
          },
          localDevicePublicKeySpkiDer: deviceSpki,
          signedAssignment: assignment,
        },
        signerSpki,
      ),
    ).toMatchObject({
      disposition: 'would_accept_signed_assignment',
      serverSignatureVerified: true,
      claimAllowed: false,
      financialActionAllowed: false,
    });
  });

  it('rejects changed row shape, receiver, device, signer, and stale leases before signing', async () => {
    const key = signer();
    const base = sqlRow();
    const corruptions = [
      { ...base, unexpected: true },
      { ...base, receiver_name: 'another receiver' },
      { ...base, receiver_profile_digest: `sha256:${'e'.repeat(64)}` },
      { ...base, device_key_id: base.assignment_signer_key_id },
      { ...base, device_public_key_spki_sha256: base.assignment_signer_public_key_spki_sha256 },
      { ...base, assignment_signer_id: ids.candidate },
      { ...base, candidate_reference_ciphertext: base.candidate_reference_ciphertext + 'A' },
      { ...base, expires_at: new Date('2026-10-06T13:09:00.000Z') },
      { ...base, signer_valid_until: new Date('2026-10-06T13:06:00.000Z') },
    ];
    for (const row of corruptions) {
      const material = decodeRoutineTelebirrAssignmentMaterialRow(row);
      if (material === undefined) continue;
      await expect(
        buildRoutineTelebirrSignedLookupAssignment(material, openingKey(), key, () => assessedAt),
      ).rejects.toBeInstanceOf(RoutineTelebirrAssignmentUnavailableError);
    }
    expect(decodeRoutineTelebirrAssignmentMaterialRow(base)).toBeDefined();
    expect(key.signP1363).not.toHaveBeenCalled();
    const material = decodeRoutineTelebirrAssignmentMaterialRow(base)!;
    await expect(
      buildRoutineTelebirrSignedLookupAssignment(material, openingKey(), key, () => expiresAt),
    ).rejects.toBeInstanceOf(RoutineTelebirrAssignmentUnavailableError);
    expect(key.signP1363).not.toHaveBeenCalled();
  });

  it('rejects a wrong opening key, wrong signer, invalid signature, and expiry during signing', async () => {
    const material = decodeRoutineTelebirrAssignmentMaterialRow(sqlRow())!;
    const wrongOpeningKey = { ...openingKey(), keyId: `sha256:${'0'.repeat(64)}` };
    await expect(
      buildRoutineTelebirrSignedLookupAssignment(
        material,
        wrongOpeningKey,
        signer(),
        () => assessedAt,
      ),
    ).rejects.toBeInstanceOf(RoutineTelebirrAssignmentUnavailableError);
    await expect(
      buildRoutineTelebirrSignedLookupAssignment(
        material,
        openingKey(),
        { ...signer(), keyId: 'other_signer_key_0001' },
        () => assessedAt,
      ),
    ).rejects.toBeInstanceOf(RoutineTelebirrAssignmentUnavailableError);
    await expect(
      buildRoutineTelebirrSignedLookupAssignment(
        material,
        openingKey(),
        { ...signer(), signP1363: vi.fn(async () => 'A'.repeat(86)) },
        () => assessedAt,
      ),
    ).rejects.toBeInstanceOf(RoutineTelebirrAssignmentUnavailableError);
    let calls = 0;
    await expect(
      buildRoutineTelebirrSignedLookupAssignment(material, openingKey(), signer(), () => {
        calls += 1;
        return calls === 1 ? assessedAt : expiresAt;
      }),
    ).rejects.toBeInstanceOf(RoutineTelebirrAssignmentUnavailableError);
  });

  it('rejects accessor and proxy row data without invoking a getter', () => {
    const row = sqlRow();
    const getter = vi.fn(() => row.receiver_name);
    Object.defineProperty(row, 'receiver_name', { enumerable: true, get: getter });
    expect(decodeRoutineTelebirrAssignmentMaterialRow(row)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(decodeRoutineTelebirrAssignmentMaterialRow(new Proxy(sqlRow(), {}))).toBeUndefined();
  });
});
