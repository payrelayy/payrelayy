import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';
import {
  TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  TELEBIRR_REFERENCE_OPENING_PROVIDER,
  TELEBIRR_REFERENCE_OPENING_PURPOSE,
  type TelebirrScopedReferenceOpeningKey,
} from '@fetanagent/telebirr-reference-opening';
import {
  TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  digestTelebirrLivePilotReceiverName,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  TelebirrAssignmentBrokerError,
  createTelebirrAssignmentBroker,
  telebirrAssignmentBrokerLogProjection,
  type TelebirrAssignmentBrokerDatabase,
  type TelebirrAssignmentLease,
  type TelebirrAssignmentReceiverManifest,
} from './telebirr-assignment-broker.js';

const ids = {
  signer: '11111111-1111-4111-8111-111111111111',
  enrollment: '22222222-2222-4222-8222-222222222222',
  pilot: '33333333-3333-4333-8333-333333333333',
  receiver: '44444444-4444-4444-8444-444444444444',
  profile: '55555555-5555-4555-8555-555555555555',
  attempt: '66666666-6666-4666-8666-666666666666',
  lease: '77777777-7777-4777-8777-777777777777',
  job: '88888888-8888-4888-8888-888888888888',
  request: '99999999-9999-4999-8999-999999999999',
  assignment: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  challenge: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
} as const;
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const receiverName = 'synthetic pilot receiver';
const encryptionMaster = 'a'.repeat(64);
const fingerprintMaster = 'b'.repeat(64);
const devicePair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const deviceSpki = Buffer.from(devicePair.publicKey.export({ type: 'spki', format: 'der' }));
const deviceSpkiDigest = `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`;

function keyPair() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
  return { ...pair, spki, digest: `sha256:${createHash('sha256').update(spki).digest('hex')}` };
}

function openingKey(): TelebirrScopedReferenceOpeningKey {
  const master = Buffer.from(encryptionMaster, 'hex');
  const child = createHmac('sha256', master)
    .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:telebirr', 'utf8')
    .digest();
  master.fill(0);
  const result = {
    contractVersion: TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
    providerCode: TELEBIRR_REFERENCE_OPENING_PROVIDER,
    purpose: TELEBIRR_REFERENCE_OPENING_PURPOSE,
    keyVersion: TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
    keyId: `sha256:${createHash('sha256').update(child).digest('hex')}`,
    keyHex: child.toString('hex'),
  } as const;
  child.fill(0);
  return result;
}

function manifest(): TelebirrAssignmentReceiverManifest {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    pilotRevisionId: ids.pilot,
    receiverRevisionId: ids.receiver,
    receiverProfileId: ids.profile,
    receiverProfileDigest: sha('1'),
    receiverConfigurationDigest: sha('2'),
    receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized: receiverName,
    expectedReceiverNameDigest: digestTelebirrLivePilotReceiverName(receiverName)!,
  };
}

function certificate(signerDigest: string): TelebirrDeviceBridgeEnrollmentCertificateBody {
  return {
    contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
    providerCode: 'telebirr',
    protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
    enrollmentId: ids.enrollment,
    pairingId: 'pairing_12345678',
    pairingRequestBodyDigest: sha('3'),
    pairingNonceDigest: sha('4'),
    pairingConsumed: true,
    deviceId: 'android_device_0001',
    keyId: 'android_key_0001',
    devicePublicKeySpki: deviceSpki.toString('base64url'),
    devicePublicKeySpkiSha256: deviceSpkiDigest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    devicePlatform: 'android',
    minimumAppVersion: '0.3.0-device-bridge-inert',
    pilotRevisionId: ids.pilot,
    receiverRevisionId: ids.receiver,
    receiverProfileId: ids.profile,
    receiverProfileDigest: sha('1'),
    receiverConfigurationDigest: sha('2'),
    assignmentSignerKeyId: 'assignment_signer_0001',
    assignmentSignerPublicKeySpkiSha256: signerDigest,
    state: 'active',
    issuedAt: '2026-09-04T00:00:00.000Z',
    validFrom: '2026-09-04T00:00:00.000Z',
    validUntil: '2026-09-05T00:00:00.000Z',
    evidenceOnly: true,
    databaseAccessAllowed: false,
    claimAllowed: false,
    settlementAllowed: false,
    enqueueAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    moneyMovementAllowed: false,
    rawReceiptUploadAllowed: false,
    sensitiveLoggingAllowed: false,
  };
}

