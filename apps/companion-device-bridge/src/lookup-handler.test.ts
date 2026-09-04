import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH,
  AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalCompanionHttpRequestSignatureBytes,
  canonicalKemerBetExactFiveLookupResultSignatureBytes,
  decodeSignedKemerBetExactFiveLookupAssignment,
  deriveCompanionHttpRequestReplayIdentity,
  deriveKemerBetExactFiveLookupResultReplayIdentity,
  digestCompanionEnrollmentCertificateBody,
  digestCompanionHttpRequestBody,
  digestCompanionLookupEmptyQuery,
  digestCompanionLookupPollContent,
  digestCompanionLookupResultContent,
  digestCompanionPlayerId,
  digestKemerBetExactFiveLookupResultBody,
  verifySignedKemerBetExactFiveLookupAssignment,
  type CompanionEnrollmentCertificateBody,
  type CompanionHttpRequestBody,
  type CompanionNoMoneySafety,
  type CompanionPlayerLookupResultItem,
  type KemerBetExactFiveLookupAssignmentBody,
  type KemerBetExactFiveLookupResultBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
  type SignedKemerBetExactFiveLookupAssignment,
  type SignedKemerBetExactFiveLookupResult,
} from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createCompanionLookupHandler,
  type CompanionLookupHandlerDependencies,
} from './lookup-handler.js';
import {
  createP256CompanionBridgeSigner,
  type CompanionBridgeHttpRequest,
} from './pairing-handler.js';

const assessedAt = '2026-09-05T12:00:10.000Z';
const signerKeyId = 'server-signing-key-0001';
const playerIds = ['28379330', '28379331', '28379332', '28379333', '28379334'] as const;
const safe: CompanionNoMoneySafety = Object.freeze({
  accountMutationAllowed: false,
  balanceMutationAllowed: false,
  providerMutationAllowed: false,
  paymentAllowed: false,
  depositAllowed: false,
  withdrawAllowed: false,
  transferAllowed: false,
  settlementAllowed: false,
  finalActionAllowed: false,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  transferDisabled: true,
  identifiersRedacted: true,
  moneyMoved: false,
});

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

