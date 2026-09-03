import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM,
  TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
  TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
  TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
  TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING,
  canonicalTelebirrDeviceBridgeAcknowledgementBodyBytes,
  canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes,
  canonicalTelebirrDeviceBridgeEnrollmentCertificateBodyBytes,
  canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes,
  canonicalTelebirrDeviceBridgePairingBodyBytes,
  canonicalTelebirrDeviceBridgePairingSignatureBytes,
  canonicalTelebirrDeviceBridgeRequestBodyBytes,
  canonicalTelebirrDeviceBridgeRequestSignatureBytes,
  decodeSignedTelebirrDeviceBridgeAcknowledgement,
  decodeSignedTelebirrDeviceBridgeEnrollmentCertificate,
  decodeTelebirrDeviceBridgeCommandFrame,
  decodeTelebirrDeviceBridgeHeartbeatPayload,
  decodeTelebirrDeviceBridgeRequestBody,
  deriveTelebirrDeviceBridgeRequestReplayIdentity,
  digestTelebirrDeviceBridgeAcknowledgementBody,
  digestTelebirrDeviceBridgeEnrollmentCertificateBody,
  digestTelebirrDeviceBridgePairingBody,
  digestTelebirrDeviceBridgePayload,
  digestTelebirrDeviceBridgeRequestBody,
  redactedTelebirrDeviceBridgeRequestForLog,
  telebirrDeviceBridgeCertificateMatchesPairingRequest,
  verifySignedTelebirrDeviceBridgeAcknowledgement,
  verifySignedTelebirrDeviceBridgeEnrollmentCertificate,
  verifySignedTelebirrDeviceBridgePairingRequest,
  verifySignedTelebirrDeviceBridgeRequest,
  type SignedTelebirrDeviceBridgeAcknowledgement,
  type SignedTelebirrDeviceBridgeEnrollmentCertificate,
  type SignedTelebirrDeviceBridgePairingRequest,
  type SignedTelebirrDeviceBridgeRequest,
  type TelebirrDeviceBridgeAcknowledgementBody,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgePairingBody,
  type TelebirrDeviceBridgeRequestBody,
} from './device-bridge-protocol.js';
import {
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
  canonicalTelebirrLivePilotAssignmentSignatureBytes,
  canonicalTelebirrLivePilotObservationSignatureBytes,
  deriveTelebirrLivePilotReferenceBindingDigest,
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotObservationBody,
  digestTelebirrLivePilotReceiptFacts,
  digestTelebirrLivePilotReceiverName,
  type TelebirrLivePilotAssignmentBody,
  type TelebirrLivePilotFoundFacts,
  type TelebirrLivePilotObservationBody,
  type TelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedObservation,
} from './live-private-pilot-protocol.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const fingerprint = (character: string): string => `hmac-sha256:${character.repeat(64)}`;
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

function p1363(privateKey: KeyObject, bytes: Uint8Array): string {
  return sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );
}

function pairingBody(device: ReturnType<typeof keyPair>): TelebirrDeviceBridgePairingBody {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    pairingId: 'pairing-request-0001',
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
  };
}

function signedPairing(
  body: TelebirrDeviceBridgePairingBody,
  privateKey: KeyObject,
): SignedTelebirrDeviceBridgePairingRequest {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    transcriptVersion: TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestTelebirrDeviceBridgePairingBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    keyId: body.keyId,
    body,
    signature: p1363(privateKey, canonicalTelebirrDeviceBridgePairingSignatureBytes(body)!),
  };
}

