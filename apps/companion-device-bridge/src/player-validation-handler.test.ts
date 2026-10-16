import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH,
  AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH,
  AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalCompanionHttpRequestSignatureBytes,
  canonicalKemerBetPlayerValidationResultSignatureBytes,
  decodeSignedKemerBetPlayerValidationAssignment,
  deriveKemerBetPlayerValidationResultReplayIdentity,
  digestCompanionEnrollmentCertificateBody,
  digestCompanionHttpRequestBody,
  digestCompanionLookupEmptyQuery,
  digestCompanionPlayerId,
  digestCompanionPlayerValidationPollContent,
  digestCompanionPlayerValidationResultContent,
  digestKemerBetPlayerValidationResultBody,
  verifySignedKemerBetPlayerValidationAssignment,
  type CompanionEnrollmentCertificateBody,
  type CompanionHttpRequestBody,
  type CompanionNoMoneySafety,
  type KemerBetPlayerValidationAssignmentBody,
  type KemerBetPlayerValidationResultBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
  type SignedKemerBetPlayerValidationAssignment,
  type SignedKemerBetPlayerValidationResult,
} from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createCompanionPlayerValidationHandler,
  createDormantCompanionPlayerValidationHandler,
  type CompanionPlayerValidationHandlerDependencies,
} from './player-validation-handler.js';
import {
  createP256CompanionBridgeSigner,
  type CompanionBridgeHttpRequest,
} from './pairing-handler.js';

const assessedAt = '2026-10-16T12:00:10.000Z';
const signerKeyId = 'server-signing-key-0001';
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
    companionVersion: '0.1.47',
    state: 'active',
    issuedAt: '2026-10-16T11:59:00.000Z',
    validFrom: '2026-10-16T11:59:00.000Z',
    validUntil: '2027-01-14T11:59:00.000Z',
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
  const assignmentBody: KemerBetPlayerValidationAssignmentBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    assignmentId: 'validation-assignment-0001',
    validationRequestId: 'telegram-validation-request-0001',
    certificateId: certificate.body.certificateId,
    deviceId: certificate.body.deviceId,
    deviceKeyId: certificate.body.deviceKeyId,
    platformCode: 'kemerbet',
    assignmentKind: 'single_telegram_player_validation',
    lookupMode: 'find_only',
    playerId: '28379330',
    currencyCode: 'ETB',
    leaseNonceDigest: sha('3'),
    oneUse: true,
    issuedAt: '2026-10-16T12:00:01.000Z',
    expiresAt: '2026-10-16T12:05:01.000Z',
    ...safe,
  });
  const signer = createP256CompanionBridgeSigner(signerKeyId, server.privateKey, serverSpki);

  function signedHttpRequest(
    path:
      | typeof AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH
      | typeof AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH,
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
      issuedAt: '2026-10-16T12:00:05.000Z',
      expiresAt: '2026-10-16T12:00:35.000Z',
      ...safe,
    });
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest: digestCompanionHttpRequestBody(body)!,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      deviceKeyId: body.deviceKeyId,
      body,
      signature: p1363(device.privateKey, canonicalCompanionHttpRequestSignatureBytes(body)!),
    });
  }

  function pollRequest(): CompanionBridgeHttpRequest {
    const httpRequest = signedHttpRequest(
      AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH,
      digestCompanionPlayerValidationPollContent(certificate.bodyDigest)!,
      'validation-poll-http-0001',
    );
    return bridgeRequest(AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_POLL_PATH, {
      certificate,
      httpRequest,
    });
  }

  function signedResult(
    assignment: SignedKemerBetPlayerValidationAssignment,
    outcome: 'found' | 'review_required' = 'found',
    overrides: Partial<KemerBetPlayerValidationResultBody> = {},
  ): SignedKemerBetPlayerValidationResult {
    const body: KemerBetPlayerValidationResultBody = Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      resultId: 'validation-result-0001',
      assignmentId: assignment.body.assignmentId,
      assignmentBodyDigest: assignment.bodyDigest,
      validationRequestId: assignment.body.validationRequestId,
      certificateId: assignment.body.certificateId,
      deviceId: assignment.body.deviceId,
      deviceKeyId: assignment.body.deviceKeyId,
      platformCode: 'kemerbet',
      assignmentKind: 'single_telegram_player_validation',
      lookupMode: 'find_only',
      currencyCode: 'ETB',
      playerIdDigest: digestCompanionPlayerId(assignment.body.playerId)!,
      outcome,
      evidenceKind: outcome === 'found' ? 'exact_id_empty_etb_form' : 'inconclusive',
      observedAt: '2026-10-16T12:00:09.000Z',
      ...safe,
      ...overrides,
    });
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest: digestKemerBetPlayerValidationResultBody(body)!,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      deviceKeyId: body.deviceKeyId,
      body,
      signature: p1363(
        device.privateKey,
        canonicalKemerBetPlayerValidationResultSignatureBytes(body)!,
      ),
    });
  }

  function resultRequest(
    assignment: SignedKemerBetPlayerValidationAssignment,
    result = signedResult(assignment),
  ): CompanionBridgeHttpRequest {
    const httpRequest = signedHttpRequest(
      AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH,
      digestCompanionPlayerValidationResultContent(assignment, result)!,
      'validation-result-http-0001',
    );
    return bridgeRequest(AGENT_PLATFORM_COMPANION_PLAYER_VALIDATION_RESULT_PATH, {
      certificate,
      httpRequest,
      signedAssignment: assignment,
      signedResult: result,
    });
  }
  return { assignmentBody, certificate, pollRequest, resultRequest, signedResult, signer };
}

