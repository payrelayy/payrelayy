import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import {
  TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
  canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes,
  canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes,
  canonicalTelebirrDeviceBridgePairingSignatureBytes,
  canonicalTelebirrDeviceBridgeRequestSignatureBytes,
  canonicalTelebirrLivePilotAssignmentSignatureBytes,
  canonicalTelebirrLivePilotObservationSignatureBytes,
  decodeSignedTelebirrDeviceBridgeAcknowledgement,
  decodeSignedTelebirrDeviceBridgeEnrollmentCertificate,
  decodeSignedTelebirrDeviceBridgePairingRequest,
  decodeSignedTelebirrDeviceBridgeRequest,
  decodeTelebirrDeviceBridgeAcknowledgementBody,
  decodeTelebirrDeviceBridgeEnrollmentCertificateBody,
  decodeTelebirrDeviceBridgePairingBody,
  decodeTelebirrDeviceBridgeRequestBody,
  decodeTelebirrLivePilotAssignmentBody,
  decodeTelebirrLivePilotObservationBody,
  decodeTelebirrLivePilotReceiptFacts,
  decodeTelebirrLivePilotSignedAssignment,
  decodeTelebirrLivePilotSignedObservation,
  deriveTelebirrLivePilotReferenceBindingDigest,
  digestTelebirrDeviceBridgeAcknowledgementBody,
  digestTelebirrDeviceBridgeEnrollmentCertificateBody,
  digestTelebirrDeviceBridgePairingBody,
  digestTelebirrDeviceBridgePayload,
  digestTelebirrDeviceBridgeRequestBody,
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotObservationBody,
  digestTelebirrLivePilotReceiptFacts,
  digestTelebirrLivePilotReceiverName,
  type SignedTelebirrDeviceBridgeAcknowledgement,
  type SignedTelebirrDeviceBridgeEnrollmentCertificate,
  type SignedTelebirrDeviceBridgePairingRequest,
  type SignedTelebirrDeviceBridgeRequest,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgeHeartbeatPayload,
  type TelebirrDeviceBridgeObservationUploadPayload,
  type TelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedObservation,
} from '@fetanagent/telebirr-verification-foundation';

import type { TelebirrDeviceStateCommandResponse } from './telebirr-device-state.js';

export const testIds = {
  pairing: '11111111-1111-4111-8111-111111111111',
  enrollment: '22222222-2222-4222-8222-222222222222',
  pilot: '33333333-3333-4333-8333-333333333333',
  receiverRevision: '44444444-4444-4444-8444-444444444444',
  receiverProfile: '55555555-5555-4555-8555-555555555555',
} as const;

const safety = {
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
} as const;

const sha = (character: string): string => 'sha256:' + character.repeat(64);
const fingerprint = (character: string): string => 'hmac-sha256:' + character.repeat(64);

interface TestKeyPair {
  readonly privateKey: KeyObject;
  readonly spki: Buffer;
  readonly digest: string;
}

function keyPair(): TestKeyPair {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
  return {
    privateKey: pair.privateKey,
    spki,
    digest: 'sha256:' + createHash('sha256').update(spki).digest('hex'),
  };
}

function p1363(privateKey: KeyObject, bytes: Uint8Array | undefined): string {
  if (!bytes) throw new Error('invalid synthetic signing transcript');
  return sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error('invalid synthetic ' + name);
  return value;
}

function pairingRequest(
  device: TestKeyPair,
  pairingId: string = testIds.pairing,
): SignedTelebirrDeviceBridgePairingRequest {
  const body = required(
    decodeTelebirrDeviceBridgePairingBody({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'device_bridge_no_money_v1',
      pairingId,
      pairingNonceDigest: sha('1'),
      deviceId: 'pilot-device-0001',
      keyId: 'pilot-device-key-0001',
      devicePublicKeySpki: device.spki.toString('base64url'),
      devicePublicKeySpkiSha256: device.digest,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      devicePlatform: 'android',
      appVersion: '0.2.0-runtime-inert',
      issuedAt: '2026-09-04T10:00:00.000Z',
      expiresAt: '2026-09-04T10:10:00.000Z',
      oneUse: true,
      ...safety,
    }),
    'pairing body',
  );
  return required(
    decodeSignedTelebirrDeviceBridgePairingRequest({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'device_bridge_no_money_v1',
      transcriptVersion: TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestTelebirrDeviceBridgePairingBody(body),
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      keyId: body.keyId,
      body,
      signature: p1363(device.privateKey, canonicalTelebirrDeviceBridgePairingSignatureBytes(body)),
    }),
    'signed pairing request',
  );
}