function p1363(privateKey: KeyObject, transcript: Uint8Array): string {
  return sign('sha256', transcript, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
}

function fixture() {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
  const serverSpki = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
  const certificateBody: CompanionEnrollmentCertificateBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    certificateId: 'device-certificate-0001',
    pairingId: 'pairing-request-0001',
    pairingRequestBodyDigest: sha('1'),
    pairingNonceDigest: sha('2'),
    pairingConsumed: true,
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    devicePublicKeySpki: deviceSpki.toString('base64url'),
    devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: 'windows',
    companionVersion: '0.1.5',
    state: 'active',
    issuedAt: '2026-09-05T11:59:00.000Z',
    validFrom: '2026-09-05T11:59:00.000Z',
    validUntil: '2026-12-04T11:59:00.000Z',
    ...safe,
  });
  const certificateBodyDigest = digestCompanionEnrollmentCertificateBody(certificateBody)!;
  const certificate: SignedCompanionEnrollmentCertificate = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest: certificateBodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId,
    body: certificateBody,
    signature: p1363(
      server.privateKey,
      canonicalCompanionEnrollmentCertificateSignatureBytes(certificateBody, signerKeyId)!,
    ),
  });
  const assignmentBody: KemerBetExactFiveLookupAssignmentBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    assignmentId: 'lookup-assignment-0001',
    requestId: 'owner-lookup-request-0001',
    certificateId: certificate.body.certificateId,
    deviceId: certificate.body.deviceId,
    deviceKeyId: certificate.body.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'exact_five_player_lookup',
    lookupMode: 'find_only',
    playerIds,
    currencyCode: 'ETB',
    leaseNonceDigest: sha('3'),
    oneUse: true,
    issuedAt: '2026-09-05T12:00:01.000Z',
    expiresAt: '2026-09-05T12:05:01.000Z',
    ...safe,
  });
  const signer = createP256CompanionBridgeSigner(signerKeyId, server.privateKey, serverSpki);

  function signedHttpRequest(
    path:
      | typeof AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH
      | typeof AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
    contentDigest: string,
    requestId: string,
  ): SignedCompanionHttpRequest {
    const body: CompanionHttpRequestBody = Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      requestId,
      certificateId: certificate.body.certificateId,
      deviceId: certificate.body.deviceId,
      deviceKeyId: certificate.body.deviceKeyId,
      method: 'POST',
      canonicalPath: path,
      queryDigest: digestCompanionLookupEmptyQuery(),
      contentDigest,
      nonceDigest: sha('4'),
      issuedAt: '2026-09-05T12:00:05.000Z',
      expiresAt: '2026-09-05T12:00:35.000Z',
      ...safe,
    });
    const bodyDigest = digestCompanionHttpRequestBody(body);
    const transcript = canonicalCompanionHttpRequestSignatureBytes(body);
    if (!bodyDigest || !transcript) throw new Error('invalid synthetic HTTP request');
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      deviceKeyId: body.deviceKeyId,
      body,
      signature: p1363(device.privateKey, transcript),
    });
  }

  function pollRequest(): CompanionBridgeHttpRequest {
    const contentDigest = digestCompanionLookupPollContent(certificate.bodyDigest);
    if (!contentDigest) throw new Error('invalid synthetic poll content');
    const httpRequest = signedHttpRequest(
      AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH,
      contentDigest,
      'poll-http-request-0001',
    );
    return bridgeRequest(AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH, {
      certificate,
      httpRequest,
    });
  }

  function signedResult(
    assignment: SignedKemerBetExactFiveLookupAssignment,
    overrides: Partial<KemerBetExactFiveLookupResultBody> = {},
  ): SignedKemerBetExactFiveLookupResult {
    const outcomes = ['found', 'not_found', 'found', 'review_required', 'found'] as const;
    const items = assignment.body.playerIds.map((playerId, playerIndex) => ({
      playerIndex: playerIndex as 0 | 1 | 2 | 3 | 4,
      playerIdDigest: digestCompanionPlayerId(playerId)!,
      outcome: outcomes[playerIndex]!,
    })) as unknown as readonly [
      CompanionPlayerLookupResultItem,
      CompanionPlayerLookupResultItem,
      CompanionPlayerLookupResultItem,
      CompanionPlayerLookupResultItem,
      CompanionPlayerLookupResultItem,
    ];
    const body: KemerBetExactFiveLookupResultBody = Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      resultId: 'lookup-result-0001',
      assignmentId: assignment.body.assignmentId,
      assignmentBodyDigest: assignment.bodyDigest,
      requestId: assignment.body.requestId,
      certificateId: assignment.body.certificateId,
      deviceId: assignment.body.deviceId,
      deviceKeyId: assignment.body.deviceKeyId,
      platformCode: 'kemerbet',
      assignmentKind: 'exact_five_player_lookup',
      lookupMode: 'find_only',
      currencyCode: 'ETB',
      items,
      foundCount: 3,
      notFoundCount: 1,
      reviewRequiredCount: 1,
      observedAt: '2026-09-05T12:00:09.000Z',
      ...safe,
      ...overrides,
    });
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest: digestKemerBetExactFiveLookupResultBody(body)!,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      deviceKeyId: body.deviceKeyId,
      body,
      signature: p1363(
        device.privateKey,
        canonicalKemerBetExactFiveLookupResultSignatureBytes(body)!,
      ),
    });
  }

  function resultRequest(
    assignment: SignedKemerBetExactFiveLookupAssignment,
    result = signedResult(assignment),
  ): CompanionBridgeHttpRequest {
    const httpRequest = signedHttpRequest(
      AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH,
      digestCompanionLookupResultContent(assignment, result)!,
      'result-http-request-0001',
    );
    return bridgeRequest(AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH, {
      certificate,
      httpRequest,
      signedAssignment: assignment,
      signedResult: result,
    });
  }

  return {
    assignmentBody,
    certificate,
    pollRequest,
    resultRequest,
    signedResult,
    signer,
  };
}

