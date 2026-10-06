import { createHash, generateKeyPairSync } from 'node:crypto';

import {
  decodeSignedRoutineTelebirrEnrollmentReceipt,
  verifySignedRoutineTelebirrEnrollmentReceipt,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  OwnerRoutineTelebirrReceiptNotReadyError,
  OwnerRoutineTelebirrReceiptRejectedError,
  OwnerRoutineTelebirrReceiptUnavailableError,
  PostgresOwnerRoutineTelebirrReceipt,
} from './owner-routine-telebirr-receipt.js';

const signerKeyId = 'telebirr-routine-enrollment-staging-v1';
const ownerId = '2e364c83-0f07-4dc8-9378-f25bfeb0996d';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
const spki = publicKey.export({ format: 'der', type: 'spki' });
const spkiDigest = `sha256:${createHash('sha256').update(spki).digest('hex')}`;
const row = {
  enrollment_id: '225181c2-0747-4bb5-94e4-18fafcf67ed3',
  pairing_evidence_digest: `sha256:${'a'.repeat(64)}`,
  device_id: 'routine-device-01',
  device_key_id: 'routine-key-01',
  device_public_key_spki_sha256: `sha256:${'b'.repeat(64)}`,
  receiver_revision_id: '5bd9d46b-845a-423d-9fe3-37d059063a22',
  receiver_version: 2,
  receiver_profile_digest: `sha256:${'c'.repeat(64)}`,
  expected_receiver_name_digest: `sha256:${'d'.repeat(64)}`,
  valid_from: new Date('2026-10-01T00:00:00.000Z'),
  valid_until: new Date('2026-10-28T00:00:00.000Z'),
  issued_at: new Date('2026-10-06T19:00:00.000Z'),
  signer_valid_from: new Date('2026-10-05T00:00:00.000Z'),
  signer_valid_until: new Date('2026-11-01T00:00:00.000Z'),
};

describe('Owner routine enrollment receipt signer', () => {
  it('signs exactly the Owner-linked no-money enrollment material, with an independent pinned key', async () => {
    const query = vi.fn(async (_sql: string, _values: readonly string[]) => ({ rows: [row] }));
    const service = new PostgresOwnerRoutineTelebirrReceipt({ query }, signerKeyId, pkcs8);
    const output = await service.issue(ownerId);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('app.get_owner_routine_telebirr_enrollment_receipt_material'),
      [ownerId, signerKeyId, spkiDigest],
    );
    expect(output).toMatchObject({
      assignmentPollingAllowed: false,
      financialActionAllowed: false,
      moneyMovementAllowed: false,
      validUntil: row.valid_until.toISOString(),
    });
    const wire = Buffer.from(
      output.receiptPackage.slice('fetanagent-routine-enrollment-receipt-v1.'.length),
      'base64url',
    );
    const receipt = decodeSignedRoutineTelebirrEnrollmentReceipt(JSON.parse(wire.toString('utf8')));
    expect(receipt).toBeDefined();
    expect(receipt?.body).toMatchObject({
      enrollmentId: row.enrollment_id,
      pairingEvidenceDigest: row.pairing_evidence_digest,
      deviceId: row.device_id,
      keyId: row.device_key_id,
      receiverRevisionId: row.receiver_revision_id,
      receiverVersion: row.receiver_version,
      assignmentPollingAllowed: false,
      financialActionAllowed: false,
      moneyMovementAllowed: false,
    });
    const binding = {
      pairingEvidenceDigest: row.pairing_evidence_digest,
      deviceId: row.device_id,
      keyId: row.device_key_id,
      devicePublicKeySpkiSha256: row.device_public_key_spki_sha256,
      receiverRevisionId: row.receiver_revision_id,
      receiverVersion: row.receiver_version,
      receiverProfileDigest: row.receiver_profile_digest,
      expectedReceiverNameDigest: row.expected_receiver_name_digest,
    };
    expect(
      verifySignedRoutineTelebirrEnrollmentReceipt(
        receipt,
        {
          signerKeyId,
          publicKeySpki: spki.toString('base64url'),
          publicKeySpkiSha256: spkiDigest,
          validFrom: row.signer_valid_from.toISOString(),
          validUntil: row.signer_valid_until.toISOString(),
          state: 'active',
        },
        binding,
        row.issued_at.toISOString(),
      ),
    ).toBe(true);
    expect(
      verifySignedRoutineTelebirrEnrollmentReceipt(
        receipt,
        {
          signerKeyId,
          publicKeySpki: spki.toString('base64url'),
          publicKeySpkiSha256: spkiDigest,
          validFrom: row.signer_valid_from.toISOString(),
          validUntil: row.signer_valid_until.toISOString(),
          state: 'active',
        },
        { ...binding, receiverVersion: 3 },
        row.issued_at.toISOString(),
      ),
    ).toBe(false);
  });

  it('rejects invalid Owner subjects, missing material, malformed keys, and unsafe timestamps', async () => {
    const service = new PostgresOwnerRoutineTelebirrReceipt(
      { query: async () => ({ rows: [row] }) },
      signerKeyId,
      pkcs8,
    );
    await expect(service.issue('not-owner')).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrReceiptRejectedError,
    );
    await expect(
      new PostgresOwnerRoutineTelebirrReceipt(
        { query: async () => ({ rows: [] }) },
        signerKeyId,
        pkcs8,
      ).issue(ownerId),
    ).rejects.toBeInstanceOf(OwnerRoutineTelebirrReceiptNotReadyError);
    await expect(
      new PostgresOwnerRoutineTelebirrReceipt(
        { query: async () => ({ rows: [{ ...row, valid_until: new Date('2026-10-05') }] }) },
        signerKeyId,
        pkcs8,
      ).issue(ownerId),
    ).rejects.toBeInstanceOf(OwnerRoutineTelebirrReceiptUnavailableError);
    expect(
      () =>
        new PostgresOwnerRoutineTelebirrReceipt(
          { query: async () => ({ rows: [row] }) },
          signerKeyId,
          'not-a-key',
        ),
    ).toThrow(OwnerRoutineTelebirrReceiptUnavailableError);
  });
});
