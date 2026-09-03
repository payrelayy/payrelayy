import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
  decodeTelebirrAssignmentBrokerLocalPollRequestBytes,
  decodeTelebirrAssignmentBrokerLocalPollResponseBytes,
  encodeTelebirrAssignmentBrokerLocalPollRequest,
  encodeTelebirrAssignmentBrokerLocalPollResponse,
} from './assignment-broker-local-protocol.js';
import type { TelebirrDeviceBridgeEnrollmentCertificateBody } from './device-bridge-protocol.js';
import {
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
  canonicalTelebirrLivePilotAssignmentSignatureBytes,
  deriveTelebirrLivePilotReferenceBindingDigest,
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotReceiverName,
  type TelebirrLivePilotAssignmentBody,
  type TelebirrLivePilotSignedAssignment,
} from './live-private-pilot-protocol.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

function keyPair(): {
  readonly privateKey: KeyObject;
  readonly spki: Buffer;
  readonly digest: string;
} {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
  return {
    privateKey: pair.privateKey,
    spki,
    digest: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
  };
}

function certificate(
  device: ReturnType<typeof keyPair>,
  assignmentSigner: ReturnType<typeof keyPair>,
): TelebirrDeviceBridgeEnrollmentCertificateBody {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    enrollmentId: 'pilot-enrollment-0001',
    pairingId: 'pilot-pairing-0000001',
    pairingRequestBodyDigest: sha('1'),
    pairingNonceDigest: sha('2'),
    pairingConsumed: true,
    deviceId: 'pilot-device-00000001',
    keyId: 'pilot-device-key-0001',
    devicePublicKeySpki: device.spki.toString('base64url'),
    devicePublicKeySpkiSha256: device.digest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    devicePlatform: 'android',
    minimumAppVersion: '0.3.0-device-bridge-inert',
    pilotRevisionId: 'pilot-revision-0000001',
    receiverRevisionId: 'pilot-receiver-revision-0001',
    receiverProfileId: 'pilot-receiver-profile-00001',
    receiverProfileDigest: sha('3'),
    receiverConfigurationDigest: sha('4'),
    assignmentSignerKeyId: 'pilot-assignment-key-0001',
    assignmentSignerPublicKeySpkiSha256: assignmentSigner.digest,
    state: 'active',
    issuedAt: '2026-09-04T10:00:00.000Z',
    validFrom: '2026-09-04T10:00:00.000Z',
    validUntil: '2026-10-04T10:00:00.000Z',
    ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  };
}

