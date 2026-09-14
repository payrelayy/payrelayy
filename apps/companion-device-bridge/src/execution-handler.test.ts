import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  canonicalCompanionHttpRequestSignatureBytes,
  digestCompanionEnrollmentCertificateBody,
  digestCompanionHttpRequestBody,
  digestCompanionLookupEmptyQuery,
  type CompanionEnrollmentCertificateBody,
  type CompanionHttpRequestBody,
  type CompanionNoMoneySafety,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_ACTION_KIND,
  COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
  COMPANION_EXECUTION_AUTHORITY_PATH,
  COMPANION_EXECUTION_CAPABILITY,
  COMPANION_EXECUTION_CONTRACT_VERSION,
  COMPANION_EXECUTION_CURRENCY_CODE,
  COMPANION_EXECUTION_POLL_PATH,
  COMPANION_EXECUTION_PLATFORM_CODE,
  COMPANION_EXECUTION_PROTOCOL_MODE,
  COMPANION_EXECUTION_RESULT_PATH,
  COMPANION_EXECUTION_STATUS_PATH,
  decodeSignedAuthoritativeExecutionStatus,
  decodeSignedExecutionAssignment,
  decodeSignedExecutionEnrollment,
  decodeSignedOneUseActionAuthority,
  digestCompanionExecutionAuthorityRequestContent,
  digestCompanionExecutionNonce,
  digestCompanionExecutionPlayerId,
  digestCompanionExecutionPollContent,
  digestCompanionExecutionResultContent,
  digestCompanionExecutionStatusQueryContent,
  signExecutionEnrollment,
  signExecutionResult,
  verifySignedAuthoritativeExecutionStatus,
  verifySignedExecutionAssignment,
  verifySignedExecutionEnrollment,
  verifySignedOneUseActionAuthorityCryptographically,
  type AuthoritativeExecutionStatusBody,
  type ExecutionAssignmentBody,
  type ExecutionEnrollmentBody,
  type ExecutionResultBody,
  type OneUseActionAuthorityBody,
  type SignedExecutionAssignment,
  type SignedExecutionEnrollment,
  type SignedExecutionResult,
  type SignedOneUseActionAuthority,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createCompanionExecutionHandler,
  type CompanionExecutionHandlerDependencies,
} from './execution-handler.js';
import {
  createP256CompanionBridgeSigner,
  type CompanionBridgeHttpRequest,
  type CompanionBridgeSigner,
} from './pairing-handler.js';

const NOW = '2026-09-10T12:00:06.500Z';
const PLAYER_ID = '28379330';
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