function dependencies(
  value: ReturnType<typeof fixture>,
  overrides: Partial<CompanionPlayerValidationHandlerDependencies> = {},
): CompanionPlayerValidationHandlerDependencies {
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
  const response = await createCompanionPlayerValidationHandler(dependencies(value))(
    value.pollRequest(),
  );
  expect(response.statusCode).toBe(200);
  return decodeSignedKemerBetPlayerValidationAssignment(parsed(response).assignment)!;
}

describe('Telegram Player validation bridge handler (dormant)', () => {
  it('returns only a fixed unavailable response until a state boundary is wired', async () => {
    const value = fixture();
    const response = await createDormantCompanionPlayerValidationHandler()(value.pollRequest());
    expect(response.statusCode).toBe(503);
    expect(parsed(response)).toEqual({ code: 'temporarily_unavailable' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('verifies the paired poll and signs exactly one read-only Player-ID assignment', async () => {
    const value = fixture();
    const deps = dependencies(value);
    const response = await createCompanionPlayerValidationHandler(deps)(value.pollRequest());
    const assignment = decodeSignedKemerBetPlayerValidationAssignment(parsed(response).assignment);
    expect(response.statusCode).toBe(200);
    expect(assignment?.body).toEqual(value.assignmentBody);
    expect(
      verifySignedKemerBetPlayerValidationAssignment(assignment!, value.signer.publicKeySpkiDer),
    ).toBe(true);
    expect(deps.claimAssignment).toHaveBeenCalledTimes(1);
    expect(deps.completeAssignment).toHaveBeenCalledWith(assignment?.bodyDigest, assignment);
  });

  it('returns no assignment and in-progress without exposing the requested Player ID', async () => {
    const value = fixture();
    const none = await createCompanionPlayerValidationHandler(
      dependencies(value, { claimAssignment: vi.fn(async () => ({ kind: 'none' as const })) }),
    )(value.pollRequest());
    expect(none.statusCode).toBe(204);
    expect(none.body.byteLength).toBe(0);
    expect(none.headers).not.toHaveProperty('content-type');
    const inProgress = await createCompanionPlayerValidationHandler(
      dependencies(value, {
        claimAssignment: vi.fn(async () => ({ kind: 'in_progress' as const })),
      }),
    )(value.pollRequest());
    expect(inProgress.statusCode).toBe(409);
    expect(parsed(inProgress)).toEqual({ code: 'request_in_progress' });
  });

  it.each(['found', 'review_required'] as const)(
    'verifies a paired %s result and delegates replay/current-request checks to the state boundary',
    async (outcome) => {
      const value = fixture();
      const assignment = await issuedAssignment(value);
      const result = value.signedResult(assignment, outcome);
      const acceptResult = vi.fn(
        async (
          ..._args: Parameters<CompanionPlayerValidationHandlerDependencies['acceptResult']>
        ) => ({ accepted: true as const, replayed: false }),
      );
      const response = await createCompanionPlayerValidationHandler(
        dependencies(value, { acceptResult }),
      )(value.resultRequest(assignment, result));
      expect(response.statusCode).toBe(201);
      expect(parsed(response)).toEqual({ accepted: true, replayed: false });
      expect(acceptResult).toHaveBeenCalledTimes(1);
      expect(acceptResult.mock.calls[0]?.[5]).toBe(
        deriveKemerBetPlayerValidationResultReplayIdentity(result),
      );
    },
  );

  it('rejects a result for a different Player ID before the state boundary', async () => {
    const value = fixture();
    const assignment = await issuedAssignment(value);
    const result = value.signedResult(assignment, 'found', { playerIdDigest: sha('f') });
    const acceptResult = vi.fn();
    const response = await createCompanionPlayerValidationHandler(
      dependencies(value, { acceptResult }),
    )(value.resultRequest(assignment, result));
    expect(response.statusCode).toBe(401);
    expect(acceptResult).not.toHaveBeenCalled();
  });

  it('rejects unexpected fields and duplicate headers before claiming an assignment', async () => {
    const value = fixture();
    const claimAssignment = vi.fn();
    const handler = createCompanionPlayerValidationHandler(
      dependencies(value, { claimAssignment }),
    );
    const poll = value.pollRequest();
    expect(
      (await handler(bridgeRequest(poll.path, { ...parsed(poll), amount: 100 }))).statusCode,
    ).toBe(401);
    expect(
      (
        await handler({
          ...poll,
          headers: [
            ...poll.headers,
            ['content-type', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE],
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(claimAssignment).not.toHaveBeenCalled();
  });

  it('fails closed if signing fails and releases only its exact claim', async () => {
    const value = fixture();
    const releaseAssignment = vi.fn(async () => undefined);
    const response = await createCompanionPlayerValidationHandler(
      dependencies(value, {
        signer: { ...value.signer, signP1363: async () => 'invalid' },
        releaseAssignment,
      }),
    )(value.pollRequest());
    expect(response.statusCode).toBe(503);
    expect(releaseAssignment).toHaveBeenCalledWith(value.assignmentBody.assignmentId);
  });
});