function enrollmentBody(
  pairing: SignedTelebirrDeviceBridgePairingRequest,
  assignmentSigner: TestKeyPair,
): TelebirrDeviceBridgeEnrollmentCertificateBody {
  return required(
    decodeTelebirrDeviceBridgeEnrollmentCertificateBody({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'device_bridge_no_money_v1',
      enrollmentId: testIds.enrollment,
      pairingId: pairing.body.pairingId,
      pairingRequestBodyDigest: pairing.bodyDigest,
      pairingNonceDigest: pairing.body.pairingNonceDigest,
      pairingConsumed: true,
      deviceId: pairing.body.deviceId,
      keyId: pairing.body.keyId,
      devicePublicKeySpki: pairing.body.devicePublicKeySpki,
      devicePublicKeySpkiSha256: pairing.body.devicePublicKeySpkiSha256,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      devicePlatform: 'android',
      minimumAppVersion: '0.2.0-runtime-inert',
      pilotRevisionId: testIds.pilot,
      receiverRevisionId: testIds.receiverRevision,
      receiverProfileId: testIds.receiverProfile,
      receiverProfileDigest: sha('2'),
      receiverConfigurationDigest: sha('3'),
      assignmentSignerKeyId: 'pilot-server-key-0001',
      assignmentSignerPublicKeySpkiSha256: assignmentSigner.digest,
      state: 'active',
      issuedAt: '2026-09-04T10:00:05.000Z',
      validFrom: '2026-09-04T10:00:05.000Z',
      validUntil: '2026-10-04T10:00:05.000Z',
      ...safety,
    }),
    'enrollment body',
  );
}

function enrollmentCertificate(
  body: TelebirrDeviceBridgeEnrollmentCertificateBody,
  server: TestKeyPair,
): SignedTelebirrDeviceBridgeEnrollmentCertificate {
  const signerKeyId = 'bridge-server-key-0001';
  return required(
    decodeSignedTelebirrDeviceBridgeEnrollmentCertificate({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'device_bridge_no_money_v1',
      transcriptVersion: TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestTelebirrDeviceBridgeEnrollmentCertificateBody(body),
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      signerKeyId,
      body,
      signature: p1363(
        server.privateKey,
        canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes(body, signerKeyId),
      ),
    }),
    'signed enrollment certificate',
  );
}

function signedRequest(
  device: TestKeyPair,
  command: 'heartbeat' | 'observation_upload',
  payload: unknown,
  requestId: string,
): SignedTelebirrDeviceBridgeRequest {
  const body = required(
    decodeTelebirrDeviceBridgeRequestBody({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'device_bridge_no_money_v1',
      requestId,
      enrollmentId: testIds.enrollment,
      deviceId: 'pilot-device-0001',
      keyId: 'pilot-device-key-0001',
      command,
      method: 'POST',
      canonicalPath:
        command === 'heartbeat'
          ? '/v1/telebirr/device/heartbeat'
          : '/v1/telebirr/device/observations:upload',
      payloadDigest: digestTelebirrDeviceBridgePayload(command, payload),
      nonceDigest: sha('4'),
      issuedAt: '2026-09-04T10:01:00.000Z',
      expiresAt: '2026-09-04T10:03:00.000Z',
      ...safety,
    }),
    'request body',
  );
  return required(
    decodeSignedTelebirrDeviceBridgeRequest({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'device_bridge_no_money_v1',
      transcriptVersion: TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestTelebirrDeviceBridgeRequestBody(body),
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      keyId: body.keyId,
      body,
      signature: p1363(device.privateKey, canonicalTelebirrDeviceBridgeRequestSignatureBytes(body)),
    }),
    'signed request',
  );
}