function enrollmentBody(
  pairing: SignedTelebirrDeviceBridgePairingRequest,
  assignmentSignerDigest: string,
): TelebirrDeviceBridgeEnrollmentCertificateBody {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    enrollmentId: 'pilot-enrollment-0001',
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
    pilotRevisionId: 'pilot-revision-0001',
    receiverRevisionId: 'pilot-receiver-revision-0001',
    receiverProfileId: 'pilot-receiver-profile-0001',
    receiverProfileDigest: sha('2'),
    receiverConfigurationDigest: sha('3'),
    assignmentSignerKeyId: 'pilot-server-key-0001',
    assignmentSignerPublicKeySpkiSha256: assignmentSignerDigest,
    state: 'active',
    issuedAt: '2026-09-04T10:00:05.000Z',
    validFrom: '2026-09-04T10:00:05.000Z',
    validUntil: '2026-10-04T10:00:05.000Z',
    ...safety,
  };
}

function signedCertificate(
  body: TelebirrDeviceBridgeEnrollmentCertificateBody,
  privateKey: KeyObject,
): SignedTelebirrDeviceBridgeEnrollmentCertificate {
  const signerKeyId = 'bridge-server-key-0001';
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    transcriptVersion: TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestTelebirrDeviceBridgeEnrollmentCertificateBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId,
    body,
    signature: p1363(
      privateKey,
      canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes(body, signerKeyId)!,
    ),
  };
}

function requestBody(
  payloadDigest: string,
  overrides: Partial<TelebirrDeviceBridgeRequestBody> = {},
): TelebirrDeviceBridgeRequestBody {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    requestId: 'bridge-request-0001',
    enrollmentId: 'pilot-enrollment-0001',
    deviceId: 'pilot-device-0001',
    keyId: 'pilot-device-key-0001',
    command: 'assignment_poll',
    method: 'POST',
    canonicalPath: '/v1/telebirr/device/assignments:poll',
    payloadDigest,
    nonceDigest: sha('4'),
    issuedAt: '2026-09-04T10:01:00.000Z',
    expiresAt: '2026-09-04T10:03:00.000Z',
    ...safety,
    ...overrides,
  };
}

function signedRequest(
  body: TelebirrDeviceBridgeRequestBody,
  privateKey: KeyObject,
): SignedTelebirrDeviceBridgeRequest {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    transcriptVersion: TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestTelebirrDeviceBridgeRequestBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    keyId: body.keyId,
    body,
    signature: p1363(privateKey, canonicalTelebirrDeviceBridgeRequestSignatureBytes(body)!),
  };
}

function acknowledgementBody(
  request: SignedTelebirrDeviceBridgeRequest,
  overrides: Partial<TelebirrDeviceBridgeAcknowledgementBody> = {},
): TelebirrDeviceBridgeAcknowledgementBody {
  return {
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
    outcome: 'no_assignment',
    assignmentBodyDigest: null,
    observationBodyDigest: null,
    reasonCode: null,
    issuedAt: '2026-09-04T10:01:01.000Z',
    expiresAt: '2026-09-04T10:03:01.000Z',
    ...safety,
    ...overrides,
  };
}

function signedAcknowledgement(
  body: TelebirrDeviceBridgeAcknowledgementBody,
  privateKey: KeyObject,
): SignedTelebirrDeviceBridgeAcknowledgement {
  const signerKeyId = 'bridge-server-key-0001';
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    transcriptVersion: TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestTelebirrDeviceBridgeAcknowledgementBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId,
    body,
    signature: p1363(
      privateKey,
      canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes(body, signerKeyId)!,
    ),
  };
}

function liveAssignmentBody(): TelebirrLivePilotAssignmentBody {
  const rawReference = 'PILOT9ABC1234';
  const referenceFingerprint = fingerprint('5');
  const expectedReceiverNameNormalized = 'pilot receiver';
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    assignmentId: 'pilot-assignment-0001',
    requestId: 'pilot-request-0001',
    jobId: 'pilot-job-0001',
    attemptNumber: 1,
    pilotRevisionId: 'pilot-revision-0001',
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
    })!,
    sourceProfile: 'telebirr_official_receipt_v1',
    receiverRevisionId: 'pilot-receiver-revision-0001',
    receiverProfileId: 'pilot-receiver-profile-0001',
    receiverProfileDigest: sha('2'),
    receiverConfigurationDigest: sha('3'),
    receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized,
    expectedReceiverNameDigest: digestTelebirrLivePilotReceiverName(
      expectedReceiverNameNormalized,
    )!,
    adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    factsNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
    issuedAt: '2026-09-04T10:01:00.000Z',
    expiresAt: '2026-09-04T10:06:00.000Z',
  };
}

