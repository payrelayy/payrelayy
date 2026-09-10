import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionEnrollmentCertificateSignatureBytes,
  digestCompanionEnrollmentCertificateBody,
  type CompanionEnrollmentCertificateBody,
  type CompanionNoMoneySafety,
  type SignedCompanionEnrollmentCertificate,
} from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it } from 'vitest';

import {
  COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT,
  COMPANION_EXECUTION_ACTION_KIND,
  COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
  COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT,
  COMPANION_EXECUTION_CAPABILITY,
  COMPANION_EXECUTION_CONTRACT_VERSION,
  COMPANION_EXECUTION_CURRENCY_CODE,
  COMPANION_EXECUTION_DIGEST_ALGORITHM,
  COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT,
  COMPANION_EXECUTION_PLATFORM_CODE,
  COMPANION_EXECUTION_PROTOCOL_MODE,
  COMPANION_EXECUTION_RESULT_TRANSCRIPT,
  COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
  COMPANION_EXECUTION_SIGNATURE_ENCODING,
  COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT,
  canonicalAuthoritativeExecutionStatusBodyBytes,
  canonicalExecutionAssignmentBodyBytes,
  canonicalExecutionEnrollmentBodyBytes,
  canonicalExecutionResultBodyBytes,
  canonicalOneUseActionAuthorityBodyBytes,
  decodeAuthoritativeExecutionStatusBody,
  decodeExecutionAssignmentBody,
  decodeExecutionEnrollmentBody,
  decodeExecutionResultBody,
  decodeOneUseActionAuthorityBody,
  decodeSignedAuthoritativeExecutionStatus,
  decodeSignedExecutionAssignment,
  decodeSignedExecutionEnrollment,
  decodeSignedExecutionResult,
  decodeSignedOneUseActionAuthority,
  deriveAuthoritativeExecutionStatusReplayIdentity,
  deriveExecutionAssignmentReplayIdentity,
  deriveExecutionResultReplayIdentity,
  deriveOneUseActionAuthorityReplayIdentity,
  digestAuthoritativeExecutionStatusBody,
  digestCompanionExecutionNonce,
  digestCompanionExecutionPlayerId,
  digestExecutionAssignmentBody,
  digestExecutionEnrollmentBody,
  digestExecutionResultBody,
  digestOneUseActionAuthorityBody,
  signAuthoritativeExecutionStatus,
  signExecutionAssignment,
  signExecutionEnrollment,
  signExecutionResult,
  signOneUseActionAuthority,
  verifySignedAuthoritativeExecutionStatus,
  verifySignedExecutionAssignment,
  verifySignedExecutionEnrollment,
  verifySignedExecutionResult,
  verifySignedOneUseActionAuthority,
  type AuthoritativeExecutionStatusBody,
  type AuthoritativeExecutionStatusVerificationContext,
  type ExecutionAssignmentBody,
  type ExecutionAssignmentVerificationContext,
  type ExecutionEnrollmentBody,
  type ExecutionResultBody,
  type ExecutionResultVerificationContext,
  type OneUseActionAuthorityBody,
  type OneUseActionAuthorityVerificationContext,
  type SignedAuthoritativeExecutionStatus,
  type SignedExecutionAssignment,
  type SignedExecutionEnrollment,
  type SignedExecutionResult,
  type SignedOneUseActionAuthority,
  type TrustedExecutionIdentityContext,
} from './index.js';

interface KeyFixture {
  readonly privateKey: KeyObject;
  readonly spki: Buffer;
  readonly encodedSpki: string;
  readonly digest: string;
}

function keyPair(namedCurve = 'prime256v1'): KeyFixture {
  const pair = generateKeyPairSync('ec', { namedCurve });
  const spki = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
  return {
    privateKey: pair.privateKey,
    spki,
    encodedSpki: spki.toString('base64url'),
    digest: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
  };
}