function lease(): TelebirrAssignmentLease {
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
    verificationAttemptId: ids.attempt,
    leaseToken: ids.lease,
    jobId: ids.job,
    attemptNumber: 1,
    requestId: ids.request,
    assignmentId: ids.assignment,
    leaseNonceDigest: sha('6'),
    challengeId: ids.challenge,
    challengeDigest: sha('7'),
    issuedAt: '2026-09-04T00:01:00.000Z',
    expiresAt: '2026-09-04T00:04:00.000Z',
    pilotRevisionId: ids.pilot,
    deviceEnrollmentId: ids.enrollment,
    deviceId: 'android_device_0001',
    deviceKeyId: 'android_key_0001',
    devicePublicKeySpkiSha256: deviceSpkiDigest,
    receiverRevisionId: ids.receiver,
    receiverProfileId: ids.profile,
    receiverProfileDigest: sha('1'),
    receiverConfigurationDigest: sha('2'),
    expectedReceiverNameDigest: digestTelebirrLivePilotReceiverName(receiverName)!,
    receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    factsNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
    candidateReferenceCiphertext: protectedReference.ciphertext,
    candidateReferenceFingerprint: protectedReference.fingerprint,
    referenceEncryptionKeyVersion: 2,
    referenceProfileVersion: 2,
    replayed: false,
  };
}

function signer(privateKey: KeyObject, spki: Buffer) {
  return {
    assignmentSignerId: ids.signer,
    keyId: 'assignment_signer_0001',
    publicKeySpkiDer: spki,
    signP1363: vi.fn(async (transcript: Uint8Array) =>
      sign('sha256', transcript, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
        'base64url',
      ),
    ),
  };
}

function database(
  value: TelebirrAssignmentLease | null = lease(),
): TelebirrAssignmentBrokerDatabase {
  let persisted: string | undefined;
  return {
    leaseAssignment: vi.fn(async () => value),
    persistAssignmentSignature: vi.fn(async (request) => {
      const replayed = persisted !== undefined;
      const assignmentSignature = persisted ?? request.proposedAssignmentSignature;
      persisted = assignmentSignature;
      const bytes = Buffer.from(assignmentSignature, 'base64url');
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      bytes.fill(0);
      return {
        assignmentSignature,
        assignmentSignatureDigest: digest,
        replayed,
      };
    }),
  };
}