function liveUpload(
  devicePrivateKey: KeyObject,
  assignmentPrivateKey: KeyObject,
): {
  readonly signedAssignment: TelebirrLivePilotSignedAssignment;
  readonly signedObservation: TelebirrLivePilotSignedObservation;
} {
  const body = liveAssignmentBody();
  const assignmentBodyDigest = digestTelebirrLivePilotAssignmentBody(body)!;
  const signedAssignment: TelebirrLivePilotSignedAssignment = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    transcriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: assignmentBodyDigest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: 'pilot-server-key-0001',
    body,
    signature: p1363(
      assignmentPrivateKey,
      canonicalTelebirrLivePilotAssignmentSignatureBytes(body)!,
    ),
  };
  const facts: TelebirrLivePilotFoundFacts = {
    lookupOutcome: 'found',
    evidenceSource: 'provider_receipt_lookup',
    layoutAttestation: 'recognized_layout_v1',
    providerFinalStatus: 'completed',
    canonicalReferencePresent: true,
    referenceMatch: 'matched',
    amountMinor: 2_500,
    currencyCode: 'ETB',
    receiverMatch: 'matched',
    creditedPartyNameDigest: body.expectedReceiverNameDigest,
    paymentMode: 'telebirr',
    paymentReason: 'send_money_to_registered_customer',
    paymentChannel: 'api_app',
    occurredAt: '2026-09-04T10:00:30.000Z',
    retrievedAt: '2026-09-04T10:02:00.000Z',
  };
  const observationBody: TelebirrLivePilotObservationBody = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    assignmentId: body.assignmentId,
    requestId: body.requestId,
    jobId: body.jobId,
    attemptNumber: body.attemptNumber,
    pilotRevisionId: body.pilotRevisionId,
    deviceId: body.deviceId,
    keyId: body.keyId,
    leaseNonceDigest: body.leaseNonceDigest,
    challengeId: body.challengeId,
    challengeDigest: body.challengeDigest,
    assignmentBodyDigest,
    referenceFingerprint: body.referenceFingerprint,
    referenceBindingDigest: body.referenceBindingDigest,
    sourceProfile: body.sourceProfile,
    receiverRevisionId: body.receiverRevisionId,
    receiverProfileId: body.receiverProfileId,
    receiverProfileDigest: body.receiverProfileDigest,
    receiverConfigurationDigest: body.receiverConfigurationDigest,
    receiverNameNormalizerVersion: body.receiverNameNormalizerVersion,
    expectedReceiverNameDigest: body.expectedReceiverNameDigest,
    adapterVersion: body.adapterVersion,
    parserVersion: body.parserVersion,
    factsNormalizerVersion: body.factsNormalizerVersion,
    sourceDocumentDigest: sha('8'),
    normalizedFactsDigest: digestTelebirrLivePilotReceiptFacts(facts)!,
    observedAt: '2026-09-04T10:02:00.000Z',
    facts,
  };
  const observationBodyDigest = digestTelebirrLivePilotObservationBody(observationBody)!;
  return {
    signedAssignment,
    signedObservation: {
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      transcriptVersion: TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest: observationBodyDigest,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      body: observationBody,
      signature: p1363(
        devicePrivateKey,
        canonicalTelebirrLivePilotObservationSignatureBytes(observationBody)!,
      ),
    },
  };
}