function signedAssignment(
  assignmentSigner: ReturnType<typeof keyPair>,
): TelebirrLivePilotSignedAssignment {
  const rawReference = 'PILOT9ABC1234';
  const referenceFingerprint = `hmac-sha256:${'5'.repeat(64)}`;
  const expectedReceiverNameNormalized = 'pilot receiver';
  const body: TelebirrLivePilotAssignmentBody = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    assignmentId: 'pilot-assignment-0001',
    requestId: 'pilot-request-0000001',
    jobId: 'pilot-job-000000001',
    attemptNumber: 1,
    pilotRevisionId: 'pilot-revision-0000001',
    deviceId: 'pilot-device-00000001',
    keyId: 'pilot-device-key-0001',
    leaseNonceDigest: sha('6'),
    challengeId: 'pilot-challenge-000001',
    challengeDigest: sha('7'),
    rawReference,
    referenceFingerprint,
    referenceBindingProfile: TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
    referenceBindingDigest: deriveTelebirrLivePilotReferenceBindingDigest({
      rawReference,
      referenceFingerprint,
    })!,
    sourceProfile: 'telebirr_official_receipt_v1',
    receiverRevisionId: 'pilot-receiver-revision-0001',
    receiverProfileId: 'pilot-receiver-profile-00001',
    receiverProfileDigest: sha('3'),
    receiverConfigurationDigest: sha('4'),
    receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized,
    expectedReceiverNameDigest: digestTelebirrLivePilotReceiverName(
      expectedReceiverNameNormalized,
    )!,
    adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    factsNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
    issuedAt: '2026-09-04T10:01:00.000Z',
    expiresAt: '2026-09-04T10:03:00.000Z',
  };
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    transcriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestTelebirrLivePilotAssignmentBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: 'pilot-assignment-key-0001',
    body,
    signature: sign('sha256', canonicalTelebirrLivePilotAssignmentSignatureBytes(body)!, {
      key: assignmentSigner.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
}

function request(certificateBody: TelebirrDeviceBridgeEnrollmentCertificateBody) {
  return {
    contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
    providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
    protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
    certificate: certificateBody,
    bridgeRequestBodyDigest: sha('8'),
    requestedLeaseSeconds: 120,
    ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  } as const;
}

describe('local TeleBirr assignment broker protocol', () => {
  it('round-trips one exact canonical request and both exact outcomes', () => {
    const device = keyPair();
    const assignmentSigner = keyPair();
    const encodedRequest = encodeTelebirrAssignmentBrokerLocalPollRequest(
      request(certificate(device, assignmentSigner)),
    )!;
    expect(decodeTelebirrAssignmentBrokerLocalPollRequestBytes(encodedRequest)).toEqual(
      request(certificate(device, assignmentSigner)),
    );

    const noAssignment = encodeTelebirrAssignmentBrokerLocalPollResponse({
      contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
      providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
      protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
      outcome: 'no_assignment',
      assignment: null,
      ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
    })!;
    expect(decodeTelebirrAssignmentBrokerLocalPollResponseBytes(noAssignment)?.outcome).toBe(
      'no_assignment',
    );

    const assignment = signedAssignment(assignmentSigner);
    const encodedAssignment = encodeTelebirrAssignmentBrokerLocalPollResponse({
      contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
      providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
      protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
      outcome: 'assignment',
      assignment,
      ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
    })!;
    const decodedAssignment =
      decodeTelebirrAssignmentBrokerLocalPollResponseBytes(encodedAssignment);
    expect(decodedAssignment?.outcome).toBe('assignment');
    expect(decodedAssignment?.assignment).toEqual(assignment);
  });

  it('rejects non-canonical JSON, extra keys, authority escalation, and a revoked certificate', () => {
    const device = keyPair();
    const assignmentSigner = keyPair();
    const valid = request(certificate(device, assignmentSigner));
    const encoded = encodeTelebirrAssignmentBrokerLocalPollRequest(valid)!;
    expect(
      decodeTelebirrAssignmentBrokerLocalPollRequestBytes(
        Buffer.from(` ${encoded.toString('utf8')}`, 'utf8'),
      ),
    ).toBeUndefined();
    expect(
      encodeTelebirrAssignmentBrokerLocalPollRequest({ ...valid, unexpected: true }),
    ).toBeUndefined();
    expect(
      encodeTelebirrAssignmentBrokerLocalPollRequest({
        ...valid,
        moneyMovementAllowed: true,
      }),
    ).toBeUndefined();
    expect(
      encodeTelebirrAssignmentBrokerLocalPollRequest({
        ...valid,
        certificate: { ...valid.certificate, state: 'revoked' },
      }),
    ).toBeUndefined();
  });

  it('rejects inconsistent outcomes and hostile accessors without invoking them', () => {
    const assignment = signedAssignment(keyPair());
    expect(
      encodeTelebirrAssignmentBrokerLocalPollResponse({
        contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
        providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
        protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
        outcome: 'no_assignment',
        assignment,
        ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
      }),
    ).toBeUndefined();

    let accessed = false;
    const hostile = Object.defineProperty({}, 'contractVersion', {
      enumerable: true,
      get: () => {
        accessed = true;
        return 1;
      },
    });
    expect(encodeTelebirrAssignmentBrokerLocalPollRequest(hostile)).toBeUndefined();
    expect(accessed).toBe(false);
    expect(
      encodeTelebirrAssignmentBrokerLocalPollRequest(new Proxy({}, { get: () => 1 })),
    ).toBeUndefined();
  });
});
