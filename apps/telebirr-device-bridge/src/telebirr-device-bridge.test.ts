import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
  TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
  canonicalTelebirrDeviceBridgePairingSignatureBytes,
  canonicalTelebirrDeviceBridgeRequestSignatureBytes,
  canonicalTelebirrLivePilotAssignmentSignatureBytes,
  deriveTelebirrLivePilotReferenceBindingDigest,
  digestTelebirrDeviceBridgePairingBody,
  digestTelebirrDeviceBridgePayload,
  digestTelebirrDeviceBridgeRequestBody,
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotReceiverName,
  verifySignedTelebirrDeviceBridgeAcknowledgement,
  verifySignedTelebirrDeviceBridgeEnrollmentCertificate,
  type SignedTelebirrDeviceBridgeEnrollmentCertificate,
  type SignedTelebirrDeviceBridgePairingRequest,
  type SignedTelebirrDeviceBridgeRequest,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgeAssignmentPollPayload,
  type TelebirrDeviceBridgeHeartbeatPayload,
  type TelebirrDeviceBridgeObservationUploadPayload,
  type TelebirrDeviceBridgePairingBody,
  type TelebirrDeviceBridgeRequestBody,
  type TelebirrLivePilotAssignmentBody,
  type TelebirrLivePilotSignedAssignment,
} from '@fetanagent/telebirr-verification-foundation';

import {
  createTelebirrDeviceBridgeHandler,
  type TelebirrDeviceBridgeAssignmentPollResult,
  type TelebirrDeviceBridgeCommandResponse,
  type TelebirrDeviceBridgeDependencies,
  type TelebirrDeviceBridgeHttpRequest,
} from './telebirr-device-bridge.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
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

function signedRequest(
  device: ReturnType<typeof keyPair>,
  payload: unknown,
  overrides: Partial<TelebirrDeviceBridgeRequestBody> = {},
): SignedTelebirrDeviceBridgeRequest {
  const command = overrides.command ?? 'assignment_poll';
  const body: TelebirrDeviceBridgeRequestBody = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'device_bridge_no_money_v1',
    requestId: 'bridge-request-0001',
    enrollmentId: 'pilot-enrollment-0001',
    deviceId: 'pilot-device-0001',
    keyId: 'pilot-device-key-0001',
    command,
    method: 'POST',
    canonicalPath:
      command === 'assignment_poll'
        ? '/v1/telebirr/device/assignments:poll'
        : command === 'heartbeat'
          ? '/v1/telebirr/device/heartbeat'
          : '/v1/telebirr/device/observations:upload',
    payloadDigest: digestTelebirrDeviceBridgePayload(command, payload)!,
    nonceDigest: sha('4'),
    issuedAt: '2026-09-04T10:01:00.000Z',
    expiresAt: '2026-09-04T10:03:00.000Z',
    ...safety,
    ...overrides,
  };
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
    signature: p1363(device.privateKey, canonicalTelebirrDeviceBridgeRequestSignatureBytes(body)!),
  };
}

function liveAssignment(
  signer: ReturnType<typeof keyPair>,
  overrides: Partial<TelebirrLivePilotAssignmentBody> = {},
): TelebirrLivePilotSignedAssignment {
  const rawReference = 'PILOT9ABC1234';
  const referenceFingerprint = `hmac-sha256:${'5'.repeat(64)}`;
  const expectedReceiverNameNormalized = 'pilot receiver';
  const body: TelebirrLivePilotAssignmentBody = {
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
    expiresAt: '2026-09-04T10:03:00.000Z',
    ...overrides,
  };
  const bodyDigest = digestTelebirrLivePilotAssignmentBody(body)!;
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    transcriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: 'pilot-server-key-0001',
    body,
    signature: p1363(signer.privateKey, canonicalTelebirrLivePilotAssignmentSignatureBytes(body)!),
  };
}