describe('private TeleBirr assignment broker', () => {
  it('opens, binds, signs, self-verifies, and persists one short-lived assignment', async () => {
    const pair = keyPair();
    const db = database();
    const signing = signer(pair.privateKey, pair.spki);
    const poll = createTelebirrAssignmentBroker({
      database: db,
      openingKey: openingKey(),
      receiverManifest: manifest(),
      signer: signing,
    });

    const result = await poll({
      certificate: certificate(pair.digest),
      bridgeRequestBodyDigest: sha('8'),
      requestedLeaseSeconds: 180,
    });

    expect(result.kind).toBe('assignment');
    if (result.kind !== 'assignment') throw new Error('expected assignment');
    expect(result.assignment.body.rawReference).toBe('FTAN12345678');
    expect(result.assignment.body.expectedReceiverNameNormalized).toBe(receiverName);
    expect(result.assignment.body.deviceId).toBe('android_device_0001');
    expect(signing.signP1363).toHaveBeenCalledOnce();
    expect(db.persistAssignmentSignature).toHaveBeenCalledOnce();
    expect(telebirrAssignmentBrokerLogProjection(result)).toEqual({
      outcome: 'assignment',
      assignmentIssued: true,
    });
    expect(JSON.stringify(telebirrAssignmentBrokerLogProjection(result))).not.toContain(
      'FTAN12345678',
    );
  });

  it('derives a stable v4 lease request key from the authenticated bridge request', async () => {
    const pair = keyPair();
    const db = database(null);
    const poll = createTelebirrAssignmentBroker({
      database: db,
      openingKey: openingKey(),
      receiverManifest: manifest(),
      signer: signer(pair.privateKey, pair.spki),
    });
    const input = {
      certificate: certificate(pair.digest),
      bridgeRequestBodyDigest: sha('9'),
      requestedLeaseSeconds: 60,
    } as const;
    await poll(input);
    await poll(input);
    const mock = vi.mocked(db.leaseAssignment);
    expect(mock.mock.calls[0]?.[0].leaseRequestKey).toBe(mock.mock.calls[1]?.[0].leaseRequestKey);
    expect(mock.mock.calls[0]?.[0].leaseRequestKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('returns no assignment without calling the signer or persistence boundary', async () => {
    const pair = keyPair();
    const db = database(null);
    const signing = signer(pair.privateKey, pair.spki);
    const poll = createTelebirrAssignmentBroker({
      database: db,
      openingKey: openingKey(),
      receiverManifest: manifest(),
      signer: signing,
    });
    const result = await poll({
      certificate: certificate(pair.digest),
      bridgeRequestBodyDigest: sha('a'),
      requestedLeaseSeconds: 60,
    });
    expect(result).toEqual({ kind: 'no_assignment' });
    expect(signing.signP1363).not.toHaveBeenCalled();
    expect(db.persistAssignmentSignature).not.toHaveBeenCalled();
  });

  it('returns the previously persisted signature after an exact lost-ack replay', async () => {
    const pair = keyPair();
    const db = database();
    const poll = createTelebirrAssignmentBroker({
      database: db,
      openingKey: openingKey(),
      receiverManifest: manifest(),
      signer: signer(pair.privateKey, pair.spki),
    });
    const input = {
      certificate: certificate(pair.digest),
      bridgeRequestBodyDigest: sha('b'),
      requestedLeaseSeconds: 180,
    } as const;
    const first = await poll(input);
    const second = await poll(input);
    expect(first.kind).toBe('assignment');
    expect(second.kind).toBe('assignment');
    if (first.kind === 'assignment' && second.kind === 'assignment') {
      expect(second.assignment).toEqual(first.assignment);
    }
  });

  it.each([
    [
      'receiver configuration',
      (value: TelebirrAssignmentLease) => ({ ...value, receiverConfigurationDigest: sha('f') }),
    ],
    [
      'device identity',
      (value: TelebirrAssignmentLease) => ({ ...value, deviceId: 'wrong_device_0001' }),
    ],
    [
      'reference profile',
      (value: TelebirrAssignmentLease) => ({ ...value, referenceProfileVersion: 1 }),
    ],
    [
      'source profile',
      (value: TelebirrAssignmentLease) => ({ ...value, sourceProfile: 'synthetic' }),
    ],
    [
      'expiry',
      (value: TelebirrAssignmentLease) => ({ ...value, expiresAt: '2026-09-06T00:00:00.000Z' }),
    ],
  ])('fails closed on altered %s binding', async (_label, alter) => {
    const pair = keyPair();
    const poll = createTelebirrAssignmentBroker({
      database: database(alter(lease()) as TelebirrAssignmentLease),
      openingKey: openingKey(),
      receiverManifest: manifest(),
      signer: signer(pair.privateKey, pair.spki),
    });
    await expect(
      poll({
        certificate: certificate(pair.digest),
        bridgeRequestBodyDigest: sha('c'),
        requestedLeaseSeconds: 180,
      }),
    ).rejects.toThrow(TelebirrAssignmentBrokerError);
  });

  it('rejects a signer that does not match the certificate before leasing', async () => {
    const pair = keyPair();
    const db = database();
    const poll = createTelebirrAssignmentBroker({
      database: db,
      openingKey: openingKey(),
      receiverManifest: manifest(),
      signer: signer(pair.privateKey, pair.spki),
    });
    await expect(
      poll({
        certificate: certificate(sha('d')),
        bridgeRequestBodyDigest: sha('e'),
        requestedLeaseSeconds: 180,
      }),
    ).rejects.toThrow(TelebirrAssignmentBrokerError);
    expect(db.leaseAssignment).not.toHaveBeenCalled();
  });

  it('never accepts financial authority in its dependency surface', () => {
    const source = createTelebirrAssignmentBroker.toString();
    expect(source).not.toMatch(/(?:settle|wallet|execute|kemerbet|service_role)/iu);
  });
});