function signedAssignment(assignmentSigner: TestKeyPair): TelebirrLivePilotSignedAssignment {
  const rawReference = 'PILOT9ABC1234';
  const referenceFingerprint = fingerprint('5');
  const expectedReceiverNameNormalized = 'pilot receiver';
  const body = required(
    decodeTelebirrLivePilotAssignmentBody({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      assignmentId: 'pilot-assignment-0001',
      requestId: 'pilot-request-0001',
      jobId: 'pilot-job-0001',
      attemptNumber: 1,
      pilotRevisionId: testIds.pilot,
      deviceId: 'pilot-device-0001',
      keyId: 'pilot-device-key-0001',
      leaseNonceDigest: sha('6'),
      challengeId: 'pilot-challenge-0001',
      challengeDigest: sha('7'),
      rawReference,
      referenceFingerprint,
      referenceBindingProfile: TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
      referenceBindingDigest: deriveTelebirrLivePilotReferenceBindingDigest({
        rawReference,
        referenceFingerprint,
      }),
      sourceProfile: 'telebirr_official_receipt_v1',
      receiverRevisionId: testIds.receiverRevision,
      receiverProfileId: testIds.receiverProfile,
      receiverProfileDigest: sha('2'),
      receiverConfigurationDigest: sha('3'),
      receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
      expectedReceiverNameNormalized,
      expectedReceiverNameDigest: digestTelebirrLivePilotReceiverName(
        expectedReceiverNameNormalized,
      ),
      adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
      parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
      factsNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
      issuedAt: '2026-09-04T10:01:00.000Z',
      expiresAt: '2026-09-04T10:03:00.000Z',
    }),
    'assignment body',
  );
  return required(
    decodeTelebirrLivePilotSignedAssignment({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      transcriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestTelebirrLivePilotAssignmentBody(body),
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      signerKeyId: 'pilot-server-key-0001',
      body,
      signature: p1363(
        assignmentSigner.privateKey,
        canonicalTelebirrLivePilotAssignmentSignatureBytes(body),
      ),
    }),
    'signed assignment',
  );
}

function signedObservation(
  assignment: TelebirrLivePilotSignedAssignment,
  device: TestKeyPair,
): TelebirrLivePilotSignedObservation {
  const receiverName = 'pilot receiver';
  const facts = required(
    decodeTelebirrLivePilotReceiptFacts({
      lookupOutcome: 'found',
      evidenceSource: 'provider_receipt_lookup',
      layoutAttestation: 'recognized_layout_v1',
      providerFinalStatus: 'completed',
      canonicalReferencePresent: true,
      referenceMatch: 'matched',
      amountMinor: 2_500,
      currencyCode: 'ETB',
      receiverMatch: 'matched',
      creditedPartyNameDigest: digestTelebirrLivePilotReceiverName(receiverName),
      paymentMode: 'telebirr',
      paymentReason: 'send_money_to_registered_customer',
      paymentChannel: 'api_app',
      occurredAt: '2026-09-04T10:00:45.000Z',
      retrievedAt: '2026-09-04T10:02:00.000Z',
    }),
    'receipt facts',
  );
  const source = assignment.body;
  const body = required(
    decodeTelebirrLivePilotObservationBody({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      assignmentId: source.assignmentId,
      requestId: source.requestId,
      jobId: source.jobId,
      attemptNumber: source.attemptNumber,
      pilotRevisionId: source.pilotRevisionId,
      deviceId: source.deviceId,
      keyId: source.keyId,
      leaseNonceDigest: source.leaseNonceDigest,
      challengeId: source.challengeId,
      challengeDigest: source.challengeDigest,
      assignmentBodyDigest: assignment.bodyDigest,
      referenceFingerprint: source.referenceFingerprint,
      referenceBindingDigest: source.referenceBindingDigest,
      sourceProfile: source.sourceProfile,
      receiverRevisionId: source.receiverRevisionId,
      receiverProfileId: source.receiverProfileId,
      receiverProfileDigest: source.receiverProfileDigest,
      receiverConfigurationDigest: source.receiverConfigurationDigest,
      receiverNameNormalizerVersion: source.receiverNameNormalizerVersion,
      expectedReceiverNameDigest: source.expectedReceiverNameDigest,
      adapterVersion: source.adapterVersion,
      parserVersion: source.parserVersion,
      factsNormalizerVersion: source.factsNormalizerVersion,
      sourceDocumentDigest: sha('8'),
      normalizedFactsDigest: digestTelebirrLivePilotReceiptFacts(facts),
      observedAt: '2026-09-04T10:02:00.000Z',
      facts,
    }),
    'observation body',
  );
  return required(
    decodeTelebirrLivePilotSignedObservation({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      transcriptVersion: TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestTelebirrLivePilotObservationBody(body),
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      body,
      signature: p1363(
        device.privateKey,
        canonicalTelebirrLivePilotObservationSignatureBytes(body),
      ),
    }),
    'signed observation',
  );
}