const noMoneySafety: CompanionNoMoneySafety = Object.freeze({
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

function lowS(signature: Buffer): string {
  const s = BigInt(`0x${signature.subarray(32).toString('hex')}`);
  if (s > P256_ORDER / 2n) {
    Buffer.from((P256_ORDER - s).toString(16).padStart(64, '0'), 'hex').copy(signature, 32);
  }
  return signature.toString('base64url');
}

function p1363(privateKey: KeyObject, transcript: Uint8Array): string {
  return lowS(sign('sha256', transcript, { key: privateKey, dsaEncoding: 'ieee-p1363' }));
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

function enrollmentBody(
  certificate: SignedCompanionEnrollmentCertificate,
  executionSigner: CompanionBridgeSigner,
): ExecutionEnrollmentBody {
  const spki = Buffer.from(executionSigner.publicKeySpkiDer);
  return Object.freeze({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    enrollmentId: 'execution-enrollment-0001',
    noMoneyCertificateId: certificate.body.certificateId,
    noMoneyCertificateBodyDigest: certificate.bodyDigest,
    deviceId: certificate.body.deviceId,
    deviceKeyId: certificate.body.deviceKeyId,
    devicePublicKeySpkiSha256: certificate.body.devicePublicKeySpkiSha256,
    platformAgentAccountId: 'platform-agent-account-0001',
    accountBindingCount: 1,
    platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
    pilotId: 'private-pilot-0001',
    pilotRevision: '7',
    pilotConfigDigest: sha('3'),
    amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
    currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
    maxActionsPerAssignment: 1,
    maxAssignmentLifetimeMs: 60_000,
    maxAuthorityLifetimeMs: 10_000,
    maxStatusLifetimeMs: 8_000,
    maxRoundTripTimeMs: 5_000,
    executionSignerKeyId: executionSigner.keyId,
    executionSignerPublicKeySpki: spki.toString('base64url'),
    executionSignerPublicKeySpkiSha256: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
    capabilityState: 'active',
    issuedAt: '2026-09-10T11:59:00.000Z',
    validFrom: '2026-09-10T11:59:00.000Z',
    validUntil: '2026-09-10T13:00:00.000Z',
  });
}

function assignmentBody(enrollment: SignedExecutionEnrollment): ExecutionAssignmentBody {
  return Object.freeze({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    assignmentId: 'execution-assignment-0001',
    assignmentNonceDigest: sha('4'),
    activationEpoch: '11',
    intentId: 'deposit-intent-0001',
    jobId: 'deposit-job-0001',
    attemptId: 'deposit-attempt-0001',
    platformAgentAccountId: enrollment.body.platformAgentAccountId,
    enrollmentId: enrollment.body.enrollmentId,
    enrollmentBodyDigest: enrollment.bodyDigest,
    noMoneyCertificateId: enrollment.body.noMoneyCertificateId,
    noMoneyCertificateBodyDigest: enrollment.body.noMoneyCertificateBodyDigest,
    deviceId: enrollment.body.deviceId,
    deviceKeyId: enrollment.body.deviceKeyId,
    executionSignerKeyId: enrollment.body.executionSignerKeyId,
    platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
    pilotId: enrollment.body.pilotId,
    pilotRevision: enrollment.body.pilotRevision,
    pilotConfigDigest: enrollment.body.pilotConfigDigest,
    pilotReservationId: 'pilot-reservation-0001',
    pilotReservationDigest: sha('5'),
    amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
    currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
    playerIdDigest: digestCompanionExecutionPlayerId(PLAYER_ID)!,
    oneUse: true,
    serverIssuedAt: '2026-09-10T12:00:00.000Z',
    serverNotBefore: '2026-09-10T12:00:00.000Z',
    serverValidUntil: '2026-09-10T12:01:00.000Z',
  });
}

function authorityBody(
  assignment: SignedExecutionAssignment,
  requestNonceDigest: string,
): OneUseActionAuthorityBody {
  const body = assignment.body;
  return Object.freeze({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    authorityId: 'one-use-authority-0001',
    assignmentId: body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    activationEpoch: body.activationEpoch,
    intentId: body.intentId,
    jobId: body.jobId,
    attemptId: body.attemptId,
    platformAgentAccountId: body.platformAgentAccountId,
    enrollmentId: body.enrollmentId,
    enrollmentBodyDigest: body.enrollmentBodyDigest,
    noMoneyCertificateId: body.noMoneyCertificateId,
    noMoneyCertificateBodyDigest: body.noMoneyCertificateBodyDigest,
    deviceId: body.deviceId,
    deviceKeyId: body.deviceKeyId,
    executionSignerKeyId: body.executionSignerKeyId,
    platformCode: body.platformCode,
    pilotId: body.pilotId,
    pilotRevision: body.pilotRevision,
    pilotConfigDigest: body.pilotConfigDigest,
    pilotReservationId: body.pilotReservationId,
    pilotReservationDigest: body.pilotReservationDigest,
    amountMinorUnits: body.amountMinorUnits,
    currencyCode: body.currencyCode,
    playerIdDigest: body.playerIdDigest,
    fenceId: 'database-fence-0001',
    fenceNonceDigest: sha('6'),
    databaseFenceState: 'first_fence_acquired',
    firstFenceAcquired: true,
    requestNonceDigest,
    oneUse: true,
    databaseFencedAt: '2026-09-10T12:00:04.000Z',
    databaseAuthorityIssuedAt: '2026-09-10T12:00:05.000Z',
    serverValidUntil: '2026-09-10T12:00:10.000Z',
  });
}

function resultBody(
  assignment: SignedExecutionAssignment,
  authority: SignedOneUseActionAuthority,
): ExecutionResultBody {
  const body = assignment.body;
  return Object.freeze({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    resultId: 'execution-result-0001',
    assignmentId: body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    authorityId: authority.body.authorityId,
    authorityBodyDigest: authority.bodyDigest,
    activationEpoch: body.activationEpoch,
    intentId: body.intentId,
    jobId: body.jobId,
    attemptId: body.attemptId,
    platformAgentAccountId: body.platformAgentAccountId,
    enrollmentId: body.enrollmentId,
    enrollmentBodyDigest: body.enrollmentBodyDigest,
    noMoneyCertificateId: body.noMoneyCertificateId,
    noMoneyCertificateBodyDigest: body.noMoneyCertificateBodyDigest,
    deviceId: body.deviceId,
    deviceKeyId: body.deviceKeyId,
    executionSignerKeyId: body.executionSignerKeyId,
    platformCode: body.platformCode,
    pilotId: body.pilotId,
    pilotRevision: body.pilotRevision,
    pilotConfigDigest: body.pilotConfigDigest,
    pilotReservationId: body.pilotReservationId,
    pilotReservationDigest: body.pilotReservationDigest,
    amountMinorUnits: body.amountMinorUnits,
    currencyCode: body.currencyCode,
    playerIdDigest: body.playerIdDigest,
    fenceId: authority.body.fenceId,
    fenceNonceDigest: authority.body.fenceNonceDigest,
    requestNonceDigest: authority.body.requestNonceDigest,
    outcome: 'submission_attempted',
    finalActionStarted: true,
    finalActionStartedAt: '2026-09-10T12:00:05.000Z',
    providerResponseDigest: sha('8'),
    evidenceDigest: sha('9'),
    reportedAt: '2026-09-10T12:00:06.000Z',
  });
}

function statusBody(
  assignment: SignedExecutionAssignment,
  authority: SignedOneUseActionAuthority,
  result: SignedExecutionResult,
  queryNonceDigest: string,
): AuthoritativeExecutionStatusBody {
  const body = assignment.body;
  return Object.freeze({
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    statusKind: 'authoritative_execution_status',
    grantsActionAuthority: false,
    oneUseActionAuthority: false,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    statusId: 'authoritative-status-0001',
    statusSequence: '7',
    queryNonceDigest,
    assignmentId: body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    authorityId: authority.body.authorityId,
    authorityBodyDigest: authority.bodyDigest,
    activationEpoch: body.activationEpoch,
    intentId: body.intentId,
    jobId: body.jobId,
    attemptId: body.attemptId,
    platformAgentAccountId: body.platformAgentAccountId,
    enrollmentId: body.enrollmentId,
    enrollmentBodyDigest: body.enrollmentBodyDigest,
    noMoneyCertificateId: body.noMoneyCertificateId,
    noMoneyCertificateBodyDigest: body.noMoneyCertificateBodyDigest,
    deviceId: body.deviceId,
    deviceKeyId: body.deviceKeyId,
    executionSignerKeyId: body.executionSignerKeyId,
    platformCode: body.platformCode,
    pilotId: body.pilotId,
    pilotRevision: body.pilotRevision,
    pilotConfigDigest: body.pilotConfigDigest,
    pilotReservationId: body.pilotReservationId,
    pilotReservationDigest: body.pilotReservationDigest,
    amountMinorUnits: body.amountMinorUnits,
    currencyCode: body.currencyCode,
    playerIdDigest: body.playerIdDigest,
    fenceId: authority.body.fenceId,
    databaseFenceState: 'consumed',
    databaseAttemptState: 'submission_attempted',
    databaseReconciliationState: 'succeeded',
    terminalState: 'succeeded',
    executionResultBodyDigest: result.bodyDigest,
    providerResponseDigest: result.body.providerResponseDigest,
    evidenceDigest: result.body.evidenceDigest,
    databaseObservedAt: '2026-09-10T12:00:06.000Z',
    serverIssuedAt: '2026-09-10T12:00:06.100Z',
    serverValidUntil: '2026-09-10T12:00:10.000Z',
  });
}

function fixture() {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const noMoney = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const execution = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceSpki = Buffer.from(device.publicKey.export({ format: 'der', type: 'spki' }));
  const noMoneySpki = Buffer.from(noMoney.publicKey.export({ format: 'der', type: 'spki' }));
  const executionSpki = Buffer.from(execution.publicKey.export({ format: 'der', type: 'spki' }));
  const noMoneySigner = createP256CompanionBridgeSigner(
    'read-only-signer-0001',
    noMoney.privateKey,
    noMoneySpki,
  );
  const executionSigner = createP256CompanionBridgeSigner(
    'execution-signer-0001',
    execution.privateKey,
    executionSpki,
  );
  const certificateBody: CompanionEnrollmentCertificateBody = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    certificateId: 'no-money-certificate-0001',
    pairingId: 'no-money-pairing-0001',
    pairingRequestBodyDigest: sha('1'),
    pairingNonceDigest: sha('2'),
    pairingConsumed: true,
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    devicePublicKeySpki: deviceSpki.toString('base64url'),
    devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(deviceSpki).digest('hex')}`,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: 'windows',
    companionVersion: '2.0.0',
    state: 'active',
    issuedAt: '2026-09-10T10:00:00.000Z',
    validFrom: '2026-09-10T10:00:00.000Z',
    validUntil: '2026-09-11T10:00:00.000Z',
    ...noMoneySafety,
  });
  const signerKeyId = noMoneySigner.keyId;
  const certificate: SignedCompanionEnrollmentCertificate = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest: digestCompanionEnrollmentCertificateBody(certificateBody)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId,
    body: certificateBody,
    signature: p1363(
      noMoney.privateKey,
      canonicalCompanionEnrollmentCertificateSignatureBytes(certificateBody, signerKeyId)!,
    ),
  });
  const unsignedEnrollment = enrollmentBody(certificate, executionSigner);
  const expectedEnrollment = signExecutionEnrollment(unsignedEnrollment, execution.privateKey)!;
  const unsignedAssignment = assignmentBody(expectedEnrollment);

  function signedHttpRequest(path: string, contentDigest: string, requestId: string) {
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
      nonceDigest: sha('d'),
      issuedAt: '2026-09-10T12:00:05.000Z',
      expiresAt: '2026-09-10T12:00:35.000Z',
      ...noMoneySafety,
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
    }) satisfies SignedCompanionHttpRequest;
  }

  function request(path: string, contentDigest: string, extra: Record<string, unknown>) {
    return bridgeRequest(path, {
      certificate,
      httpRequest: signedHttpRequest(path, contentDigest, `http-${path.split(':').at(-1)}`),
      ...extra,
    });
  }

  return {
    certificate,
    device,
    noMoneySigner,
    executionSigner,
    unsignedEnrollment,
    unsignedAssignment,
    pollRequest: () =>
      request(
        COMPANION_EXECUTION_POLL_PATH,
        digestCompanionExecutionPollContent(certificate.bodyDigest)!,
        {},
      ),
    request,
  };
}

function dependencies(
  value: ReturnType<typeof fixture>,
  overrides: Partial<CompanionExecutionHandlerDependencies> = {},
): CompanionExecutionHandlerDependencies {
  return {
    noMoneySigner: value.noMoneySigner,
    executionSigner: value.executionSigner,
    now: () => NOW,
    claimAssignment: vi.fn(async () => ({
      kind: 'claimed' as const,
      enrollmentBody: value.unsignedEnrollment,
      assignmentBody: value.unsignedAssignment,
      playerId: PLAYER_ID,
    })),
    completeAssignment: vi.fn(async () => true),
    claimAuthority: vi.fn(async () => ({ kind: 'in_progress' as const })),
    completeAuthority: vi.fn(async () => true),
    acceptResult: vi.fn(async () => ({ accepted: true as const, replayed: false })),
    claimStatus: vi.fn(async () => undefined),
    completeStatus: vi.fn(async () => true),
    ...overrides,
  };
}

async function issuedAssignment(
  value: ReturnType<typeof fixture>,
  deps: CompanionExecutionHandlerDependencies,
) {
  const response = await createCompanionExecutionHandler(deps)(value.pollRequest());
  expect(response.statusCode).toBe(201);
  const body = parsed(response);
  return {
    enrollment: decodeSignedExecutionEnrollment(body.enrollment)!,
    assignment: decodeSignedExecutionAssignment(body.assignment)!,
    responseBody: body,
  };
}

describe('companion financial execution bridge handler', () => {
  it('authenticates and signs the complete transport chain while status stays non-authorizing', async () => {
    const value = fixture();
    const deps = dependencies(value);
    const issued = await issuedAssignment(value, deps);
    expect(parsed(await createCompanionExecutionHandler(deps)(value.pollRequest())).code).not.toBe(
      'invalid_request',
    );
    expect(
      verifySignedExecutionEnrollment(issued.enrollment, {
        signedNoMoneyCertificate: value.certificate,
        trustedNoMoneyServerPublicKeySpkiDer: value.noMoneySigner.publicKeySpkiDer,
        trustedExecutionSignerKeyId: value.executionSigner.keyId,
        trustedExecutionSignerPublicKeySpkiDer: value.executionSigner.publicKeySpkiDer,
        expectedDeviceId: value.certificate.body.deviceId,
        expectedDeviceKeyId: value.certificate.body.deviceKeyId,
        expectedPlatformAgentAccountId: issued.assignment.body.platformAgentAccountId,
        trustedNow: NOW,
      }),
    ).toBe(true);
    expect(
      verifySignedExecutionAssignment(issued.assignment, {
        signedNoMoneyCertificate: value.certificate,
        trustedNoMoneyServerPublicKeySpkiDer: value.noMoneySigner.publicKeySpkiDer,
        trustedExecutionSignerKeyId: value.executionSigner.keyId,
        trustedExecutionSignerPublicKeySpkiDer: value.executionSigner.publicKeySpkiDer,
        expectedDeviceId: value.certificate.body.deviceId,
        expectedDeviceKeyId: value.certificate.body.deviceKeyId,
        expectedPlatformAgentAccountId: issued.assignment.body.platformAgentAccountId,
        trustedNow: NOW,
        signedExecutionEnrollment: issued.enrollment,
        roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 0 },
        consumedReplayIdentities: [],
      }),
    ).toBe(true);

    const requestNonceDigest = digestCompanionExecutionNonce(Buffer.alloc(32, 7))!;
    const claimAuthority = vi.mocked(deps.claimAuthority);
    claimAuthority.mockImplementation(async () => ({
      kind: 'claimed',
      authorityBody: authorityBody(issued.assignment, requestNonceDigest),
    }));
    const authorityRequest = value.request(
      COMPANION_EXECUTION_AUTHORITY_PATH,
      digestCompanionExecutionAuthorityRequestContent(
        issued.enrollment,
        issued.assignment,
        requestNonceDigest,
      )!,
      { enrollment: issued.enrollment, assignment: issued.assignment, requestNonceDigest },
    );
    const authorityResponse = await createCompanionExecutionHandler(deps)(authorityRequest);
    expect(authorityResponse.statusCode).toBe(201);
    const authority = decodeSignedOneUseActionAuthority(parsed(authorityResponse).authority)!;
    expect(
      verifySignedOneUseActionAuthorityCryptographically(authority, {
        signedNoMoneyCertificate: value.certificate,
        trustedNoMoneyServerPublicKeySpkiDer: value.noMoneySigner.publicKeySpkiDer,
        trustedExecutionSignerKeyId: value.executionSigner.keyId,
        trustedExecutionSignerPublicKeySpkiDer: value.executionSigner.publicKeySpkiDer,
        expectedDeviceId: value.certificate.body.deviceId,
        expectedDeviceKeyId: value.certificate.body.deviceKeyId,
        expectedPlatformAgentAccountId: issued.assignment.body.platformAgentAccountId,
        trustedNow: NOW,
        signedExecutionEnrollment: issued.enrollment,
        signedExecutionAssignment: issued.assignment,
        expectedRequestNonceDigest: requestNonceDigest,
        roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 0 },
        consumedReplayIdentities: [],
      }),
    ).toBeDefined();

    const result = signExecutionResult(
      resultBody(issued.assignment, authority),
      value.device.privateKey,
    )!;
    const resultRequest = value.request(
      COMPANION_EXECUTION_RESULT_PATH,
      digestCompanionExecutionResultContent(
        issued.enrollment,
        issued.assignment,
        authority,
        result,
      )!,
      { enrollment: issued.enrollment, assignment: issued.assignment, authority, result },
    );
    const resultResponse = await createCompanionExecutionHandler(deps)(resultRequest);
    expect(resultResponse.statusCode).toBe(201);
    expect(parsed(resultResponse)).toEqual({ accepted: true, replayed: false });

    const queryNonceDigest = digestCompanionExecutionNonce(Buffer.alloc(32, 8))!;
    vi.mocked(deps.claimStatus).mockImplementation(async () => ({
      kind: 'claimed',
      statusBody: statusBody(issued.assignment, authority, result, queryNonceDigest),
    }));
    const statusRequest = value.request(
      COMPANION_EXECUTION_STATUS_PATH,
      digestCompanionExecutionStatusQueryContent(
        issued.enrollment,
        issued.assignment,
        queryNonceDigest,
      )!,
      {
        enrollment: issued.enrollment,
        assignment: issued.assignment,
        authority,
        result,
        queryNonceDigest,
      },
    );
    const statusResponse = await createCompanionExecutionHandler(deps)(statusRequest);
    expect(statusResponse.statusCode).toBe(201);
    const status = decodeSignedAuthoritativeExecutionStatus(parsed(statusResponse).status)!;
    expect(status.body.grantsActionAuthority).toBe(false);
    expect(status.body.oneUseActionAuthority).toBe(false);
    expect(
      verifySignedAuthoritativeExecutionStatus(status, {
        signedNoMoneyCertificate: value.certificate,
        trustedNoMoneyServerPublicKeySpkiDer: value.noMoneySigner.publicKeySpkiDer,
        trustedExecutionSignerKeyId: value.executionSigner.keyId,
        trustedExecutionSignerPublicKeySpkiDer: value.executionSigner.publicKeySpkiDer,
        expectedDeviceId: value.certificate.body.deviceId,
        expectedDeviceKeyId: value.certificate.body.deviceKeyId,
        expectedPlatformAgentAccountId: issued.assignment.body.platformAgentAccountId,
        trustedNow: NOW,
        signedExecutionEnrollment: issued.enrollment,
        signedExecutionAssignment: issued.assignment,
        signedOneUseActionAuthority: authority,
        signedExecutionResult: result,
        expectedQueryNonceDigest: queryNonceDigest,
        minimumStatusSequence: '1',
        roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 0 },
        consumedReplayIdentities: [],
      }),
    ).toBe(true);
  });

  it('returns literal no-work and in-progress states without minting artifacts', async () => {
    const value = fixture();
    const none = dependencies(value, {
      claimAssignment: vi.fn(async () => ({ kind: 'none' as const })),
    });
    const noneResponse = await createCompanionExecutionHandler(none)(value.pollRequest());
    expect(noneResponse.statusCode).toBe(204);
    expect(noneResponse.body).toHaveLength(0);
    expect(none.completeAssignment).not.toHaveBeenCalled();

    const inProgress = dependencies(value, {
      claimAssignment: vi.fn(async () => ({ kind: 'in_progress' as const })),
    });
    const inProgressResponse = await createCompanionExecutionHandler(inProgress)(
      value.pollRequest(),
    );
    expect(inProgressResponse.statusCode).toBe(409);
    expect(parsed(inProgressResponse)).toEqual({ code: 'request_in_progress' });
    expect(inProgress.completeAssignment).not.toHaveBeenCalled();
  });

  it('returns the exact stored assignment chain on retry without signing a replacement', async () => {
    const value = fixture();
    const firstDeps = dependencies(value);
    const issued = await issuedAssignment(value, firstDeps);
    const completedDeps = dependencies(value, {
      claimAssignment: vi.fn(async () => ({
        kind: 'completed' as const,
        enrollment: issued.enrollment,
        assignment: issued.assignment,
        playerId: PLAYER_ID,
        authority: null,
        result: null,
      })),
    });
    const response = await createCompanionExecutionHandler(completedDeps)(value.pollRequest());
    expect(response.statusCode).toBe(200);
    expect(parsed(response)).toEqual({
      enrollment: issued.enrollment,
      assignment: issued.assignment,
      playerId: PLAYER_ID,
      authority: null,
      result: null,
    });
    expect(completedDeps.completeAssignment).not.toHaveBeenCalled();
  });

  it('rejects altered framing, content binding, certificate identity, and device results before state', async () => {
    const value = fixture();
    const deps = dependencies(value);
    const wrongHeader = {
      ...value.pollRequest(),
      headers: Object.freeze([
        Object.freeze(['content-type', 'application/json'] as const),
        Object.freeze(['accept', AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE] as const),
      ]),
    };
    expect((await createCompanionExecutionHandler(deps)(wrongHeader)).statusCode).toBe(400);

    const poll = value.pollRequest();
    const pollBody = parsed({ body: poll.body });
    const badContent = bridgeRequest(COMPANION_EXECUTION_POLL_PATH, {
      ...pollBody,
      unexpected: true,
    });
    expect((await createCompanionExecutionHandler(deps)(badContent)).statusCode).toBe(401);

    const badCertificate = bridgeRequest(COMPANION_EXECUTION_POLL_PATH, {
      ...pollBody,
      certificate: {
        ...value.certificate,
        signerKeyId: value.executionSigner.keyId,
      },
    });
    expect((await createCompanionExecutionHandler(deps)(badCertificate)).statusCode).toBe(401);
    expect(deps.claimAssignment).not.toHaveBeenCalled();

    const issued = await issuedAssignment(value, dependencies(value));
    const requestNonceDigest = digestCompanionExecutionNonce(Buffer.alloc(32, 7))!;
    const authDeps = dependencies(value, {
      claimAuthority: vi.fn(async () => ({
        kind: 'claimed' as const,
        authorityBody: authorityBody(issued.assignment, requestNonceDigest),
      })),
    });
    const authorityResponse = await createCompanionExecutionHandler(authDeps)(
      value.request(
        COMPANION_EXECUTION_AUTHORITY_PATH,
        digestCompanionExecutionAuthorityRequestContent(
          issued.enrollment,
          issued.assignment,
          requestNonceDigest,
        )!,
        { enrollment: issued.enrollment, assignment: issued.assignment, requestNonceDigest },
      ),
    );
    const authority = decodeSignedOneUseActionAuthority(parsed(authorityResponse).authority)!;
    const result = signExecutionResult(
      resultBody(issued.assignment, authority),
      value.device.privateKey,
    )!;
    const tamperedResult = {
      ...result,
      signature: `${result.signature.slice(0, -1)}${result.signature.endsWith('A') ? 'B' : 'A'}`,
    };
    const rejected = await createCompanionExecutionHandler(authDeps)(
      value.request(
        COMPANION_EXECUTION_RESULT_PATH,
        digestCompanionExecutionResultContent(
          issued.enrollment,
          issued.assignment,
          authority,
          result,
        )!,
        {
          enrollment: issued.enrollment,
          assignment: issued.assignment,
          authority,
          result: tamperedResult,
        },
      ),
    );
    expect(rejected.statusCode).toBe(401);
    expect(authDeps.acceptResult).not.toHaveBeenCalled();
  });

  it('projects dependency failures to one fixed redacted response', async () => {
    const value = fixture();
    const deps = dependencies(value, {
      claimAssignment: vi.fn(async () => {
        throw new Error('sensitive database detail');
      }),
    });
    const response = await createCompanionExecutionHandler(deps)(value.pollRequest());
    expect(response.statusCode).toBe(503);
    expect(parsed(response)).toEqual({ code: 'temporarily_unavailable' });
    expect(Buffer.from(response.body).toString('utf8')).not.toContain('sensitive');
  });
});