interface Fixture {
  readonly device: ReturnType<typeof keyPair>;
  readonly server: ReturnType<typeof keyPair>;
  readonly assignmentSigner: ReturnType<typeof keyPair>;
  readonly pairing: SignedTelebirrDeviceBridgePairingRequest;
  readonly certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate;
  readonly payload: { readonly requestedLeaseSeconds: number };
  readonly request: SignedTelebirrDeviceBridgeRequest;
  readonly acknowledgement: SignedTelebirrDeviceBridgeAcknowledgement;
}

function fixture(): Fixture {
  const device = keyPair();
  const server = keyPair();
  const assignmentSigner = keyPair();
  const pairing = signedPairing(pairingBody(device), device.privateKey);
  const certificate = signedCertificate(
    enrollmentBody(pairing, assignmentSigner.digest),
    server.privateKey,
  );
  const payload = { requestedLeaseSeconds: 120 } as const;
  const request = signedRequest(
    requestBody(digestTelebirrDeviceBridgePayload('assignment_poll', payload)!),
    device.privateKey,
  );
  const acknowledgement = signedAcknowledgement(acknowledgementBody(request), server.privateKey);
  return {
    device,
    server,
    assignmentSigner,
    pairing,
    certificate,
    payload,
    request,
    acknowledgement,
  };
}