function httpRequest(
  path: string,
  body: unknown,
  overrides: Partial<TelebirrDeviceBridgeHttpRequest> = {},
): TelebirrDeviceBridgeHttpRequest {
  return {
    method: 'POST',
    path,
    headers: [['content-type', TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE]],
    body: Buffer.from(JSON.stringify(body), 'utf8'),
    ...overrides,
  };
}

function json(response: { readonly body: Uint8Array }): Record<string, unknown> {
  return JSON.parse(Buffer.from(response.body).toString('utf8')) as Record<string, unknown>;
}

interface Fixture {
  readonly device: ReturnType<typeof keyPair>;
  readonly server: ReturnType<typeof keyPair>;
  readonly assignmentSigner: ReturnType<typeof keyPair>;
  readonly pairing: SignedTelebirrDeviceBridgePairingRequest;
  readonly dependencies: TelebirrDeviceBridgeDependencies;
  readonly handler: ReturnType<typeof createTelebirrDeviceBridgeHandler>;
  readonly state: {
    now: string;
    pollResult: TelebirrDeviceBridgeAssignmentPollResult;
    completed: Map<string, TelebirrDeviceBridgeCommandResponse>;
  };
  readonly spies: {
    consumePairing: ReturnType<typeof vi.fn>;
    poll: ReturnType<typeof vi.fn>;
    stage: ReturnType<typeof vi.fn>;
    heartbeat: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    nextId: ReturnType<typeof vi.fn>;
  };
}

function fixture(): Fixture {
  const device = keyPair();
  const server = keyPair();
  const assignmentSigner = keyPair();
  const pairing = signedPairing(pairingBody(device), device.privateKey);
  const state = {
    now: '2026-09-04T10:00:05.000Z',
    pollResult: { kind: 'none' } as TelebirrDeviceBridgeAssignmentPollResult,
    completed: new Map<string, TelebirrDeviceBridgeCommandResponse>(),
  };
  const consumePairing = vi.fn(
    async (_request: SignedTelebirrDeviceBridgePairingRequest, _assessedAt: string) =>
      enrollmentBody(pairing, assignmentSigner.digest),
  );
  const poll = vi.fn(
    async (
      _certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
      _request: SignedTelebirrDeviceBridgeRequest,
      _payload: TelebirrDeviceBridgeAssignmentPollPayload,
    ) => state.pollResult,
  );
  const stage = vi.fn(
    async (
      _certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
      _request: SignedTelebirrDeviceBridgeRequest,
      _payload: TelebirrDeviceBridgeObservationUploadPayload,
    ) => ({ kind: 'accepted' as const }),
  );
  const heartbeat = vi.fn(
    async (
      _certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
      _request: SignedTelebirrDeviceBridgeRequest,
      _payload: TelebirrDeviceBridgeHeartbeatPayload,
    ) => ({ kind: 'accepted' as const }),
  );
  const release = vi.fn(async (_identity: string) => undefined);
  const nextId = vi.fn(() => 'bridge-acknowledgement-0001');
  let certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate | undefined;
  const claimed = new Set<string>();
  const dependencies: TelebirrDeviceBridgeDependencies = {
    serverSigningPublicKeySpkiDer: server.spki,
    assignmentSigningPublicKeySpkiDer: assignmentSigner.spki,
    serverSigner: {
      keyId: 'bridge-server-key-0001',
      signP1363: async (transcript) => p1363(server.privateKey, transcript),
    },
    now: () => state.now,
    nextOpaqueId: nextId,
    consumePairingChallenge: async (request, assessedAt) => {
      const result = await consumePairing(request, assessedAt);
      return result as TelebirrDeviceBridgeEnrollmentCertificateBody;
    },
    loadEnrollment: async () => certificate,
    claimReplay: async (identity) => {
      const completed = state.completed.get(identity);
      if (completed) return { kind: 'completed', response: completed };
      if (claimed.has(identity)) return { kind: 'in_progress' };
      claimed.add(identity);
      return { kind: 'claimed' };
    },
    completeReplay: async (identity, response) => {
      state.completed.set(identity, response);
      return true;
    },
    releaseReplay: async (identity) => {
      claimed.delete(identity);
      await release(identity);
    },
    pollAssignment: async (...args) => poll(...args),
    recordHeartbeat: async (...args) => heartbeat(...args),
    stageEvidenceOnly: async (...args) => stage(...args),
  };
  const underlying = createTelebirrDeviceBridgeHandler(dependencies);
  const handler: typeof underlying = async (request) => {
    const response = await underlying(request);
    if (request.path === '/v1/telebirr/device/enrollments:pair' && response.statusCode === 201) {
      certificate = json(response).certificate as SignedTelebirrDeviceBridgeEnrollmentCertificate;
    }
    return response;
  };
  return {
    device,
    server,
    assignmentSigner,
    pairing,
    dependencies,
    handler,
    state,
    spies: { consumePairing, poll, stage, heartbeat, release, nextId },
  };
}