const sha = (value: string): string => `sha256:${value.repeat(64)}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const NOW = '2026-09-10T12:00:06.500Z';

const noMoneySafety: CompanionNoMoneySafety = {
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
};

interface Fixture {
  readonly noMoneyServer: KeyFixture;
  readonly executionSigner: KeyFixture;
  readonly device: KeyFixture;
  readonly certificate: SignedCompanionEnrollmentCertificate;
  readonly enrollment: SignedExecutionEnrollment;
  readonly assignment: SignedExecutionAssignment;
  readonly authority: SignedOneUseActionAuthority;
  readonly result: SignedExecutionResult;
  readonly status: SignedAuthoritativeExecutionStatus;
  readonly identity: TrustedExecutionIdentityContext;
  readonly assignmentContext: ExecutionAssignmentVerificationContext;
  readonly authorityContext: OneUseActionAuthorityVerificationContext;
  readonly resultContext: ExecutionResultVerificationContext;
  readonly statusContext: AuthoritativeExecutionStatusVerificationContext;
}

function signedNoMoneyCertificate(
  noMoneyServer: KeyFixture,
  device: KeyFixture,
  overrides: Partial<CompanionEnrollmentCertificateBody> = {},
): SignedCompanionEnrollmentCertificate {
  const body: CompanionEnrollmentCertificateBody = {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    certificateId: 'no-money-certificate-0001',
    pairingId: 'no-money-pairing-0001',
    pairingRequestBodyDigest: sha('1'),
    pairingNonceDigest: sha('2'),
    pairingConsumed: true,
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    devicePublicKeySpki: device.encodedSpki,
    devicePublicKeySpkiSha256: device.digest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: 'windows',
    companionVersion: '2.0.0',
    state: 'active',
    issuedAt: '2026-09-10T10:00:00.000Z',
    validFrom: '2026-09-10T10:00:00.000Z',
    validUntil: '2026-09-11T10:00:00.000Z',
    ...noMoneySafety,
    ...overrides,
  };
  const signerKeyId = 'read-only-signer-0001';
  return {
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest: digestCompanionEnrollmentCertificateBody(body)!,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    signerKeyId,
    body,
    signature: sign(
      'sha256',
      canonicalCompanionEnrollmentCertificateSignatureBytes(body, signerKeyId)!,
      { key: noMoneyServer.privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url'),
  };
}

function enrollmentBody(
  certificate: SignedCompanionEnrollmentCertificate,
  executionSigner: KeyFixture,
  overrides: Partial<ExecutionEnrollmentBody> = {},
): ExecutionEnrollmentBody {
  return {
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
    executionSignerKeyId: 'execution-signer-0001',
    executionSignerPublicKeySpki: executionSigner.encodedSpki,
    executionSignerPublicKeySpkiSha256: executionSigner.digest,
    capabilityState: 'active',
    issuedAt: '2026-09-10T11:59:00.000Z',
    validFrom: '2026-09-10T11:59:00.000Z',
    validUntil: '2026-09-10T13:00:00.000Z',
    ...overrides,
  };
}

function assignmentBody(
  enrollment: SignedExecutionEnrollment,
  overrides: Partial<ExecutionAssignmentBody> = {},
): ExecutionAssignmentBody {
  return {
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
    playerIdDigest: digestCompanionExecutionPlayerId('28379330')!,
    oneUse: true,
    serverIssuedAt: '2026-09-10T12:00:00.000Z',
    serverNotBefore: '2026-09-10T12:00:00.000Z',
    serverValidUntil: '2026-09-10T12:01:00.000Z',
    ...overrides,
  };
}

function authorityBody(
  assignment: SignedExecutionAssignment,
  overrides: Partial<OneUseActionAuthorityBody> = {},
): OneUseActionAuthorityBody {
  const body = assignment.body;
  return {
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
    requestNonceDigest: sha('7'),
    oneUse: true,
    databaseFencedAt: '2026-09-10T12:00:04.000Z',
    databaseAuthorityIssuedAt: '2026-09-10T12:00:04.100Z',
    serverValidUntil: '2026-09-10T12:00:10.000Z',
    ...overrides,
  };
}

function resultBody(
  assignment: SignedExecutionAssignment,
  authority: SignedOneUseActionAuthority | null,
  overrides: Partial<ExecutionResultBody> = {},
): ExecutionResultBody {
  const body = assignment.body;
  return {
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    resultId: 'execution-result-0001',
    assignmentId: body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    authorityId: authority?.body.authorityId ?? null,
    authorityBodyDigest: authority?.bodyDigest ?? null,
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
    fenceId: authority?.body.fenceId ?? null,
    fenceNonceDigest: authority?.body.fenceNonceDigest ?? null,
    requestNonceDigest: authority?.body.requestNonceDigest ?? null,
    outcome: authority ? 'submission_attempted' : 'refused_before_fence',
    finalActionStarted: authority !== null,
    providerResponseDigest: authority ? sha('8') : null,
    evidenceDigest: sha('9'),
    deviceObservedAt: '2026-09-10T12:00:06.000Z',
    ...overrides,
  };
}

function statusBody(
  assignment: SignedExecutionAssignment,
  authority: SignedOneUseActionAuthority | null,
  result: SignedExecutionResult | null,
  overrides: Partial<AuthoritativeExecutionStatusBody> = {},
): AuthoritativeExecutionStatusBody {
  const body = assignment.body;
  return {
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    statusKind: 'authoritative_execution_status',
    grantsActionAuthority: false,
    oneUseActionAuthority: false,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    statusId: 'authoritative-status-0001',
    statusSequence: '7',
    queryNonceDigest: sha('a'),
    assignmentId: body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    authorityId: authority?.body.authorityId ?? null,
    authorityBodyDigest: authority?.bodyDigest ?? null,
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
    fenceId: authority?.body.fenceId ?? null,
    databaseFenceState: authority ? 'consumed' : 'not_acquired',
    databaseAttemptState: authority ? 'submission_attempted' : 'refused_before_fence',
    databaseReconciliationState: authority ? 'succeeded' : 'not_required',
    terminalState: authority ? 'succeeded' : 'refused',
    executionResultBodyDigest: result?.bodyDigest ?? null,
    providerResponseDigest: result?.body.providerResponseDigest ?? null,
    evidenceDigest: result?.body.evidenceDigest ?? null,
    databaseObservedAt: '2026-09-10T12:00:06.000Z',
    serverIssuedAt: '2026-09-10T12:00:06.100Z',
    serverValidUntil: '2026-09-10T12:00:10.000Z',
    ...overrides,
  };
}

function fixture(): Fixture {
  const noMoneyServer = keyPair();
  const executionSigner = keyPair();
  const device = keyPair();
  const certificate = signedNoMoneyCertificate(noMoneyServer, device);
  const enrollment = signExecutionEnrollment(
    enrollmentBody(certificate, executionSigner),
    executionSigner.privateKey,
  )!;
  const assignment = signExecutionAssignment(
    assignmentBody(enrollment),
    executionSigner.privateKey,
  )!;
  const authority = signOneUseActionAuthority(
    authorityBody(assignment),
    executionSigner.privateKey,
  )!;
  const result = signExecutionResult(resultBody(assignment, authority), device.privateKey)!;
  const status = signAuthoritativeExecutionStatus(
    statusBody(assignment, authority, result),
    executionSigner.privateKey,
  )!;
  const identity: TrustedExecutionIdentityContext = {
    signedNoMoneyCertificate: certificate,
    trustedNoMoneyServerPublicKeySpkiDer: noMoneyServer.spki,
    trustedExecutionSignerKeyId: enrollment.body.executionSignerKeyId,
    trustedExecutionSignerPublicKeySpkiDer: executionSigner.spki,
    expectedDeviceId: enrollment.body.deviceId,
    expectedDeviceKeyId: enrollment.body.deviceKeyId,
    expectedPlatformAgentAccountId: enrollment.body.platformAgentAccountId,
    trustedNow: NOW,
  };
  const assignmentContext: ExecutionAssignmentVerificationContext = {
    ...identity,
    signedExecutionEnrollment: enrollment,
    roundTrip: { monotonicRequestStartedMs: 1_000, monotonicResponseReceivedMs: 3_000 },
  };
  const authorityContext: OneUseActionAuthorityVerificationContext = {
    ...identity,
    signedExecutionEnrollment: enrollment,
    signedExecutionAssignment: assignment,
    expectedRequestNonceDigest: authority.body.requestNonceDigest,
    roundTrip: { monotonicRequestStartedMs: 1_000, monotonicResponseReceivedMs: 3_000 },
  };
  const resultContext: ExecutionResultVerificationContext = {
    ...identity,
    signedExecutionEnrollment: enrollment,
    signedExecutionAssignment: assignment,
    signedOneUseActionAuthority: authority,
  };
  const statusContext: AuthoritativeExecutionStatusVerificationContext = {
    ...identity,
    signedExecutionEnrollment: enrollment,
    signedExecutionAssignment: assignment,
    signedOneUseActionAuthority: authority,
    signedExecutionResult: result,
    expectedQueryNonceDigest: status.body.queryNonceDigest,
    minimumStatusSequence: status.body.statusSequence,
    roundTrip: { monotonicRequestStartedMs: 1_000, monotonicResponseReceivedMs: 3_000 },
  };
  return {
    noMoneyServer,
    executionSigner,
    device,
    certificate,
    enrollment,
    assignment,
    authority,
    result,
    status,
    identity,
    assignmentContext,
    authorityContext,
    resultContext,
    statusContext,
  };
}

describe('dormant companion execution v2 contracts', () => {
  it('signs, decodes, and verifies the complete five-artifact chain', () => {
    const value = fixture();
    expect(verifySignedExecutionEnrollment(value.enrollment, value.identity)).toBe(true);
    expect(verifySignedExecutionAssignment(value.assignment, value.assignmentContext)).toBe(true);
    expect(verifySignedOneUseActionAuthority(value.authority, value.authorityContext)).toBe(true);
    expect(verifySignedExecutionResult(value.result, value.resultContext)).toBe(true);
    expect(verifySignedAuthoritativeExecutionStatus(value.status, value.statusContext)).toBe(true);
    expect(decodeSignedOneUseActionAuthority(value.status)).toBeUndefined();
    expect(decodeOneUseActionAuthorityBody(value.status.body)).toBeUndefined();
    expect(value.status.body.grantsActionAuthority).toBe(false);
    expect(value.status.body.oneUseActionAuthority).toBe(false);
  });

  it('uses canonical unpadded P1363 signatures and five distinct domains', () => {
    const value = fixture();
    const artifacts = [
      value.enrollment,
      value.assignment,
      value.authority,
      value.result,
      value.status,
    ];
    for (const artifact of artifacts) {
      expect(artifact.signature).toMatch(/^[A-Za-z0-9_-]{86}$/u);
      expect(artifact.signature).not.toContain('=');
      expect(Buffer.from(artifact.signature, 'base64url')).toHaveLength(64);
    }
    expect(
      new Set([
        COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT,
        COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT,
        COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT,
        COMPANION_EXECUTION_RESULT_TRANSCRIPT,
        COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT,
      ]).size,
    ).toBe(5);
    const bodyDigests = [
      digestExecutionEnrollmentBody(value.enrollment.body),
      digestExecutionAssignmentBody(value.assignment.body),
      digestOneUseActionAuthorityBody(value.authority.body),
      digestExecutionResultBody(value.result.body),
      digestAuthoritativeExecutionStatusBody(value.status.body),
    ];
    expect(new Set(bodyDigests).size).toBe(5);
  });

  it('rejects unknown, missing, accessor, proxy, and type-confused body input', () => {
    const value = fixture();
    const cases: readonly [unknown, (candidate: unknown) => unknown, string][] = [
      [value.enrollment.body, decodeExecutionEnrollmentBody, 'enrollmentId'],
      [value.assignment.body, decodeExecutionAssignmentBody, 'assignmentId'],
      [value.authority.body, decodeOneUseActionAuthorityBody, 'authorityId'],
      [value.result.body, decodeExecutionResultBody, 'resultId'],
      [value.status.body, decodeAuthoritativeExecutionStatusBody, 'statusId'],
    ];
    for (const [body, decoder, requiredKey] of cases) {
      const extra = { ...(clone(body) as Record<string, unknown>), unexpected: true };
      const missing = clone(body) as Record<string, unknown>;
      delete missing[requiredKey];
      const accessor = clone(body) as Record<string, unknown>;
      Object.defineProperty(accessor, requiredKey, { enumerable: true, get: () => 'accessed' });
      const throwingProxy = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('must be caught');
          },
        },
      );
      for (const hostile of [extra, missing, accessor, throwingProxy, null, false, [], 'body']) {
        expect(decoder(hostile)).toBeUndefined();
      }
    }
  });

  it('rejects padded signatures, noncanonical digests, and cross-protocol envelopes', () => {
    const value = fixture();
    const envelopeCases: readonly [Record<string, unknown>, (candidate: unknown) => unknown][] = [
      [
        clone(value.enrollment) as unknown as Record<string, unknown>,
        decodeSignedExecutionEnrollment,
      ],
      [
        clone(value.assignment) as unknown as Record<string, unknown>,
        decodeSignedExecutionAssignment,
      ],
      [
        clone(value.authority) as unknown as Record<string, unknown>,
        decodeSignedOneUseActionAuthority,
      ],
      [clone(value.result) as unknown as Record<string, unknown>, decodeSignedExecutionResult],
      [
        clone(value.status) as unknown as Record<string, unknown>,
        decodeSignedAuthoritativeExecutionStatus,
      ],
    ];
    for (const [envelope, decoder] of envelopeCases) {
      expect(decoder({ ...envelope, signature: `${String(envelope.signature)}=` })).toBeUndefined();
      expect(decoder({ ...envelope, bodyDigest: `sha256:${'A'.repeat(64)}` })).toBeUndefined();
      expect(decoder({ ...envelope, unexpected: true })).toBeUndefined();
      expect(decoder({ ...envelope, transcriptVersion: 'another-protocol-v2' })).toBeUndefined();
    }
    expect(decodeSignedExecutionAssignment(value.authority)).toBeUndefined();
    expect(decodeSignedOneUseActionAuthority(value.assignment)).toBeUndefined();
    expect(decodeSignedAuthoritativeExecutionStatus(value.authority)).toBeUndefined();
    expect(decodeSignedExecutionResult(value.status)).toBeUndefined();
  });

  it('requires an explicitly distinct execution signer trust upgrade', () => {
    const value = fixture();
    const sameKeyBody = enrollmentBody(value.certificate, value.noMoneyServer);
    const sameKeyEnrollment = signExecutionEnrollment(sameKeyBody, value.noMoneyServer.privateKey)!;
    expect(
      verifySignedExecutionEnrollment(sameKeyEnrollment, {
        ...value.identity,
        trustedExecutionSignerPublicKeySpkiDer: value.noMoneyServer.spki,
      }),
    ).toBe(false);

    const reusedIdBody = enrollmentBody(value.certificate, value.executionSigner, {
      executionSignerKeyId: value.certificate.signerKeyId,
    });
    const reusedIdEnrollment = signExecutionEnrollment(
      reusedIdBody,
      value.executionSigner.privateKey,
    )!;
    expect(
      verifySignedExecutionEnrollment(reusedIdEnrollment, {
        ...value.identity,
        trustedExecutionSignerKeyId: value.certificate.signerKeyId,
      }),
    ).toBe(false);

    const tamperedCertificate = {
      ...clone(value.certificate),
      signature: `${value.certificate.signature.slice(0, -1)}${
        value.certificate.signature.endsWith('A') ? 'B' : 'A'
      }`,
    };
    expect(
      verifySignedExecutionEnrollment(value.enrollment, {
        ...value.identity,
        signedNoMoneyCertificate: tamperedCertificate,
      }),
    ).toBe(false);
  });

  it('rejects padded execution public keys and non-P256 signing keys', () => {
    const value = fixture();
    expect(
      decodeExecutionEnrollmentBody({
        ...value.enrollment.body,
        executionSignerPublicKeySpki: `${value.enrollment.body.executionSignerPublicKeySpki}=`,
      }),
    ).toBeUndefined();
    const wrongCurve = keyPair('secp384r1');
    expect(signExecutionAssignment(value.assignment.body, wrongCurve.privateKey)).toBeUndefined();
    expect(signExecutionResult(value.result.body, wrongCurve.privateKey)).toBeUndefined();
  });

  it('binds assignments to the exact epoch, intent, attempt, account, pilot, reservation, player, and enrollment', () => {
    const value = fixture();
    const mutations: readonly [string, unknown][] = [
      ['activationEpoch', '12'],
      ['intentId', 'deposit-intent-9999'],
      ['jobId', 'deposit-job-9999'],
      ['attemptId', 'deposit-attempt-9999'],
      ['platformAgentAccountId', 'platform-agent-account-9999'],
      ['enrollmentId', 'execution-enrollment-9999'],
      ['enrollmentBodyDigest', sha('b')],
      ['noMoneyCertificateId', 'no-money-certificate-9999'],
      ['noMoneyCertificateBodyDigest', sha('c')],
      ['deviceId', 'windows-device-9999'],
      ['deviceKeyId', 'windows-device-key-9999'],
      ['pilotId', 'private-pilot-9999'],
      ['pilotRevision', '8'],
      ['pilotConfigDigest', sha('d')],
      ['pilotReservationId', 'pilot-reservation-9999'],
      ['pilotReservationDigest', sha('e')],
      ['playerIdDigest', sha('f')],
      ['amountMinorUnits', 2_499],
      ['currencyCode', 'USD'],
    ];
    for (const [field, replacement] of mutations) {
      const signed = clone(value.assignment) as unknown as Record<string, unknown>;
      signed.body = { ...value.assignment.body, [field]: replacement };
      expect(verifySignedExecutionAssignment(signed, value.assignmentContext), field).toBe(false);
    }
    for (const [field, replacement] of mutations.filter(([field]) =>
      [
        'platformAgentAccountId',
        'enrollmentId',
        'enrollmentBodyDigest',
        'noMoneyCertificateId',
        'noMoneyCertificateBodyDigest',
        'deviceId',
        'deviceKeyId',
        'pilotId',
        'pilotRevision',
        'pilotConfigDigest',
        'amountMinorUnits',
        'currencyCode',
      ].includes(field),
    )) {
      const resigned = signExecutionAssignment(
        { ...value.assignment.body, [field]: replacement },
        value.executionSigner.privateKey,
      );
      expect(
        resigned && verifySignedExecutionAssignment(resigned, value.assignmentContext),
        `resigned ${field}`,
      ).not.toBe(true);
    }
  });

  it('enforces assignment TTL, trusted receipt time, RTT, identity, and replay', () => {
    const value = fixture();
    const overEnrollmentLimit = signExecutionAssignment(
      assignmentBody(value.enrollment, {
        serverValidUntil: '2026-09-10T12:01:30.000Z',
      }),
      value.executionSigner.privateKey,
    )!;
    expect(decodeSignedExecutionAssignment(overEnrollmentLimit)).toBeDefined();
    expect(verifySignedExecutionAssignment(overEnrollmentLimit, value.assignmentContext)).toBe(
      false,
    );
    expect(
      decodeExecutionAssignmentBody({
        ...value.assignment.body,
        serverValidUntil: '2026-09-10T12:02:01.000Z',
      }),
    ).toBeUndefined();
    expect(
      verifySignedExecutionAssignment(value.assignment, {
        ...value.assignmentContext,
        trustedNow: value.assignment.body.serverValidUntil,
      }),
    ).toBe(false);
    expect(
      verifySignedExecutionAssignment(value.assignment, {
        ...value.assignmentContext,
        roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 5_001 },
      }),
    ).toBe(false);
    expect(
      verifySignedExecutionAssignment(value.assignment, {
        ...value.assignmentContext,
        expectedPlatformAgentAccountId: 'platform-agent-account-9999',
      }),
    ).toBe(false);
    const replay = deriveExecutionAssignmentReplayIdentity(value.assignment)!;
    expect(
      verifySignedExecutionAssignment(value.assignment, {
        ...value.assignmentContext,
        consumedReplayIdentities: [replay],
      }),
    ).toBe(false);
  });

  it('requires a fresh, first-acquired DB fence and exact authority nonce/bindings', () => {
    const value = fixture();
    const mutations: readonly [string, unknown][] = [
      ['assignmentBodyDigest', sha('b')],
      ['activationEpoch', '12'],
      ['intentId', 'deposit-intent-9999'],
      ['attemptId', 'deposit-attempt-9999'],
      ['platformAgentAccountId', 'platform-agent-account-9999'],
      ['pilotReservationDigest', sha('c')],
      ['playerIdDigest', sha('d')],
      ['fenceId', 'database-fence-9999'],
      ['fenceNonceDigest', sha('e')],
    ];
    for (const [field, replacement] of mutations) {
      const signed = clone(value.authority) as unknown as Record<string, unknown>;
      signed.body = { ...value.authority.body, [field]: replacement };
      expect(verifySignedOneUseActionAuthority(signed, value.authorityContext), field).toBe(false);
    }
    for (const [field, replacement] of mutations.filter(
      ([field]) => field !== 'fenceId' && field !== 'fenceNonceDigest',
    )) {
      const resigned = signOneUseActionAuthority(
        { ...value.authority.body, [field]: replacement },
        value.executionSigner.privateKey,
      );
      expect(
        resigned && verifySignedOneUseActionAuthority(resigned, value.authorityContext),
        `resigned ${field}`,
      ).not.toBe(true);
    }
    expect(
      decodeOneUseActionAuthorityBody({
        ...value.authority.body,
        firstFenceAcquired: false,
      }),
    ).toBeUndefined();
    expect(
      verifySignedOneUseActionAuthority(value.authority, {
        ...value.authorityContext,
        expectedRequestNonceDigest: sha('f'),
      }),
    ).toBe(false);
  });

  it('enforces authority TTL, RTT, issuance freshness, and replay', () => {
    const value = fixture();
    const overEnrollmentLimit = signOneUseActionAuthority(
      authorityBody(value.assignment, {
        serverValidUntil: '2026-09-10T12:00:16.100Z',
      }),
      value.executionSigner.privateKey,
    )!;
    expect(decodeSignedOneUseActionAuthority(overEnrollmentLimit)).toBeDefined();
    expect(verifySignedOneUseActionAuthority(overEnrollmentLimit, value.authorityContext)).toBe(
      false,
    );
    expect(
      decodeOneUseActionAuthorityBody({
        ...value.authority.body,
        serverValidUntil: '2026-09-10T12:00:20.000Z',
      }),
    ).toBeUndefined();
    const stale = signOneUseActionAuthority(
      authorityBody(value.assignment, {
        databaseFencedAt: '2026-09-10T12:00:00.000Z',
        databaseAuthorityIssuedAt: '2026-09-10T12:00:00.100Z',
      }),
      value.executionSigner.privateKey,
    )!;
    expect(verifySignedOneUseActionAuthority(stale, value.authorityContext)).toBe(false);
    expect(
      verifySignedOneUseActionAuthority(value.authority, {
        ...value.authorityContext,
        roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 5_001 },
      }),
    ).toBe(false);
    const replay = deriveOneUseActionAuthorityReplayIdentity(value.authority)!;
    expect(
      verifySignedOneUseActionAuthority(value.authority, {
        ...value.authorityContext,
        consumedReplayIdentities: [replay],
      }),
    ).toBe(false);
  });

  it('enforces enrollment validity, certificate digest, local identity, and active capability', () => {
    const value = fixture();
    const inactive = signExecutionEnrollment(
      enrollmentBody(value.certificate, value.executionSigner, { capabilityState: 'revoked' }),
      value.executionSigner.privateKey,
    )!;
    expect(decodeSignedExecutionEnrollment(inactive)).toBeDefined();
    expect(verifySignedExecutionEnrollment(inactive, value.identity)).toBe(false);

    const wrongCertificateDigest = signExecutionEnrollment(
      enrollmentBody(value.certificate, value.executionSigner, {
        noMoneyCertificateBodyDigest: sha('f'),
      }),
      value.executionSigner.privateKey,
    )!;
    expect(verifySignedExecutionEnrollment(wrongCertificateDigest, value.identity)).toBe(false);
    expect(
      verifySignedExecutionEnrollment(value.enrollment, {
        ...value.identity,
        expectedDeviceId: 'windows-device-9999',
      }),
    ).toBe(false);
    expect(
      verifySignedExecutionEnrollment(value.enrollment, {
        ...value.identity,
        expectedPlatformAgentAccountId: 'platform-agent-account-9999',
      }),
    ).toBe(false);
    expect(
      verifySignedExecutionEnrollment(value.enrollment, {
        ...value.identity,
        trustedNow: value.enrollment.body.validUntil,
      }),
    ).toBe(false);

    const beyondCertificate = signExecutionEnrollment(
      enrollmentBody(value.certificate, value.executionSigner, {
        validUntil: '2026-09-11T10:00:00.001Z',
      }),
      value.executionSigner.privateKey,
    )!;
    expect(verifySignedExecutionEnrollment(beyondCertificate, value.identity)).toBe(false);
  });

  it('requires authority after the fence and makes final-action-started dominate result semantics', () => {
    const value = fixture();
    const uncertain = signExecutionResult(
      resultBody(value.assignment, value.authority, {
        outcome: 'local_uncertain',
        providerResponseDigest: null,
      }),
      value.device.privateKey,
    )!;
    expect(
      verifySignedExecutionResult(uncertain, {
        ...value.resultContext,
      }),
    ).toBe(true);

    const refused = signExecutionResult(
      resultBody(value.assignment, null),
      value.device.privateKey,
    )!;
    expect(
      verifySignedExecutionResult(refused, {
        ...value.resultContext,
        signedOneUseActionAuthority: null,
      }),
    ).toBe(true);

    expect(
      decodeExecutionResultBody({
        ...refused.body,
        finalActionStarted: true,
      }),
    ).toBeUndefined();
    expect(
      decodeExecutionResultBody({
        ...value.result.body,
        authorityId: null,
        authorityBodyDigest: null,
        fenceId: null,
        fenceNonceDigest: null,
        requestNonceDigest: null,
      }),
    ).toBeUndefined();
    expect(
      decodeExecutionResultBody({
        ...value.result.body,
        outcome: 'local_uncertain',
        finalActionStarted: false,
      }),
    ).toBeUndefined();
  });

  it('binds results to the device, exact assignment, exact authority, time, and replay identity', () => {
    const value = fixture();
    const wrongAuthority = signExecutionResult(
      resultBody(value.assignment, value.authority, { authorityBodyDigest: sha('b') }),
      value.device.privateKey,
    )!;
    expect(verifySignedExecutionResult(wrongAuthority, value.resultContext)).toBe(false);

    const wrongAssignment = signExecutionResult(
      { ...value.result.body, pilotReservationDigest: sha('c') },
      value.device.privateKey,
    )!;
    expect(verifySignedExecutionResult(wrongAssignment, value.resultContext)).toBe(false);

    const otherDevice = keyPair();
    const wrongDeviceSignature = signExecutionResult(value.result.body, otherDevice.privateKey)!;
    expect(verifySignedExecutionResult(wrongDeviceSignature, value.resultContext)).toBe(false);

    const future = signExecutionResult(
      resultBody(value.assignment, value.authority, {
        deviceObservedAt: '2026-09-10T12:00:09.000Z',
      }),
      value.device.privateKey,
    )!;
    expect(verifySignedExecutionResult(future, value.resultContext)).toBe(false);
    const replay = deriveExecutionResultReplayIdentity(value.result)!;
    expect(
      verifySignedExecutionResult(value.result, {
        ...value.resultContext,
        consumedReplayIdentities: [replay],
      }),
    ).toBe(false);
  });

  it('supports refused, fenced-not-started, and locally uncertain DB-derived statuses', () => {
    const value = fixture();
    const refused = signAuthoritativeExecutionStatus(
      statusBody(value.assignment, null, null),
      value.executionSigner.privateKey,
    )!;
    expect(
      verifySignedAuthoritativeExecutionStatus(refused, {
        ...value.statusContext,
        signedOneUseActionAuthority: null,
        signedExecutionResult: null,
      }),
    ).toBe(true);

    const fencedNotStarted = signAuthoritativeExecutionStatus(
      statusBody(value.assignment, value.authority, null, {
        databaseFenceState: 'acquired',
        databaseAttemptState: 'not_started',
        databaseReconciliationState: 'pending',
        terminalState: 'non_terminal',
        executionResultBodyDigest: null,
        providerResponseDigest: null,
        evidenceDigest: null,
      }),
      value.executionSigner.privateKey,
    )!;
    expect(
      verifySignedAuthoritativeExecutionStatus(fencedNotStarted, {
        ...value.statusContext,
        signedExecutionResult: null,
      }),
    ).toBe(true);

    const uncertainResult = signExecutionResult(
      resultBody(value.assignment, value.authority, {
        outcome: 'local_uncertain',
        providerResponseDigest: null,
      }),
      value.device.privateKey,
    )!;
    const uncertainStatus = signAuthoritativeExecutionStatus(
      statusBody(value.assignment, value.authority, uncertainResult, {
        databaseAttemptState: 'local_uncertain',
        databaseReconciliationState: 'uncertain',
        terminalState: 'uncertain',
      }),
      value.executionSigner.privateKey,
    )!;
    expect(
      verifySignedAuthoritativeExecutionStatus(uncertainStatus, {
        ...value.statusContext,
        signedExecutionResult: uncertainResult,
      }),
    ).toBe(true);
  });

  it('never lets status decode or verify as authority and strictly binds freshness and DB evidence', () => {
    const value = fixture();
    expect(
      decodeAuthoritativeExecutionStatusBody({
        ...value.status.body,
        grantsActionAuthority: true,
      }),
    ).toBeUndefined();
    expect(
      decodeAuthoritativeExecutionStatusBody({
        ...value.status.body,
        oneUseActionAuthority: true,
      }),
    ).toBeUndefined();

    const mismatchedResult = signAuthoritativeExecutionStatus(
      { ...value.status.body, executionResultBodyDigest: sha('b') },
      value.executionSigner.privateKey,
    )!;
    expect(verifySignedAuthoritativeExecutionStatus(mismatchedResult, value.statusContext)).toBe(
      false,
    );
    const mismatchedBinding = signAuthoritativeExecutionStatus(
      { ...value.status.body, activationEpoch: '12' },
      value.executionSigner.privateKey,
    )!;
    expect(verifySignedAuthoritativeExecutionStatus(mismatchedBinding, value.statusContext)).toBe(
      false,
    );
    expect(
      verifySignedAuthoritativeExecutionStatus(value.status, {
        ...value.statusContext,
        expectedQueryNonceDigest: sha('f'),
      }),
    ).toBe(false);
    expect(
      verifySignedAuthoritativeExecutionStatus(value.status, {
        ...value.statusContext,
        minimumStatusSequence: '8',
      }),
    ).toBe(false);
    expect(
      verifySignedAuthoritativeExecutionStatus(value.status, {
        ...value.statusContext,
        roundTrip: { monotonicRequestStartedMs: 0, monotonicResponseReceivedMs: 5_001 },
      }),
    ).toBe(false);
    const replay = deriveAuthoritativeExecutionStatusReplayIdentity(value.status)!;
    expect(
      verifySignedAuthoritativeExecutionStatus(value.status, {
        ...value.statusContext,
        consumedReplayIdentities: [replay],
      }),
    ).toBe(false);

    expect(
      decodeAuthoritativeExecutionStatusBody({
        ...value.status.body,
        executionResultBodyDigest: null,
      }),
    ).toBeUndefined();
  });

  it('canonicalizes every body, constrains player/nonce inputs, and separates replay domains', () => {
    const value = fixture();
    for (const canonical of [
      canonicalExecutionEnrollmentBodyBytes(value.enrollment.body),
      canonicalExecutionAssignmentBodyBytes(value.assignment.body),
      canonicalOneUseActionAuthorityBodyBytes(value.authority.body),
      canonicalExecutionResultBodyBytes(value.result.body),
      canonicalAuthoritativeExecutionStatusBodyBytes(value.status.body),
    ]) {
      expect(canonical).toBeInstanceOf(Buffer);
      expect(canonical!.byteLength).toBeGreaterThan(100);
    }
    expect(digestCompanionExecutionPlayerId('28379330')).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(digestCompanionExecutionPlayerId(' player ')).toBeUndefined();
    expect(digestCompanionExecutionPlayerId('')).toBeUndefined();
    expect(digestCompanionExecutionNonce(Buffer.alloc(16, 1))).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(digestCompanionExecutionNonce(Buffer.alloc(15, 1))).toBeUndefined();
    expect(digestCompanionExecutionNonce(Buffer.alloc(65, 1))).toBeUndefined();
    expect(digestCompanionExecutionNonce('not-bytes')).toBeUndefined();

    const replayIdentities = [
      deriveExecutionAssignmentReplayIdentity(value.assignment),
      deriveOneUseActionAuthorityReplayIdentity(value.authority),
      deriveExecutionResultReplayIdentity(value.result),
      deriveAuthoritativeExecutionStatusReplayIdentity(value.status),
    ];
    expect(replayIdentities.every(Boolean)).toBe(true);
    expect(new Set(replayIdentities).size).toBe(replayIdentities.length);
  });

  it('remains a dormant contract-only package with no runtime, DB, provider, or secret access', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    for (const forbidden of [
      'DATABASE_URL',
      'SUPABASE_',
      'authorizationToken',
      'leaseToken',
      'fetch(',
      'child_process',
      'docker',
      'apps/',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
