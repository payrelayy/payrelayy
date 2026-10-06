import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import {
  canonicalRoutineTelebirrDevicePairingSignatureBytes,
  digestRoutineTelebirrDevicePairingBody,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it } from 'vitest';

import {
  OwnerRoutineTelebirrPairingNotReadyError,
  OwnerRoutineTelebirrPairingRejectedError,
  OwnerRoutineTelebirrPairingUnavailableError,
  PostgresOwnerRoutineTelebirrPairing,
} from './owner-routine-telebirr-pairing.js';

const actor = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const row = {
  pairing_id: '33333333-3333-4333-8333-333333333333',
  pairing_nonce_digest: `sha256:${'a'.repeat(64)}`,
  receiver_revision_id: '44444444-4444-4444-8444-444444444444',
  receiver_version: 3,
  receiver_profile_digest: `sha256:${'b'.repeat(64)}`,
  expected_receiver_name_digest: `sha256:${'c'.repeat(64)}`,
  issued_at: new Date('2026-10-06T12:00:00.000Z'),
  expires_at: new Date('2026-10-06T12:10:00.000Z'),
  replayed: false,
};

function signedProof() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  const body = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'routine_device_pairing_v1',
    pairingId: row.pairing_id,
    pairingNonceDigest: row.pairing_nonce_digest,
    receiverRevisionId: row.receiver_revision_id,
    receiverVersion: row.receiver_version,
    receiverProfileDigest: row.receiver_profile_digest,
    expectedReceiverNameDigest: row.expected_receiver_name_digest,
    deviceId: 'routine-device-0001',
    keyId: 'routine-device-key-0001',
    devicePublicKeySpki: spki.toString('base64url'),
    devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
    issuedAt: '2026-10-06T12:01:00.000Z',
    expiresAt: '2026-10-06T12:06:00.000Z',
  };
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'routine_device_pairing_v1',
    transcriptVersion: 'telebirr-routine-device-pairing-transcript-v1',
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestRoutineTelebirrDevicePairingBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body,
    signature: sign('sha256', canonicalRoutineTelebirrDevicePairingSignatureBytes(body)!, {
      key: pair.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
}

describe('Owner routine TeleBirr pairing challenge adapter', () => {
  it('returns a routine-only no-money package with the exact Android challenge fields', async () => {
    const calls: Array<{ sql: string; values: readonly string[] }> = [];
    const adapter = new PostgresOwnerRoutineTelebirrPairing({
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [row] };
      },
    });
    const receipt = await adapter.issue(actor, requestId);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('app.issue_owner_routine_telebirr_device_pairing_challenge');
    expect(calls[0]!.values).toEqual([actor, requestId]);
    expect(receipt).toMatchObject({
      alreadyIssued: false,
      assignmentPollingAllowed: false,
      enrollmentAllowed: false,
      expiresAt: row.expires_at.toISOString(),
      moneyMovementAllowed: false,
      pairingOnly: true,
    });
    expect(receipt.challengePackage.startsWith('fetanagent-routine-pairing-v1.')).toBe(true);
    expect(
      JSON.parse(
        Buffer.from(receipt.challengePackage.split('.')[1]!, 'base64url').toString('utf8'),
      ),
    ).toEqual({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'routine_device_pairing_v1',
      pairingId: row.pairing_id,
      pairingNonceDigest: row.pairing_nonce_digest,
      receiverRevisionId: row.receiver_revision_id,
      receiverVersion: row.receiver_version,
      receiverProfileDigest: row.receiver_profile_digest,
      expectedReceiverNameDigest: row.expected_receiver_name_digest,
      issuedAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    });
    expect(receipt.challengePackage).not.toContain('pilot');
  });

  it('returns the identical package for an exact database replay', async () => {
    const adapter = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => ({ rows: [{ ...row, replayed: true }] }),
    });
    expect(await adapter.issue(actor, requestId)).toMatchObject({ alreadyIssued: true });
  });

  it('rejects malformed inputs, malformed database rows, and denied or unavailable authority', async () => {
    const adapter = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => ({ rows: [row] }),
    });
    await expect(adapter.issue(actor, 'bad')).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingRejectedError,
    );
    const malformed = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => ({ rows: [{ ...row, receiver_version: 0 }] }),
    });
    await expect(malformed.issue(actor, requestId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingUnavailableError,
    );
    const denied = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => {
        throw Object.assign(new Error('redacted'), { code: '42501' });
      },
    });
    await expect(denied.issue(actor, requestId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingRejectedError,
    );
    const notReady = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => {
        throw Object.assign(new Error('redacted'), { code: 'P0001' });
      },
    });
    await expect(notReady.issue(actor, requestId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingNotReadyError,
    );
  });
});