async function enroll(value: Fixture): Promise<SignedTelebirrDeviceBridgeEnrollmentCertificate> {
  const response = await value.handler(
    httpRequest('/v1/telebirr/device/enrollments:pair', value.pairing),
  );
  expect(response.statusCode).toBe(201);
  return json(response).certificate as SignedTelebirrDeviceBridgeEnrollmentCertificate;
}

describe('TeleBirr evidence-only device bridge handler', () => {
  it('consumes a one-use signed pairing challenge and returns a self-checked certificate', async () => {
    const value = fixture();
    const certificate = await enroll(value);
    expect(value.spies.consumePairing).toHaveBeenCalledOnce();
    expect(
      verifySignedTelebirrDeviceBridgeEnrollmentCertificate(certificate, value.server.spki),
    ).toBe(true);
    expect(certificate.body).toMatchObject({
      state: 'active',
      evidenceOnly: true,
      databaseAccessAllowed: false,
      settlementAllowed: false,
      financialActionAllowed: false,
      moneyMovementAllowed: false,
    });
  });

  it('authenticates a typed poll and returns a request-bound server acknowledgement', async () => {
    const value = fixture();
    await enroll(value);
    value.state.now = '2026-09-04T10:01:01.000Z';
    const payload = { requestedLeaseSeconds: 120 } as const;
    const request = signedRequest(value.device, payload);
    const response = await value.handler(
      httpRequest('/v1/telebirr/device/assignments:poll', { request, payload }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
      'x-content-type-options': 'nosniff',
    });
    const body = json(response) as unknown as TelebirrDeviceBridgeCommandResponse;
    expect(body.assignment).toBeNull();
    expect(body.acknowledgement.body).toMatchObject({
      outcome: 'no_assignment',
      requestBodyDigest: request.bodyDigest,
      requestPayloadDigest: request.body.payloadDigest,
      evidenceOnly: true,
      financialActionAllowed: false,
    });
    expect(
      verifySignedTelebirrDeviceBridgeAcknowledgement(
        body.acknowledgement,
        request,
        value.server.spki,
        value.state.now,
      ),
    ).toBe(true);
    expect(value.spies.poll).toHaveBeenCalledOnce();
  });

  it('returns the exact cached acknowledgement for an uncertain-response retry', async () => {
    const value = fixture();
    await enroll(value);
    value.state.now = '2026-09-04T10:01:01.000Z';
    const payload = { requestedLeaseSeconds: 120 } as const;
    const request = signedRequest(value.device, payload);
    const frame = { request, payload };
    const first = await value.handler(httpRequest(request.body.canonicalPath, frame));
    const second = await value.handler(httpRequest(request.body.canonicalPath, frame));
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(Buffer.from(second.body).equals(Buffer.from(first.body))).toBe(true);
    expect(value.spies.poll).toHaveBeenCalledOnce();
    expect(value.spies.nextId).toHaveBeenCalledOnce();
  });

  it('accepts only a correctly signed, certificate-bound assignment from the source', async () => {
    const value = fixture();
    await enroll(value);
    value.state.now = '2026-09-04T10:01:01.000Z';
    const assignment = liveAssignment(value.assignmentSigner);
    value.state.pollResult = { kind: 'assignment', assignment };
    const payload = { requestedLeaseSeconds: 120 } as const;
    const request = signedRequest(value.device, payload);
    const response = await value.handler(
      httpRequest(request.body.canonicalPath, { request, payload }),
    );
    expect(response.statusCode).toBe(200);
    const body = json(response) as unknown as TelebirrDeviceBridgeCommandResponse;
    expect(body.assignment).toEqual(assignment);
    expect(body.acknowledgement.body).toMatchObject({
      outcome: 'assignment',
      assignmentBodyDigest: assignment.bodyDigest,
    });
  });

  it('fails closed when an assignment source returns a wrong receiver binding', async () => {
    const value = fixture();
    await enroll(value);
    value.state.now = '2026-09-04T10:01:01.000Z';
    value.state.pollResult = {
      kind: 'assignment',
      assignment: liveAssignment(value.assignmentSigner, {
        receiverRevisionId: 'wrong-receiver-revision-0001',
      }),
    };
    const payload = { requestedLeaseSeconds: 120 } as const;
    const request = signedRequest(value.device, payload, { requestId: 'bridge-request-0002' });
    const response = await value.handler(
      httpRequest(request.body.canonicalPath, { request, payload }),
    );
    expect(response.statusCode).toBe(503);
    expect(value.spies.release).toHaveBeenCalledOnce();
    expect(Buffer.from(response.body).toString('utf8')).not.toContain('receiver');
  });

  it('rejects altered payloads before replay claim or assignment dispatch', async () => {
    const value = fixture();
    await enroll(value);
    value.state.now = '2026-09-04T10:01:01.000Z';
    const payload = { requestedLeaseSeconds: 120 } as const;
    const request = signedRequest(value.device, payload);
    const response = await value.handler(
      httpRequest(request.body.canonicalPath, {
        request,
        payload: { requestedLeaseSeconds: 121 },
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(value.spies.poll).not.toHaveBeenCalled();
    expect(value.state.completed.size).toBe(0);
  });

  it.each([
    {
      name: 'wrong method',
      override: { method: 'GET' },
    },
    {
      name: 'duplicate content type',
      override: {
        headers: [
          ['content-type', TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE],
          ['Content-Type', TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE],
        ],
      },
    },
    {
      name: 'content encoding',
      override: {
        headers: [
          ['content-type', TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE],
          ['content-encoding', 'gzip'],
        ],
      },
    },
    {
      name: 'query-bearing path',
      override: { path: '/v1/telebirr/device/assignments:poll?x=1' },
    },
  ])('rejects ambiguous HTTP framing: $name', async ({ override }) => {
    const value = fixture();
    const response = await value.handler(
      httpRequest('/v1/telebirr/device/enrollments:pair', value.pairing, {
        ...(override as Partial<TelebirrDeviceBridgeHttpRequest>),
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(value.spies.consumePairing).not.toHaveBeenCalled();
  });

  it('does not issue enrollment if the configured signer and certificate grant disagree', async () => {
    const value = fixture();
    value.spies.consumePairing.mockResolvedValue({
      ...enrollmentBody(value.pairing, value.assignmentSigner.digest),
      assignmentSignerPublicKeySpkiSha256: sha('f'),
    });
    const response = await value.handler(
      httpRequest('/v1/telebirr/device/enrollments:pair', value.pairing),
    );
    expect(response.statusCode).toBe(401);
  });

  it('contains no database, Supabase, wallet, or settlement runtime dependency', async () => {
    const source = await readFile(new URL('./telebirr-device-bridge.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(?:service_role|SUPABASE|postgres|\bpg\b|walletMutation)\b/u);
    expect(source).toContain('stageEvidenceOnly');
    expect(source).toContain('financialActionAllowed: false');
  });
});