function signedAcknowledgement(
  request: SignedTelebirrDeviceBridgeRequest,
  server: TestKeyPair,
): SignedTelebirrDeviceBridgeAcknowledgement {
  const body = required(
    decodeTelebirrDeviceBridgeAcknowledgementBody({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'device_bridge_no_money_v1',
      acknowledgementId: 'bridge-acknowledgement-0001',
      requestId: request.body.requestId,
      enrollmentId: request.body.enrollmentId,
      deviceId: request.body.deviceId,
      keyId: request.body.keyId,
      command: request.body.command,
      requestBodyDigest: request.bodyDigest,
      requestPayloadDigest: request.body.payloadDigest,
      outcome: 'acknowledged',
      assignmentBodyDigest: null,
      observationBodyDigest: null,
      reasonCode: null,
      issuedAt: '2026-09-04T10:01:01.000Z',
      expiresAt: request.body.expiresAt,
      ...safety,
    }),
    'acknowledgement body',
  );
  const signerKeyId = 'bridge-server-key-0001';
  return required(
    decodeSignedTelebirrDeviceBridgeAcknowledgement({
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'device_bridge_no_money_v1',
      transcriptVersion: TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: digestTelebirrDeviceBridgeAcknowledgementBody(body),
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      signerKeyId,
      body,
      signature: p1363(
        server.privateKey,
        canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes(body, signerKeyId),
      ),
    }),
    'signed acknowledgement',
  );
}

export interface TelebirrDeviceStateTestFixture {
  readonly pairing: SignedTelebirrDeviceBridgePairingRequest;
  readonly enrollmentBody: TelebirrDeviceBridgeEnrollmentCertificateBody;
  readonly certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate;
  readonly heartbeatPayload: TelebirrDeviceBridgeHeartbeatPayload;
  readonly heartbeatRequest: SignedTelebirrDeviceBridgeRequest;
  readonly evidencePayload: TelebirrDeviceBridgeObservationUploadPayload;
  readonly evidenceRequest: SignedTelebirrDeviceBridgeRequest;
  readonly response: TelebirrDeviceStateCommandResponse;
}

export function telebirrDeviceStatePairingTestFixture(
  pairingId: string,
): SignedTelebirrDeviceBridgePairingRequest {
  return pairingRequest(keyPair(), pairingId);
}

export function telebirrDeviceStateTestFixture(): TelebirrDeviceStateTestFixture {
  const device = keyPair();
  const server = keyPair();
  const assignmentSigner = keyPair();
  const pairing = pairingRequest(device);
  const body = enrollmentBody(pairing, assignmentSigner);
  const certificate = enrollmentCertificate(body, server);
  const heartbeatPayload = {
    runtimeState: 'ready',
    statusCode: 'device_ready',
    appVersion: '0.2.0-runtime-inert',
  } as const;
  const heartbeatRequest = signedRequest(
    device,
    'heartbeat',
    heartbeatPayload,
    'bridge-heartbeat-request-0001',
  );
  const assignment = signedAssignment(assignmentSigner);
  const observation = signedObservation(assignment, device);
  const evidencePayload = { signedAssignment: assignment, signedObservation: observation };
  const evidenceRequest = signedRequest(
    device,
    'observation_upload',
    evidencePayload,
    'bridge-evidence-request-0001',
  );
  return {
    pairing,
    enrollmentBody: body,
    certificate,
    heartbeatPayload,
    heartbeatRequest,
    evidencePayload,
    evidenceRequest,
    response: Object.freeze({
      acknowledgement: signedAcknowledgement(heartbeatRequest, server),
      assignment: null,
    }),
  };
}
