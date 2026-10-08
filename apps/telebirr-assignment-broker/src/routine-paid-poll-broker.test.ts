import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto';

import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';
import {
  TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  TELEBIRR_REFERENCE_OPENING_PROVIDER,
  TELEBIRR_REFERENCE_OPENING_PURPOSE,
} from '@fetanagent/telebirr-reference-opening';
import {
  assessRoutineTelebirrNoMoneyAssignment,
  digestRoutineTelebirrReceiverName,
  digestRoutineTelebirrReceiverProfile,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  RoutinePaidPollBrokerUnavailableError,
  createRoutinePaidPollBroker,
  type RoutinePaidPollBrokerDatabase,
} from './routine-paid-poll-broker.js';

const ids = {
  enrollment: '44444444-4444-4444-8444-444444444444',
  candidate: '11111111-1111-4111-8111-111111111111',
  challenge: '22222222-2222-4222-8222-222222222222',
  receiver: '33333333-3333-4333-8333-333333333333',
  signer: '55555555-5555-4555-8555-555555555555',
  request: '66666666-6666-4666-8666-666666666666',
} as const;
const now = '2026-10-06T13:03:00.000Z';
const master = 'a'.repeat(64);
const fingerprintMaster = 'b'.repeat(64);
const receiverName = 'Routine Receiver';
const receiverReferenceFingerprint = 'c'.repeat(64);
const sha = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function fixture() {
  const devicePair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceDer = Buffer.from(devicePair.publicKey.export({ type: 'spki', format: 'der' }));
  const signerDer = Buffer.from(signerPair.publicKey.export({ type: 'spki', format: 'der' }));
  const protectedReference = protectDepositProofReference(
    {
      provider: 'telebirr',
      reference: 'FTAN12345678',
      secrets: { encryptionSecret: master, fingerprintSecret: fingerprintMaster },
    },
    { nonce: () => Buffer.from('000102030405060708090a0b', 'hex') },
  );
  const child = createHmac('sha256', Buffer.from(master, 'hex'))
    .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:telebirr', 'utf8')
    .digest();
  const openingKey = {
    contractVersion: TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
    providerCode: TELEBIRR_REFERENCE_OPENING_PROVIDER,
    purpose: TELEBIRR_REFERENCE_OPENING_PURPOSE,
    keyVersion: TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
    keyId: sha(child),
    keyHex: child.toString('hex'),
  } as const;
  child.fill(0);
  const row = {
    challenge_id: ids.challenge,
    challenge_digest: `sha256:${'d'.repeat(64)}`,
    issued_at: new Date('2026-10-06T13:02:00.000Z'),
    expires_at: new Date('2026-10-06T13:07:00.000Z'),
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
    device_public_key_spki_sha256: sha(deviceDer),
    device_valid_from: new Date('2026-10-06T12:00:00.000Z'),
    device_valid_until: new Date('2026-10-07T12:00:00.000Z'),
    assignment_signer_id: ids.signer,
    assignment_signer_key_id: 'routine_signer_key_0001',
    assignment_signer_public_key_spki_sha256: sha(signerDer),
    signer_valid_from: new Date('2026-10-06T12:00:00.000Z'),
    signer_valid_until: new Date('2026-10-07T12:00:00.000Z'),
    source_profile: 'telebirr_official_receipt_v1',
  };
  const enrollmentRow = {
    enrollment_id: ids.enrollment,
    device_id: row.device_id,
    device_key_id: row.device_key_id,
    device_public_key_spki_sha256: row.device_public_key_spki_sha256,
    valid_from: row.device_valid_from,
    valid_until: row.device_valid_until,
    receiver_revision_id: ids.receiver,
    receiver_profile_digest: row.receiver_profile_digest,
  };
  const database: RoutinePaidPollBrokerDatabase = {
    loadEnrollment: vi.fn(async () => enrollmentRow),
    issuePollAssignment: vi.fn(async () => row),
    loadObservationMaterial: vi.fn(async () => row),
    stageObservation: vi.fn(async () => 'recorded'),
  };
  const signer = {
    assignmentSignerId: ids.signer,
    keyId: row.assignment_signer_key_id,
    publicKeySpkiDer: signerDer,
    signP1363: vi.fn(async (transcript: Uint8Array) =>
      sign('sha256', transcript, {
        key: signerPair.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url'),
    ),
  };
  const broker = createRoutinePaidPollBroker({ database, openingKey, signer, now: () => now });
  return { broker, database, signer, row, enrollmentRow, deviceDer, signerDer, openingKey };
}

const pollInput = {
  enrollmentId: ids.enrollment,
  requestId: ids.request,
  replayIdentity: `sha256:${'e'.repeat(64)}`,
  requestExpiresAt: '2026-10-06T13:03:30.000Z',
};

describe('private routine paid poll broker core', () => {
  it('opens only the paid observation material and stages no financial action', async () => {
    const f = fixture();
    const context = await f.broker.loadObservation(ids.challenge);
    expect(context?.trustedIssuanceMode).toBe('paid');
    expect(context?.trustedRawReference).toBe('FTAN12345678');
    expect(f.database.loadObservationMaterial).toHaveBeenCalledWith(ids.challenge);
    const staged = await f.broker.stageObservation({
      evidence: {
        providerCode: 'telebirr',
        candidateId: ids.candidate,
        challengeId: ids.challenge,
        referenceFingerprint: f.row.candidate_reference_fingerprint,
        receiverRevisionId: ids.receiver,
        receiverVersion: 3,
        submittedAt: '2026-10-06T13:00:00.000Z',
        observedAt: now,
        occurredAt: now,
        retrievedAt: now,
        amountMinor: 2500,
        currencyCode: 'ETB',
        sourceDocumentDigest: sha(Buffer.from('document')),
        observationBodyDigest: sha(Buffer.from('observation')),
        replayIdentity: sha(Buffer.from('replay')),
      },
      assignmentBodyDigest: sha(Buffer.from('assignment')),
      observationSignatureDigest: sha(Buffer.from('signature')),
      signedObservation: {},
    });
    expect(staged).toBe('recorded');
    expect(f.database.stageObservation).toHaveBeenCalledOnce();
  });
  it('maps the active SQL enrollment and signs only the atomically reserved snapshot', async () => {
    const f = fixture();
    const loaded = await f.broker.loadEnrollment(ids.enrollment);
    expect(loaded?.enrollment).toMatchObject({
      enrollmentId: ids.enrollment,
      publicKeySpkiSha256: f.row.device_public_key_spki_sha256,
      state: 'active',
    });
    const result = await f.broker.claimAndIssuePoll(pollInput);
    expect(f.database.issuePollAssignment).toHaveBeenCalledWith({
      ...pollInput,
      signerId: ids.signer,
    });
    expect(result.kind).toBe('assignment');
    if (result.kind !== 'assignment') throw new Error();
    expect(result.context.signedAssignment.body.rawReference).toBe('FTAN12345678');
    expect(
      assessRoutineTelebirrNoMoneyAssignment(
        {
          assessedAt: now,
          trustedLookup: result.context.trustedLookup,
          trustedRawReference: result.context.trustedRawReference,
          trustedSigner: result.context.trustedSigner,
          deviceEnrollment: result.context.deviceEnrollment,
          signedAssignment: result.context.signedAssignment,
        },
        result.context.trustedSignerSpkiDer,
        f.deviceDer,
      ),
    ).toMatchObject({
      disposition: 'would_forward_signed_lookup',
      financialActionAllowed: false,
    });
    expect(f.signer.signP1363).toHaveBeenCalledOnce();
  });

  it('returns no assignment for an empty atomic issuer and never signs', async () => {
    const f = fixture();
    f.database.issuePollAssignment = vi.fn(async () => undefined);
    const broker = createRoutinePaidPollBroker({
      database: f.database,
      openingKey: f.openingKey,
      signer: f.signer,
      now: () => now,
    });
    expect(await broker.claimAndIssuePoll(pollInput)).toEqual({ kind: 'none' });
    expect(f.signer.signP1363).not.toHaveBeenCalled();
  });

  it('fails closed on a mismatched issuer row, signer, enrollment, or extra SQL column', async () => {
    const f = fixture();
    for (const row of [
      { ...f.row, device_enrollment_id: ids.candidate },
      { ...f.row, assignment_signer_id: ids.candidate },
      { ...f.row, unexpected: true },
    ]) {
      const broker = createRoutinePaidPollBroker({
        database: { ...f.database, issuePollAssignment: async () => row },
        openingKey: f.openingKey,
        signer: f.signer,
        now: () => now,
      });
      await expect(broker.claimAndIssuePoll(pollInput)).rejects.toBeInstanceOf(
        RoutinePaidPollBrokerUnavailableError,
      );
    }
    const broker = createRoutinePaidPollBroker({
      database: {
        ...f.database,
        loadEnrollment: async () => ({ ...f.enrollmentRow, unexpected: true }),
      },
      openingKey: f.openingKey,
      signer: f.signer,
      now: () => now,
    });
    await expect(broker.loadEnrollment(ids.enrollment)).rejects.toBeInstanceOf(
      RoutinePaidPollBrokerUnavailableError,
    );
    expect(f.signer.signP1363).not.toHaveBeenCalled();
  });
});