describe('TeleBirr Android device bridge protocol', () => {
  it('self-authenticates one-use pairing and binds a server-signed enrollment certificate', () => {
    const value = fixture();
    expect(verifySignedTelebirrDeviceBridgePairingRequest(value.pairing)).toBe(true);
    expect(
      verifySignedTelebirrDeviceBridgeEnrollmentCertificate(value.certificate, value.server.spki),
    ).toBe(true);
    expect(
      telebirrDeviceBridgeCertificateMatchesPairingRequest(value.certificate, value.pairing),
    ).toBe(true);
    expect(
      Object.isFrozen(decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(value.certificate)),
    ).toBe(true);
  });

  it('verifies a fresh device command and derives an exact replay identity', () => {
    const value = fixture();
    const replayIdentity = deriveTelebirrDeviceBridgeRequestReplayIdentity(value.request)!;
    expect(replayIdentity).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      verifySignedTelebirrDeviceBridgeRequest(
        value.request,
        value.certificate,
        value.server.spki,
        '2026-09-04T10:01:30.000Z',
      ),
    ).toBe(true);
    expect(
      verifySignedTelebirrDeviceBridgeRequest(
        value.request,
        value.certificate,
        value.server.spki,
        '2026-09-04T10:01:30.000Z',
        [replayIdentity],
      ),
    ).toBe(false);
    expect(
      verifySignedTelebirrDeviceBridgeRequest(
        value.request,
        value.certificate,
        value.server.spki,
        '2026-09-04T10:03:00.000Z',
      ),
    ).toBe(false);
  });

  it('binds the exact command path and exact typed payload', () => {
    const value = fixture();
    expect(
      decodeTelebirrDeviceBridgeCommandFrame({ request: value.request, payload: value.payload }),
    ).toEqual({
      request: value.request,
      payload: value.payload,
    });
    expect(
      decodeTelebirrDeviceBridgeRequestBody({
        ...value.request.body,
        canonicalPath: '/v1/telebirr/device/observations:upload',
      }),
    ).toBeUndefined();
    expect(
      decodeTelebirrDeviceBridgeCommandFrame({
        request: value.request,
        payload: { requestedLeaseSeconds: 121 },
      }),
    ).toBeUndefined();
    expect(
      decodeTelebirrDeviceBridgeCommandFrame({
        request: value.request,
        payload: { requestedLeaseSeconds: 120, unexpected: true },
      }),
    ).toBeUndefined();
  });

  it('binds the exact signed assignment and exact signed observation in an upload payload', () => {
    const value = fixture();
    const upload = liveUpload(value.device.privateKey, value.assignmentSigner.privateKey);
    const payloadDigest = digestTelebirrDeviceBridgePayload('observation_upload', upload)!;
    const body = requestBody(payloadDigest, {
      requestId: 'bridge-request-0002',
      command: 'observation_upload',
      canonicalPath: '/v1/telebirr/device/observations:upload',
      nonceDigest: sha('9'),
    });
    const request = signedRequest(body, value.device.privateKey);
    expect(decodeTelebirrDeviceBridgeCommandFrame({ request, payload: upload })).toBeDefined();
    expect(
      decodeTelebirrDeviceBridgeCommandFrame({
        request,
        payload: {
          ...upload,
          signedObservation: { ...upload.signedObservation, signature: 'A'.repeat(86) },
        },
      }),
    ).toBeUndefined();
  });

  it('authenticates server acknowledgement semantics and request binding', () => {
    const value = fixture();
    expect(
      verifySignedTelebirrDeviceBridgeAcknowledgement(
        value.acknowledgement,
        value.request,
        value.server.spki,
        '2026-09-04T10:01:30.000Z',
      ),
    ).toBe(true);
    expect(
      decodeSignedTelebirrDeviceBridgeAcknowledgement({
        ...value.acknowledgement,
        body: {
          ...value.acknowledgement.body,
          outcome: 'acknowledged',
        },
      }),
    ).toBeUndefined();
    expect(
      verifySignedTelebirrDeviceBridgeAcknowledgement(
        value.acknowledgement,
        { ...value.request, bodyDigest: sha('f') },
        value.server.spki,
        '2026-09-04T10:01:30.000Z',
      ),
    ).toBe(false);
  });

  it('rejects extra keys, accessors, proxies, weak keys, and capability escalation', () => {
    const value = fixture();
    const getter = vi.fn(() => value.request.body.requestId);
    const accessor = { ...value.request.body } as Record<string, unknown>;
    Object.defineProperty(accessor, 'requestId', { enumerable: true, get: getter });
    expect(decodeTelebirrDeviceBridgeRequestBody(accessor)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(
      decodeTelebirrDeviceBridgeRequestBody(new Proxy(value.request.body, {})),
    ).toBeUndefined();
    expect(
      decodeTelebirrDeviceBridgeRequestBody({
        ...value.request.body,
        financialActionAllowed: true,
      }),
    ).toBeUndefined();
    const wrongKey = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    expect(verifySignedTelebirrDeviceBridgeEnrollmentCertificate(value.certificate, wrongKey)).toBe(
      false,
    );
  });

  it('reports only a redacted operational projection', () => {
    const value = fixture();
    expect(redactedTelebirrDeviceBridgeRequestForLog(value.request)).toEqual({
      valid: true,
      command: 'assignment_poll',
      evidenceOnly: true,
      financialActionAllowed: false,
    });
    expect(JSON.stringify(redactedTelebirrDeviceBridgeRequestForLog(value.request))).not.toContain(
      value.request.body.requestId,
    );
  });

  it('uses stable canonical domains and cross-language scalar encoding', () => {
    const value = fixture();
    const fixedPairingBody: TelebirrDeviceBridgePairingBody = {
      ...value.pairing.body,
      devicePublicKeySpki:
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZl_5JsOZvoSviWoLO7NLMkWIxu4s2lmHNEbAY_-WhY6CGVICyKcxwVUSpWve1CrjjNY79QYUfCoUgGxQM4AhMg',
      devicePublicKeySpkiSha256:
        'sha256:a8a76e4864c698c989b138cb1e232a029f49d9b09681e6d61eb644fc44d1809e',
    };
    const fixedPairingDigest = digestTelebirrDeviceBridgePairingBody(fixedPairingBody)!;
    const fixedPairing = {
      ...value.pairing,
      body: fixedPairingBody,
      bodyDigest: fixedPairingDigest,
    };
    const fixedCertificateBody = {
      ...enrollmentBody(fixedPairing, sha('4')),
      assignmentSignerPublicKeySpkiSha256: sha('4'),
    };
    const payload = { requestedLeaseSeconds: 120 } as const;
    const payloadDigest = digestTelebirrDeviceBridgePayload('assignment_poll', payload)!;
    const fixedRequestBody = requestBody(payloadDigest, { nonceDigest: sha('5') });
    const fixedRequestDigest = digestTelebirrDeviceBridgeRequestBody(fixedRequestBody)!;
    const fixedRequest = {
      ...value.request,
      body: fixedRequestBody,
      bodyDigest: fixedRequestDigest,
    };
    const fixedAcknowledgementBody = acknowledgementBody(fixedRequest, {
      expiresAt: '2026-09-04T10:03:00.000Z',
    });
    expect({
      constants: [
        TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
        TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
        TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
        TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM,
        TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
        TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING,
      ],
      pairingBytes: canonicalTelebirrDeviceBridgePairingBodyBytes(fixedPairingBody)?.length,
      pairingDigest: fixedPairingDigest,
      pairingSignatureBytes:
        canonicalTelebirrDeviceBridgePairingSignatureBytes(fixedPairingBody)?.length,
      certificateBytes:
        canonicalTelebirrDeviceBridgeEnrollmentCertificateBodyBytes(fixedCertificateBody)?.length,
      certificateDigest: digestTelebirrDeviceBridgeEnrollmentCertificateBody(fixedCertificateBody),
      certificateSignatureBytes: canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes(
        fixedCertificateBody,
        'bridge-server-key-0001',
      )?.length,
      payloadDigest,
      requestBytes: canonicalTelebirrDeviceBridgeRequestBodyBytes(fixedRequestBody)?.length,
      requestDigest: fixedRequestDigest,
      requestSignatureBytes:
        canonicalTelebirrDeviceBridgeRequestSignatureBytes(fixedRequestBody)?.length,
      acknowledgementBytes:
        canonicalTelebirrDeviceBridgeAcknowledgementBodyBytes(fixedAcknowledgementBody)?.length,
      acknowledgementDigest:
        digestTelebirrDeviceBridgeAcknowledgementBody(fixedAcknowledgementBody),
      acknowledgementSignatureBytes: canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes(
        fixedAcknowledgementBody,
        'bridge-server-key-0001',
      )?.length,
    }).toEqual({
      constants: [
        1,
        'telebirr',
        'device_bridge_no_money_v1',
        'sha256',
        'ecdsa-p256-sha256',
        'ieee-p1363-base64url',
      ],
      pairingBytes: 1313,
      pairingDigest: 'sha256:47ae515d50b403a3d37f143f9905472437748053c22f7c2e3d1de2c15d0fc1dc',
      pairingSignatureBytes: 536,
      certificateBytes: 2144,
      certificateDigest: 'sha256:ba2a812fb9c6e7b9e24d7b18df6c19e1380fc3d112f72683c2c2aa4e15c71ff2',
      certificateSignatureBytes: 562,
      payloadDigest: 'sha256:8b499950f7f43a8d382996ac279aca9bc9b64a0e5187439bf84bbc713d46cb52',
      requestBytes: 1155,
      requestDigest: 'sha256:5a6b6085adf51694fd54acc7239e90d92cf3fe00bd2c9bbc51ffd3c59d0b65aa',
      requestSignatureBytes: 536,
      acknowledgementBytes: 1271,
      acknowledgementDigest:
        'sha256:dac488e59d926e99660d622cfe9f6d00464b52e8c8454695216687a1929369b3',
      acknowledgementSignatureBytes: 559,
    });
  });

  it('rejects malformed heartbeat status instead of carrying arbitrary diagnostic text', () => {
    expect(
      decodeTelebirrDeviceBridgeHeartbeatPayload({
        runtimeState: 'ready',
        statusCode: 'contains raw reference PILOT9ABC1234',
        appVersion: '0.2.0-runtime-inert',
      }),
    ).toBeUndefined();
  });
});