describe('Owner routine TeleBirr proof enrollment adapter', () => {
  it('verifies the signed phone proof before the only enrollment write and returns no-money receipt', async () => {
    const proof = signedProof();
    const calls: Array<{ sql: string; values: readonly string[] }> = [];
    const adapter = new PostgresOwnerRoutineTelebirrPairing(
      {
        query: async (sql, values) => {
          calls.push({ sql, values });
          return {
            rows: sql.includes('get_owner_routine_telebirr_device_pairing_challenge')
              ? [row]
              : [
                  {
                    enrollment_id: '55555555-5555-4555-8555-555555555555',
                    valid_from: new Date('2026-10-06T12:02:00.000Z'),
                    valid_until: new Date('2026-11-05T12:02:00.000Z'),
                    replayed: false,
                  },
                ],
          };
        },
      },
      () => new Date('2026-10-06T12:02:00.000Z'),
    );
    expect(await adapter.enroll(actor, proof)).toEqual({
      alreadyEnrolled: false,
      assignmentPollingAllowed: false,
      enrollmentId: '55555555-5555-4555-8555-555555555555',
      moneyMovementAllowed: false,
      pairingOnly: true,
      validUntil: '2026-11-05T12:02:00.000Z',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.values).toEqual([actor, row.pairing_id]);
    expect(calls[1]!.sql).toContain('app.enroll_owner_routine_telebirr_device_pairing_proof');
    expect(calls[1]!.values).toEqual([
      actor,
      row.pairing_id,
      row.pairing_nonce_digest,
      row.receiver_revision_id,
      '3',
      row.receiver_profile_digest,
      row.expected_receiver_name_digest,
      proof.bodyDigest,
      proof.body.deviceId,
      proof.body.keyId,
      proof.body.devicePublicKeySpkiSha256,
      proof.body.issuedAt,
      proof.body.expiresAt,
    ]);
  });

  it('does not write for tampering, a stale challenge, or a substituted receiver', async () => {
    const proof = signedProof();
    for (const candidate of [
      { ...proof, signature: 'A'.repeat(86) },
      { ...proof, body: { ...proof.body, deviceId: 'routine-device-9999' } },
      { ...proof, protocolMode: 'device_bridge_no_money_v1' },
    ]) {
      const calls: string[] = [];
      const adapter = new PostgresOwnerRoutineTelebirrPairing(
        {
          query: async (sql) => {
            calls.push(sql);
            return { rows: [row] };
          },
        },
        () => new Date('2026-10-06T12:02:00.000Z'),
      );
      await expect(adapter.enroll(actor, candidate)).rejects.toBeInstanceOf(
        OwnerRoutineTelebirrPairingRejectedError,
      );
      expect(calls).toHaveLength(1);
    }
    for (const trusted of [
      { ...row, pairing_nonce_digest: `sha256:${'d'.repeat(64)}` },
      { ...row, receiver_revision_id: '66666666-6666-4666-8666-666666666666' },
    ]) {
      let calls = 0;
      const adapter = new PostgresOwnerRoutineTelebirrPairing(
        {
          query: async () => {
            calls += 1;
            return { rows: [trusted] };
          },
        },
        () => new Date('2026-10-06T12:02:00.000Z'),
      );
      await expect(adapter.enroll(actor, proof)).rejects.toBeInstanceOf(
        OwnerRoutineTelebirrPairingRejectedError,
      );
      expect(calls).toBe(1);
    }
    const stale = new PostgresOwnerRoutineTelebirrPairing(
      { query: async () => ({ rows: [row] }) },
      () => new Date('2026-10-06T12:11:00.000Z'),
    );
    await expect(stale.enroll(actor, proof)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingRejectedError,
    );
  });

  it('rejects an absent trusted challenge before any enrollment call', async () => {
    let calls = 0;
    const adapter = new PostgresOwnerRoutineTelebirrPairing({
      query: async () => {
        calls += 1;
        return { rows: [] };
      },
    });
    await expect(adapter.enroll(actor, signedProof())).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrPairingNotReadyError,
    );
    expect(calls).toBe(1);
  });
});