function bridgeRequest(path: string, value: unknown): CompanionBridgeHttpRequest {
  return Object.freeze({
    method: 'POST',
    path,
    headers: Object.freeze([
      Object.freeze(['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE] as const),
      Object.freeze(['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE] as const),
    ]),
    body: Buffer.from(JSON.stringify(value), 'utf8'),
  });
}

function parsed(response: { readonly body: Uint8Array }): Record<string, unknown> {
  return JSON.parse(Buffer.from(response.body).toString('utf8')) as Record<string, unknown>;
}

function dependencies(
  value: ReturnType<typeof fixture>,
  overrides: Partial<CompanionLookupHandlerDependencies> = {},
): CompanionLookupHandlerDependencies {
  return {
    signer: value.signer,
    now: () => assessedAt,
    claimAssignment: vi.fn(async () => ({
      kind: 'claimed' as const,
      assignmentBody: value.assignmentBody,
    })),
    completeAssignment: vi.fn(async () => true),
    releaseAssignment: vi.fn(async () => undefined),
    acceptResult: vi.fn(async () => ({ accepted: true as const, replayed: false })),
    ...overrides,
  };
}

async function issuedAssignment(value: ReturnType<typeof fixture>) {
  const handler = createCompanionLookupHandler(dependencies(value));
  const response = await handler(value.pollRequest());
  expect(response.statusCode).toBe(200);
  return decodeSignedKemerBetExactFiveLookupAssignment(parsed(response).assignment)!;
}

describe('companion exact-five lookup handler', () => {
  it('verifies a poll, signs the exact no-money assignment, and completes it once', async () => {
    const value = fixture();
    const deps = dependencies(value);
    const response = await createCompanionLookupHandler(deps)(value.pollRequest());
    const assignment = decodeSignedKemerBetExactFiveLookupAssignment(parsed(response).assignment);

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(assignment).toBeDefined();
    expect(assignment?.body).toEqual(value.assignmentBody);
    expect(
      verifySignedKemerBetExactFiveLookupAssignment(assignment!, value.signer.publicKeySpkiDer),
    ).toBe(true);
    expect(deps.claimAssignment).toHaveBeenCalledTimes(1);
    expect(deps.completeAssignment).toHaveBeenCalledWith(assignment?.bodyDigest, assignment);
    expect(deps.releaseAssignment).not.toHaveBeenCalled();
  });

  it('returns a headerless empty 204 for no work and a fixed 409 while a claim is active', async () => {
    const value = fixture();
    const none = await createCompanionLookupHandler(
      dependencies(value, { claimAssignment: vi.fn(async () => ({ kind: 'none' as const })) }),
    )(value.pollRequest());
    expect(none).toMatchObject({ statusCode: 204 });
    expect(none.headers).not.toHaveProperty('content-type');
    expect(none.body.byteLength).toBe(0);

    const inProgress = await createCompanionLookupHandler(
      dependencies(value, {
        claimAssignment: vi.fn(async () => ({ kind: 'in_progress' as const })),
      }),
    )(value.pollRequest());
    expect(inProgress.statusCode).toBe(409);
    expect(parsed(inProgress)).toEqual({ code: 'request_in_progress' });
  });

  it('releases the exact assignment when signing produces no valid envelope', async () => {
    const value = fixture();
    const releaseAssignment = vi.fn(async () => undefined);
    const response = await createCompanionLookupHandler(
      dependencies(value, {
        signer: { ...value.signer, signP1363: async () => 'invalid' },
        releaseAssignment,
      }),
    )(value.pollRequest());
    expect(response.statusCode).toBe(503);
    expect(releaseAssignment).toHaveBeenCalledWith(value.assignmentBody.assignmentId);
  });

  it('accepts a fully bound signed result once and returns replay status without details', async () => {
    const value = fixture();
    const assignment = await issuedAssignment(value);
    const result = value.signedResult(assignment);
    const request = value.resultRequest(assignment, result);
    const acceptResult = vi.fn(
      async (..._arguments: Parameters<CompanionLookupHandlerDependencies['acceptResult']>) => ({
        accepted: true as const,
        replayed: false,
      }),
    );
    const response = await createCompanionLookupHandler(dependencies(value, { acceptResult }))(
      request,
    );

    expect(response.statusCode).toBe(201);
    expect(parsed(response)).toEqual({ accepted: true, replayed: false });
    expect(acceptResult).toHaveBeenCalledTimes(1);
    const call = acceptResult.mock.calls[0]!;
    expect(call[2]).toBe(deriveCompanionHttpRequestReplayIdentity(call[1]));
    expect(call[5]).toBe(deriveKemerBetExactFiveLookupResultReplayIdentity(result));
    expect(call[6]).toBe(assessedAt);
  });

  it('rejects a result bound to another assignment before the state boundary', async () => {
    const value = fixture();
    const assignment = await issuedAssignment(value);
    const result = value.signedResult(assignment, { assignmentId: 'lookup-assignment-0002' });
    const acceptResult = vi.fn();
    const response = await createCompanionLookupHandler(dependencies(value, { acceptResult }))(
      value.resultRequest(assignment, result),
    );
    expect(response.statusCode).toBe(401);
    expect(acceptResult).not.toHaveBeenCalled();
  });

  it('rejects altered or non-canonical authority envelopes before claiming work', async () => {
    const value = fixture();
    const claimAssignment = vi.fn();
    const handler = createCompanionLookupHandler(dependencies(value, { claimAssignment }));
    const altered = value.pollRequest();
    const alteredPayload = parsed(altered);
    const response = await handler(
      bridgeRequest(AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH, {
        ...alteredPayload,
        unexpected: true,
      }),
    );
    expect(response.statusCode).toBe(401);
    expect(claimAssignment).not.toHaveBeenCalled();

    const duplicateHeader = Object.freeze({
      ...altered,
      headers: Object.freeze([
        ...altered.headers,
        Object.freeze(['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE] as const),
      ]),
    });
    expect((await handler(duplicateHeader)).statusCode).toBe(400);
    expect(claimAssignment).not.toHaveBeenCalled();
  });
});
