import {
  KeyObject,
  createHash,
  createPublicKey,
  sign as signP256,
  verify as verifyP256,
} from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  decodeSignedCompanionEnrollmentCertificate,
  digestCompanionEnrollmentCertificateBody,
  verifySignedCompanionEnrollmentCertificate,
  type SignedCompanionEnrollmentCertificate,
} from '@fetanagent/agent-platform-companion-contracts';

/**
 * Dormant shared contracts for a possible future, explicitly enrolled Windows execution lane.
 *
 * These types do not provision a signer, create a database fence, expose a provider request,
 * enable a feature, or perform an action. In particular, a signed assignment is not action
 * authority. Only the separately signed, short-lived, first-fence authority can describe that
 * authority, and this package contains no consumer capable of exercising it.
 */
export const COMPANION_EXECUTION_CONTRACT_VERSION = 2 as const;
export const COMPANION_EXECUTION_PROTOCOL_MODE =
  'windows_companion_financial_execution_contracts_v2_dormant' as const;
export const COMPANION_EXECUTION_CAPABILITY =
  'kemerbet.deposit.submit.exact_2500_etb.one_use.v2' as const;
export const COMPANION_EXECUTION_ACTION_KIND = 'deposit_submission' as const;
export const COMPANION_EXECUTION_PLATFORM_CODE = 'kemerbet' as const;
export const COMPANION_EXECUTION_CURRENCY_CODE = 'ETB' as const;
export const COMPANION_EXECUTION_AMOUNT_MINOR_UNITS = 2500 as const;
export const COMPANION_EXECUTION_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256' as const;
export const COMPANION_EXECUTION_SIGNATURE_ENCODING = 'ieee-p1363-base64url' as const;
export const COMPANION_EXECUTION_DIGEST_ALGORITHM = 'sha256' as const;
export const COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT =
  'agent-platform-companion-execution-enrollment-transcript-v2' as const;
export const COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT =
  'agent-platform-companion-execution-assignment-transcript-v2' as const;
export const COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT =
  'agent-platform-companion-one-use-action-authority-transcript-v2' as const;
export const COMPANION_EXECUTION_RESULT_TRANSCRIPT =
  'agent-platform-companion-execution-result-transcript-v2' as const;
export const COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT =
  'agent-platform-companion-authoritative-execution-status-transcript-v2' as const;
export const COMPANION_EXECUTION_MAX_ENROLLMENT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const COMPANION_EXECUTION_MAX_ASSIGNMENT_LIFETIME_MS = 2 * 60 * 1_000;
export const COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS = 10_000;
export const COMPANION_EXECUTION_MAX_AUTHORITY_LIFETIME_MS =
  COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS;
export const COMPANION_EXECUTION_MAX_STATUS_LIFETIME_MS = 10_000;
export const COMPANION_EXECUTION_MAX_ROUND_TRIP_TIME_MS = 10_000;
export const COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS = 2_000;
export const COMPANION_EXECUTION_MAX_RESULT_REPORTING_DELAY_MS = 5 * 60 * 1_000;
export const COMPANION_EXECUTION_POSTGRES_BIGINT_MAX = '9223372036854775807' as const;
export const COMPANION_EXECUTION_POSTGRES_INTEGER_MAX = '2147483647' as const;

export interface ExecutionEnrollmentBody {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly capability: typeof COMPANION_EXECUTION_CAPABILITY;
  readonly enrollmentId: string;
  readonly noMoneyCertificateId: string;
  readonly noMoneyCertificateBodyDigest: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly platformAgentAccountId: string;
  readonly accountBindingCount: 1;
  readonly platformCode: typeof COMPANION_EXECUTION_PLATFORM_CODE;
  readonly pilotId: string;
  readonly pilotRevision: string;
  readonly pilotConfigDigest: string;
  readonly amountMinorUnits: typeof COMPANION_EXECUTION_AMOUNT_MINOR_UNITS;
  readonly currencyCode: typeof COMPANION_EXECUTION_CURRENCY_CODE;
  readonly maxActionsPerAssignment: 1;
  readonly maxAssignmentLifetimeMs: number;
  readonly maxAuthorityLifetimeMs: number;
  readonly maxStatusLifetimeMs: number;
  readonly maxRoundTripTimeMs: number;
  readonly executionSignerKeyId: string;
  readonly executionSignerPublicKeySpki: string;
  readonly executionSignerPublicKeySpkiSha256: string;
  readonly capabilityState: 'active' | 'revoked';
  readonly issuedAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface SignedExecutionEnrollment {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT;
  readonly bodyDigestAlgorithm: typeof COMPANION_EXECUTION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof COMPANION_EXECUTION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof COMPANION_EXECUTION_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: ExecutionEnrollmentBody;
  readonly signature: string;
}

export interface ExecutionAssignmentBody {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly capability: typeof COMPANION_EXECUTION_CAPABILITY;
  readonly actionKind: typeof COMPANION_EXECUTION_ACTION_KIND;
  readonly assignmentId: string;
  readonly assignmentNonceDigest: string;
  readonly activationEpoch: string;
  readonly intentId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly platformAgentAccountId: string;
  readonly enrollmentId: string;
  readonly enrollmentBodyDigest: string;
  readonly noMoneyCertificateId: string;
  readonly noMoneyCertificateBodyDigest: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly executionSignerKeyId: string;
  readonly platformCode: typeof COMPANION_EXECUTION_PLATFORM_CODE;
  readonly pilotId: string;
  readonly pilotRevision: string;
  readonly pilotConfigDigest: string;
  readonly pilotReservationId: string;
  readonly pilotReservationDigest: string;
  readonly amountMinorUnits: typeof COMPANION_EXECUTION_AMOUNT_MINOR_UNITS;
  readonly currencyCode: typeof COMPANION_EXECUTION_CURRENCY_CODE;
  readonly playerIdDigest: string;
  readonly oneUse: true;
  readonly serverIssuedAt: string;
  readonly serverNotBefore: string;
  readonly serverValidUntil: string;
}

export interface SignedExecutionAssignment {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT;
  readonly bodyDigestAlgorithm: typeof COMPANION_EXECUTION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof COMPANION_EXECUTION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof COMPANION_EXECUTION_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: ExecutionAssignmentBody;
  readonly signature: string;
}

export interface OneUseActionAuthorityBody {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly capability: typeof COMPANION_EXECUTION_CAPABILITY;
  readonly actionKind: typeof COMPANION_EXECUTION_ACTION_KIND;
  readonly authorityId: string;
  readonly assignmentId: string;
  readonly assignmentBodyDigest: string;
  readonly activationEpoch: string;
  readonly intentId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly platformAgentAccountId: string;
  readonly enrollmentId: string;
  readonly enrollmentBodyDigest: string;
  readonly noMoneyCertificateId: string;
  readonly noMoneyCertificateBodyDigest: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly executionSignerKeyId: string;
  readonly platformCode: typeof COMPANION_EXECUTION_PLATFORM_CODE;
  readonly pilotId: string;
  readonly pilotRevision: string;
  readonly pilotConfigDigest: string;
  readonly pilotReservationId: string;
  readonly pilotReservationDigest: string;
  readonly amountMinorUnits: typeof COMPANION_EXECUTION_AMOUNT_MINOR_UNITS;
  readonly currencyCode: typeof COMPANION_EXECUTION_CURRENCY_CODE;
  readonly playerIdDigest: string;
  readonly fenceId: string;
  readonly fenceNonceDigest: string;
  readonly databaseFenceState: 'first_fence_acquired';
  readonly firstFenceAcquired: true;
  readonly requestNonceDigest: string;
  readonly oneUse: true;
  readonly databaseFencedAt: string;
  readonly databaseAuthorityIssuedAt: string;
  readonly serverValidUntil: string;
}

export interface SignedOneUseActionAuthority {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT;
  readonly bodyDigestAlgorithm: typeof COMPANION_EXECUTION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof COMPANION_EXECUTION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof COMPANION_EXECUTION_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: OneUseActionAuthorityBody;
  readonly signature: string;
}

export type ExecutionResultOutcome =
  'submission_attempted' | 'local_uncertain' | 'refused_before_fence';

export interface ExecutionResultBody {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly capability: typeof COMPANION_EXECUTION_CAPABILITY;
  readonly actionKind: typeof COMPANION_EXECUTION_ACTION_KIND;
  readonly resultId: string;
  readonly assignmentId: string;
  readonly assignmentBodyDigest: string;
  readonly authorityId: string | null;
  readonly authorityBodyDigest: string | null;
  readonly activationEpoch: string;
  readonly intentId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly platformAgentAccountId: string;
  readonly enrollmentId: string;
  readonly enrollmentBodyDigest: string;
  readonly noMoneyCertificateId: string;
  readonly noMoneyCertificateBodyDigest: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly executionSignerKeyId: string;
  readonly platformCode: typeof COMPANION_EXECUTION_PLATFORM_CODE;
  readonly pilotId: string;
  readonly pilotRevision: string;
  readonly pilotConfigDigest: string;
  readonly pilotReservationId: string;
  readonly pilotReservationDigest: string;
  readonly amountMinorUnits: typeof COMPANION_EXECUTION_AMOUNT_MINOR_UNITS;
  readonly currencyCode: typeof COMPANION_EXECUTION_CURRENCY_CODE;
  readonly playerIdDigest: string;
  readonly fenceId: string | null;
  readonly fenceNonceDigest: string | null;
  readonly requestNonceDigest: string | null;
  readonly outcome: ExecutionResultOutcome;
  readonly finalActionStarted: boolean;
  readonly finalActionStartedAt: string | null;
  readonly providerResponseDigest: string | null;
  readonly evidenceDigest: string;
  readonly reportedAt: string;
}

export interface SignedExecutionResult {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof COMPANION_EXECUTION_RESULT_TRANSCRIPT;
  readonly bodyDigestAlgorithm: typeof COMPANION_EXECUTION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof COMPANION_EXECUTION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof COMPANION_EXECUTION_SIGNATURE_ENCODING;
  readonly deviceKeyId: string;
  readonly body: ExecutionResultBody;
  readonly signature: string;
}

export type DatabaseFenceState = 'not_acquired' | 'acquired' | 'consumed';
export type DatabaseAttemptState =
  'refused_before_fence' | 'not_started' | 'submission_attempted' | 'local_uncertain';
export type DatabaseReconciliationState =
  'not_required' | 'pending' | 'succeeded' | 'failed' | 'uncertain';
export type AuthoritativeTerminalState =
  'refused' | 'non_terminal' | 'succeeded' | 'failed' | 'uncertain';

export interface AuthoritativeExecutionStatusBody {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly statusKind: 'authoritative_execution_status';
  readonly grantsActionAuthority: false;
  readonly oneUseActionAuthority: false;
  readonly capability: typeof COMPANION_EXECUTION_CAPABILITY;
  readonly actionKind: typeof COMPANION_EXECUTION_ACTION_KIND;
  readonly statusId: string;
  readonly statusSequence: string;
  readonly queryNonceDigest: string;
  readonly assignmentId: string;
  readonly assignmentBodyDigest: string;
  readonly authorityId: string | null;
  readonly authorityBodyDigest: string | null;
  readonly activationEpoch: string;
  readonly intentId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly platformAgentAccountId: string;
  readonly enrollmentId: string;
  readonly enrollmentBodyDigest: string;
  readonly noMoneyCertificateId: string;
  readonly noMoneyCertificateBodyDigest: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly executionSignerKeyId: string;
  readonly platformCode: typeof COMPANION_EXECUTION_PLATFORM_CODE;
  readonly pilotId: string;
  readonly pilotRevision: string;
  readonly pilotConfigDigest: string;
  readonly pilotReservationId: string;
  readonly pilotReservationDigest: string;
  readonly amountMinorUnits: typeof COMPANION_EXECUTION_AMOUNT_MINOR_UNITS;
  readonly currencyCode: typeof COMPANION_EXECUTION_CURRENCY_CODE;
  readonly playerIdDigest: string;
  readonly fenceId: string | null;
  readonly databaseFenceState: DatabaseFenceState;
  readonly databaseAttemptState: DatabaseAttemptState;
  readonly databaseReconciliationState: DatabaseReconciliationState;
  readonly terminalState: AuthoritativeTerminalState;
  readonly executionResultBodyDigest: string | null;
  readonly providerResponseDigest: string | null;
  readonly evidenceDigest: string | null;
  readonly databaseObservedAt: string;
  readonly serverIssuedAt: string;
  readonly serverValidUntil: string;
}

export interface SignedAuthoritativeExecutionStatus {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT;
  readonly bodyDigestAlgorithm: typeof COMPANION_EXECUTION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof COMPANION_EXECUTION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof COMPANION_EXECUTION_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: AuthoritativeExecutionStatusBody;
  readonly signature: string;
}

export interface TrustedExecutionIdentityContext {
  readonly signedNoMoneyCertificate: unknown;
  readonly trustedNoMoneyServerPublicKeySpkiDer: Uint8Array;
  readonly trustedExecutionSignerKeyId: string;
  readonly trustedExecutionSignerPublicKeySpkiDer: Uint8Array;
  readonly expectedDeviceId: string;
  readonly expectedDeviceKeyId: string;
  readonly expectedPlatformAgentAccountId: string;
  readonly trustedNow: string;
}

export interface TrustedRoundTripContext {
  readonly monotonicRequestStartedMs: number;
  readonly monotonicResponseReceivedMs: number;
}

export interface ExecutionAssignmentVerificationContext extends TrustedExecutionIdentityContext {
  readonly signedExecutionEnrollment: unknown;
  readonly roundTrip: TrustedRoundTripContext;
  readonly consumedReplayIdentities: readonly string[];
}

export interface OneUseActionAuthorityVerificationContext extends TrustedExecutionIdentityContext {
  readonly signedExecutionEnrollment: unknown;
  readonly signedExecutionAssignment: unknown;
  readonly expectedRequestNonceDigest: string;
  readonly roundTrip: TrustedRoundTripContext;
  readonly consumedReplayIdentities: readonly string[];
}

export interface ExecutionResultVerificationContext extends TrustedExecutionIdentityContext {
  readonly signedExecutionEnrollment: unknown;
  readonly signedExecutionAssignment: unknown;
  readonly signedOneUseActionAuthority: unknown | null;
  readonly consumedReplayIdentities: readonly string[];
}

export interface AuthoritativeExecutionStatusVerificationContext extends TrustedExecutionIdentityContext {
  readonly signedExecutionEnrollment: unknown;
  readonly signedExecutionAssignment: unknown;
  readonly signedOneUseActionAuthority: unknown | null;
  readonly signedExecutionResult: unknown | null;
  readonly expectedQueryNonceDigest: string;
  readonly minimumStatusSequence: string;
  readonly roundTrip: TrustedRoundTripContext;
  readonly consumedReplayIdentities: readonly string[];
}

/**
 * Authentication output only. It deliberately carries literal false action authority and requires
 * a separate, external atomic replay-consumption transition before any action can be considered.
 */
export interface CryptographicallyVerifiedOneUseActionAuthority {
  readonly verificationKind: 'cryptographically_verified_one_use_action_authority';
  readonly grantsActionAuthority: false;
  readonly atomicReplayConsumptionRequired: true;
  readonly authorityBodyDigest: string;
  readonly replayIdentity: string;
  readonly signedServerActionDeadline: string;
  readonly monotonicActionDeadlineMs: number;
  readonly verifiedAtTrustedTime: string;
  readonly responseReceivedMonotonicMs: number;
}

/**
 * A receipt supplied by the eventual durable runtime after an atomic check-and-consume operation.
 * This package cannot create or substantiate the receipt because it intentionally has no storage.
 */
export interface ExternalAtomicReplayConsumptionReceipt {
  readonly receiptKind: 'external_atomic_replay_consumption';
  readonly replayIdentity: string;
  readonly authorityBodyDigest: string;
  readonly consumedExactlyOnce: true;
}

export interface ImmediateActionDeadlineRecheckContext {
  readonly trustedNow: string;
  readonly monotonicNowMs: number;
  readonly atomicConsumptionReceipt: ExternalAtomicReplayConsumptionReceipt;
}

type UnknownRecord = Record<string, unknown>;
type Scalar = string | number | boolean | null;
type CanonicalField = readonly [string, Scalar];

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DECIMAL_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const P1363_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const MAX_P256_SPKI_BYTES = 91;
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const P256_HALF_ORDER = P256_ORDER / 2n;
const POSTGRES_BIGINT_MAX = BigInt(COMPANION_EXECUTION_POSTGRES_BIGINT_MAX);
const POSTGRES_INTEGER_MAX = BigInt(COMPANION_EXECUTION_POSTGRES_INTEGER_MAX);

const enrollmentBodyKeys = [
  'contractVersion',
  'protocolMode',
  'capability',
  'enrollmentId',
  'noMoneyCertificateId',
  'noMoneyCertificateBodyDigest',
  'deviceId',
  'deviceKeyId',
  'devicePublicKeySpkiSha256',
  'platformAgentAccountId',
  'accountBindingCount',
  'platformCode',
  'pilotId',
  'pilotRevision',
  'pilotConfigDigest',
  'amountMinorUnits',
  'currencyCode',
  'maxActionsPerAssignment',
  'maxAssignmentLifetimeMs',
  'maxAuthorityLifetimeMs',
  'maxStatusLifetimeMs',
  'maxRoundTripTimeMs',
  'executionSignerKeyId',
  'executionSignerPublicKeySpki',
  'executionSignerPublicKeySpkiSha256',
  'capabilityState',
  'issuedAt',
  'validFrom',
  'validUntil',
] as const;

const assignmentBodyKeys = [
  'contractVersion',
  'protocolMode',
  'capability',
  'actionKind',
  'assignmentId',
  'assignmentNonceDigest',
  'activationEpoch',
  'intentId',
  'jobId',
  'attemptId',
  'platformAgentAccountId',
  'enrollmentId',
  'enrollmentBodyDigest',
  'noMoneyCertificateId',
  'noMoneyCertificateBodyDigest',
  'deviceId',
  'deviceKeyId',
  'executionSignerKeyId',
  'platformCode',
  'pilotId',
  'pilotRevision',
  'pilotConfigDigest',
  'pilotReservationId',
  'pilotReservationDigest',
  'amountMinorUnits',
  'currencyCode',
  'playerIdDigest',
  'oneUse',
  'serverIssuedAt',
  'serverNotBefore',
  'serverValidUntil',
] as const;

const authorityBodyKeys = [
  'contractVersion',
  'protocolMode',
  'capability',
  'actionKind',
  'authorityId',
  'assignmentId',
  'assignmentBodyDigest',
  'activationEpoch',
  'intentId',
  'jobId',
  'attemptId',
  'platformAgentAccountId',
  'enrollmentId',
  'enrollmentBodyDigest',
  'noMoneyCertificateId',
  'noMoneyCertificateBodyDigest',
  'deviceId',
  'deviceKeyId',
  'executionSignerKeyId',
  'platformCode',
  'pilotId',
  'pilotRevision',
  'pilotConfigDigest',
  'pilotReservationId',
  'pilotReservationDigest',
  'amountMinorUnits',
  'currencyCode',
  'playerIdDigest',
  'fenceId',
  'fenceNonceDigest',
  'databaseFenceState',
  'firstFenceAcquired',
  'requestNonceDigest',
  'oneUse',
  'databaseFencedAt',
  'databaseAuthorityIssuedAt',
  'serverValidUntil',
] as const;

const resultBodyKeys = [
  'contractVersion',
  'protocolMode',
  'capability',
  'actionKind',
  'resultId',
  'assignmentId',
  'assignmentBodyDigest',
  'authorityId',
  'authorityBodyDigest',
  'activationEpoch',
  'intentId',
  'jobId',
  'attemptId',
  'platformAgentAccountId',
  'enrollmentId',
  'enrollmentBodyDigest',
  'noMoneyCertificateId',
  'noMoneyCertificateBodyDigest',
  'deviceId',
  'deviceKeyId',
  'executionSignerKeyId',
  'platformCode',
  'pilotId',
  'pilotRevision',
  'pilotConfigDigest',
  'pilotReservationId',
  'pilotReservationDigest',
  'amountMinorUnits',
  'currencyCode',
  'playerIdDigest',
  'fenceId',
  'fenceNonceDigest',
  'requestNonceDigest',
  'outcome',
  'finalActionStarted',
  'finalActionStartedAt',
  'providerResponseDigest',
  'evidenceDigest',
  'reportedAt',
] as const;

const statusBodyKeys = [
  'contractVersion',
  'protocolMode',
  'statusKind',
  'grantsActionAuthority',
  'oneUseActionAuthority',
  'capability',
  'actionKind',
  'statusId',
  'statusSequence',
  'queryNonceDigest',
  'assignmentId',
  'assignmentBodyDigest',
  'authorityId',
  'authorityBodyDigest',
  'activationEpoch',
  'intentId',
  'jobId',
  'attemptId',
  'platformAgentAccountId',
  'enrollmentId',
  'enrollmentBodyDigest',
  'noMoneyCertificateId',
  'noMoneyCertificateBodyDigest',
  'deviceId',
  'deviceKeyId',
  'executionSignerKeyId',
  'platformCode',
  'pilotId',
  'pilotRevision',
  'pilotConfigDigest',
  'pilotReservationId',
  'pilotReservationDigest',
  'amountMinorUnits',
  'currencyCode',
  'playerIdDigest',
  'fenceId',
  'databaseFenceState',
  'databaseAttemptState',
  'databaseReconciliationState',
  'terminalState',
  'executionResultBodyDigest',
  'providerResponseDigest',
  'evidenceDigest',
  'databaseObservedAt',
  'serverIssuedAt',
  'serverValidUntil',
] as const;

const serverEnvelopeKeys = [
  'contractVersion',
  'protocolMode',
  'transcriptVersion',
  'bodyDigestAlgorithm',
  'bodyDigest',
  'signatureAlgorithm',
  'signatureEncoding',
  'signerKeyId',
  'body',
  'signature',
] as const;

const deviceEnvelopeKeys = [
  'contractVersion',
  'protocolMode',
  'transcriptVersion',
  'bodyDigestAlgorithm',
  'bodyDigest',
  'signatureAlgorithm',
  'signatureEncoding',
  'deviceKeyId',
  'body',
  'signature',
] as const;

const atomicConsumptionReceiptKeys = [
  'receiptKind',
  'replayIdentity',
  'authorityBodyDigest',
  'consumedExactlyOnce',
] as const;

const cryptographicallyVerifiedAuthorities = new WeakSet<object>();

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }
  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function own(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function hasHeader(value: UnknownRecord): boolean {
  return (
    own(value, 'contractVersion') === COMPANION_EXECUTION_CONTRACT_VERSION &&
    own(value, 'protocolMode') === COMPANION_EXECUTION_PROTOCOL_MODE
  );
}

function opaque(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value) ? value : undefined;
}

function boundedDecimal(value: unknown, maximum: bigint): string | undefined {
  if (typeof value !== 'string' || !DECIMAL_ID_PATTERN.test(value)) return undefined;
  try {
    return BigInt(value) <= maximum ? value : undefined;
  } catch {
    return undefined;
  }
}

function decimal(value: unknown): string | undefined {
  return boundedDecimal(value, POSTGRES_BIGINT_MAX);
}

function postgresInteger(value: unknown): string | undefined {
  return boundedDecimal(value, POSTGRES_INTEGER_MAX);
}

function digest(value: unknown): string | undefined {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? value : undefined;
}

function nullableDigest(value: unknown): string | null | undefined {
  return value === null ? null : digest(value);
}

function nullableOpaque(value: unknown): string | null | undefined {
  return value === null ? null : opaque(value);
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function nullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : timestamp(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? (value as number)
    : undefined;
}

interface ParsedP256PublicKey {
  readonly key: KeyObject;
  readonly encoded: string;
  readonly digest: string;
}

function parseP256SpkiBytes(value: unknown): ParsedP256PublicKey | undefined {
  try {
    if (!(value instanceof Uint8Array) || isProxy(value)) return undefined;
    const bytes = Buffer.from(value);
    if (bytes.byteLength !== MAX_P256_SPKI_BYTES) return undefined;
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    const canonical = key.export({ format: 'der', type: 'spki' });
    if (
      key.type !== 'public' ||
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !Buffer.isBuffer(canonical) ||
      !canonical.equals(bytes)
    ) {
      return undefined;
    }
    return Object.freeze({
      key,
      encoded: bytes.toString('base64url'),
      digest: sha256(bytes),
    });
  } catch {
    return undefined;
  }
}

function parseP256SpkiText(value: unknown): ParsedP256PublicKey | undefined {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value ? parseP256SpkiBytes(bytes) : undefined;
}

interface ParsedP256PrivateKey {
  readonly key: KeyObject;
  readonly publicKey: ParsedP256PublicKey;
}

function parseP256PrivateKey(value: unknown): ParsedP256PrivateKey | undefined {
  try {
    if (
      !(value instanceof KeyObject) ||
      value.type !== 'private' ||
      value.asymmetricKeyType !== 'ec' ||
      value.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      return undefined;
    }
    const publicKey = createPublicKey(value);
    const bytes = publicKey.export({ format: 'der', type: 'spki' });
    const parsed = Buffer.isBuffer(bytes) ? parseP256SpkiBytes(bytes) : undefined;
    return parsed ? Object.freeze({ key: value, publicKey: parsed }) : undefined;
  } catch {
    return undefined;
  }
}

function p256Scalar(bytes: Uint8Array): bigint {
  return BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
}

function p256ScalarBytes(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

function normalizedLowSP1363Bytes(value: Uint8Array): Buffer | undefined {
  const bytes = Buffer.from(value);
  if (bytes.byteLength !== 64) return undefined;
  const r = p256Scalar(bytes.subarray(0, 32));
  const s = p256Scalar(bytes.subarray(32));
  if (r <= 0n || r >= P256_ORDER || s <= 0n || s >= P256_ORDER) return undefined;
  const lowS = s > P256_HALF_ORDER ? P256_ORDER - s : s;
  return Buffer.concat([p256ScalarBytes(r), p256ScalarBytes(lowS)]);
}

function parseSignature(value: unknown): string | undefined {
  if (typeof value !== 'string' || !P1363_PATTERN.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64url');
  const normalized = normalizedLowSP1363Bytes(bytes);
  return normalized && normalized.equals(bytes) && bytes.toString('base64url') === value
    ? value
    : undefined;
}

function scalarText(value: Scalar): string {
  if (value === null) return 'null:';
  if (typeof value === 'string') return `string:${value}`;
  if (typeof value === 'number') return `number:${String(value)}`;
  return `boolean:${value ? 'true' : 'false'}`;
}

function encodeFields(domain: string, fields: readonly CanonicalField[]): Buffer {
  const values: string[] = [domain, String(fields.length)];
  for (const [name, value] of fields) values.push(name, scalarText(value));
  const chunks: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function bodyFields(body: UnknownRecord, keys: readonly string[]): readonly CanonicalField[] {
  return keys.map((key) => [key, own(body, key) as Scalar] as const);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function validLifetime(start: string, end: string, maximumMs: number): boolean {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return endMs > startMs && endMs - startMs <= maximumMs;
}

function verifyP1363Signature(
  transcript: Uint8Array | undefined,
  encodedSignature: string,
  key: KeyObject | undefined,
): boolean {
  try {
    const canonicalSignature = parseSignature(encodedSignature);
    return Boolean(
      transcript &&
      key &&
      canonicalSignature &&
      verifyP256(
        'sha256',
        transcript,
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(canonicalSignature, 'base64url'),
      ),
    );
  } catch {
    return false;
  }
}

function signP1363Transcript(
  transcript: Uint8Array | undefined,
  keyCandidate: unknown,
): string | undefined {
  try {
    const key = parseP256PrivateKey(keyCandidate);
    if (!transcript || !key) return undefined;
    const raw = signP256('sha256', transcript, {
      key: key.key,
      dsaEncoding: 'ieee-p1363',
    });
    const normalized = normalizedLowSP1363Bytes(raw);
    const encoded = normalized?.toString('base64url');
    return parseSignature(encoded);
  } catch {
    return undefined;
  }
}

function exactDenseDigestArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || isProxy(value)) return undefined;
  const expectedKeys = [
    'length',
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ];
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return undefined;
  }
  const decoded: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const item =
      descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
        ? digest(descriptor.value)
        : undefined;
    if (!item || decoded.includes(item)) return undefined;
    decoded.push(item);
  }
  return Object.freeze(decoded);
}

function replayIsFresh(identity: string, consumedCandidate: unknown): boolean {
  if (consumedCandidate === undefined) return false;
  const consumed = exactDenseDigestArray(consumedCandidate);
  return Boolean(consumed && !consumed.includes(identity));
}

function trustedNow(value: unknown): number | undefined {
  const parsed = timestamp(value);
  return parsed ? Date.parse(parsed) : undefined;
}

function trustedRoundTrip(
  candidate: TrustedRoundTripContext,
  maximumMs: number,
): number | undefined {
  const start = boundedInteger(candidate?.monotonicRequestStartedMs, 0, Number.MAX_SAFE_INTEGER);
  const end = boundedInteger(candidate?.monotonicResponseReceivedMs, 0, Number.MAX_SAFE_INTEGER);
  if (start === undefined || end === undefined || end < start || end - start > maximumMs) {
    return undefined;
  }
  return end - start;
}

function commonBodyLiterals(value: UnknownRecord): boolean {
  return (
    hasHeader(value) &&
    own(value, 'capability') === COMPANION_EXECUTION_CAPABILITY &&
    own(value, 'actionKind') === COMPANION_EXECUTION_ACTION_KIND
  );
}

export function decodeExecutionEnrollmentBody(
  candidate: unknown,
): ExecutionEnrollmentBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, enrollmentBodyKeys) ||
      !hasHeader(candidate) ||
      own(candidate, 'capability') !== COMPANION_EXECUTION_CAPABILITY
    ) {
      return undefined;
    }
    const enrollmentId = opaque(own(candidate, 'enrollmentId'));
    const noMoneyCertificateId = opaque(own(candidate, 'noMoneyCertificateId'));
    const noMoneyCertificateBodyDigest = digest(own(candidate, 'noMoneyCertificateBodyDigest'));
    const deviceId = opaque(own(candidate, 'deviceId'));
    const deviceKeyId = opaque(own(candidate, 'deviceKeyId'));
    const devicePublicKeySpkiSha256 = digest(own(candidate, 'devicePublicKeySpkiSha256'));
    const platformAgentAccountId = opaque(own(candidate, 'platformAgentAccountId'));
    const pilotId = opaque(own(candidate, 'pilotId'));
    const pilotRevision = postgresInteger(own(candidate, 'pilotRevision'));
    const pilotConfigDigest = digest(own(candidate, 'pilotConfigDigest'));
    const maxAssignmentLifetimeMs = boundedInteger(
      own(candidate, 'maxAssignmentLifetimeMs'),
      1_000,
      COMPANION_EXECUTION_MAX_ASSIGNMENT_LIFETIME_MS,
    );
    const maxAuthorityLifetimeMs = boundedInteger(
      own(candidate, 'maxAuthorityLifetimeMs'),
      1_000,
      COMPANION_EXECUTION_MAX_AUTHORITY_LIFETIME_MS,
    );
    const maxStatusLifetimeMs = boundedInteger(
      own(candidate, 'maxStatusLifetimeMs'),
      1_000,
      COMPANION_EXECUTION_MAX_STATUS_LIFETIME_MS,
    );
    const maxRoundTripTimeMs = boundedInteger(
      own(candidate, 'maxRoundTripTimeMs'),
      1,
      COMPANION_EXECUTION_MAX_ROUND_TRIP_TIME_MS,
    );
    const executionSignerKeyId = opaque(own(candidate, 'executionSignerKeyId'));
    const executionSignerPublicKeySpki = parseP256SpkiText(
      own(candidate, 'executionSignerPublicKeySpki'),
    );
    const executionSignerPublicKeySpkiSha256 = digest(
      own(candidate, 'executionSignerPublicKeySpkiSha256'),
    );
    const capabilityState = own(candidate, 'capabilityState');
    const issuedAt = timestamp(own(candidate, 'issuedAt'));
    const validFrom = timestamp(own(candidate, 'validFrom'));
    const validUntil = timestamp(own(candidate, 'validUntil'));
    if (
      !enrollmentId ||
      !noMoneyCertificateId ||
      !noMoneyCertificateBodyDigest ||
      !deviceId ||
      !deviceKeyId ||
      !devicePublicKeySpkiSha256 ||
      !platformAgentAccountId ||
      own(candidate, 'accountBindingCount') !== 1 ||
      own(candidate, 'platformCode') !== COMPANION_EXECUTION_PLATFORM_CODE ||
      !pilotId ||
      !pilotRevision ||
      !pilotConfigDigest ||
      own(candidate, 'amountMinorUnits') !== COMPANION_EXECUTION_AMOUNT_MINOR_UNITS ||
      own(candidate, 'currencyCode') !== COMPANION_EXECUTION_CURRENCY_CODE ||
      own(candidate, 'maxActionsPerAssignment') !== 1 ||
      maxAssignmentLifetimeMs === undefined ||
      maxAuthorityLifetimeMs === undefined ||
      maxStatusLifetimeMs === undefined ||
      maxRoundTripTimeMs === undefined ||
      !executionSignerKeyId ||
      executionSignerKeyId === deviceKeyId ||
      !executionSignerPublicKeySpki ||
      !executionSignerPublicKeySpkiSha256 ||
      executionSignerPublicKeySpki.digest !== executionSignerPublicKeySpkiSha256 ||
      executionSignerPublicKeySpkiSha256 === devicePublicKeySpkiSha256 ||
      (capabilityState !== 'active' && capabilityState !== 'revoked') ||
      !issuedAt ||
      !validFrom ||
      !validUntil ||
      Date.parse(issuedAt) > Date.parse(validFrom) ||
      !validLifetime(validFrom, validUntil, COMPANION_EXECUTION_MAX_ENROLLMENT_LIFETIME_MS)
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      capability: COMPANION_EXECUTION_CAPABILITY,
      enrollmentId,
      noMoneyCertificateId,
      noMoneyCertificateBodyDigest,
      deviceId,
      deviceKeyId,
      devicePublicKeySpkiSha256,
      platformAgentAccountId,
      accountBindingCount: 1,
      platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
      pilotId,
      pilotRevision,
      pilotConfigDigest,
      amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
      currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
      maxActionsPerAssignment: 1,
      maxAssignmentLifetimeMs,
      maxAuthorityLifetimeMs,
      maxStatusLifetimeMs,
      maxRoundTripTimeMs,
      executionSignerKeyId,
      executionSignerPublicKeySpki: executionSignerPublicKeySpki.encoded,
      executionSignerPublicKeySpkiSha256,
      capabilityState,
      issuedAt,
      validFrom,
      validUntil,
    });
  } catch {
    return undefined;
  }
}

export function decodeExecutionAssignmentBody(
  candidate: unknown,
): ExecutionAssignmentBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, assignmentBodyKeys) ||
      !commonBodyLiterals(candidate)
    ) {
      return undefined;
    }
    const assignmentId = opaque(own(candidate, 'assignmentId'));
    const assignmentNonceDigest = digest(own(candidate, 'assignmentNonceDigest'));
    const activationEpoch = decimal(own(candidate, 'activationEpoch'));
    const intentId = opaque(own(candidate, 'intentId'));
    const jobId = opaque(own(candidate, 'jobId'));
    const attemptId = opaque(own(candidate, 'attemptId'));
    const platformAgentAccountId = opaque(own(candidate, 'platformAgentAccountId'));
    const enrollmentId = opaque(own(candidate, 'enrollmentId'));
    const enrollmentBodyDigest = digest(own(candidate, 'enrollmentBodyDigest'));
    const noMoneyCertificateId = opaque(own(candidate, 'noMoneyCertificateId'));
    const noMoneyCertificateBodyDigest = digest(own(candidate, 'noMoneyCertificateBodyDigest'));
    const deviceId = opaque(own(candidate, 'deviceId'));
    const deviceKeyId = opaque(own(candidate, 'deviceKeyId'));
    const executionSignerKeyId = opaque(own(candidate, 'executionSignerKeyId'));
    const pilotId = opaque(own(candidate, 'pilotId'));
    const pilotRevision = postgresInteger(own(candidate, 'pilotRevision'));
    const pilotConfigDigest = digest(own(candidate, 'pilotConfigDigest'));
    const pilotReservationId = opaque(own(candidate, 'pilotReservationId'));
    const pilotReservationDigest = digest(own(candidate, 'pilotReservationDigest'));
    const playerIdDigest = digest(own(candidate, 'playerIdDigest'));
    const serverIssuedAt = timestamp(own(candidate, 'serverIssuedAt'));
    const serverNotBefore = timestamp(own(candidate, 'serverNotBefore'));
    const serverValidUntil = timestamp(own(candidate, 'serverValidUntil'));
    if (
      !assignmentId ||
      !assignmentNonceDigest ||
      !activationEpoch ||
      !intentId ||
      !jobId ||
      !attemptId ||
      !platformAgentAccountId ||
      !enrollmentId ||
      !enrollmentBodyDigest ||
      !noMoneyCertificateId ||
      !noMoneyCertificateBodyDigest ||
      !deviceId ||
      !deviceKeyId ||
      !executionSignerKeyId ||
      own(candidate, 'platformCode') !== COMPANION_EXECUTION_PLATFORM_CODE ||
      !pilotId ||
      !pilotRevision ||
      !pilotConfigDigest ||
      !pilotReservationId ||
      !pilotReservationDigest ||
      own(candidate, 'amountMinorUnits') !== COMPANION_EXECUTION_AMOUNT_MINOR_UNITS ||
      own(candidate, 'currencyCode') !== COMPANION_EXECUTION_CURRENCY_CODE ||
      !playerIdDigest ||
      own(candidate, 'oneUse') !== true ||
      !serverIssuedAt ||
      !serverNotBefore ||
      !serverValidUntil ||
      Date.parse(serverNotBefore) < Date.parse(serverIssuedAt) ||
      !validLifetime(
        serverNotBefore,
        serverValidUntil,
        COMPANION_EXECUTION_MAX_ASSIGNMENT_LIFETIME_MS,
      )
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      capability: COMPANION_EXECUTION_CAPABILITY,
      actionKind: COMPANION_EXECUTION_ACTION_KIND,
      assignmentId,
      assignmentNonceDigest,
      activationEpoch,
      intentId,
      jobId,
      attemptId,
      platformAgentAccountId,
      enrollmentId,
      enrollmentBodyDigest,
      noMoneyCertificateId,
      noMoneyCertificateBodyDigest,
      deviceId,
      deviceKeyId,
      executionSignerKeyId,
      platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
      pilotId,
      pilotRevision,
      pilotConfigDigest,
      pilotReservationId,
      pilotReservationDigest,
      amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
      currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
      playerIdDigest,
      oneUse: true,
      serverIssuedAt,
      serverNotBefore,
      serverValidUntil,
    });
  } catch {
    return undefined;
  }
}

export function decodeOneUseActionAuthorityBody(
  candidate: unknown,
): OneUseActionAuthorityBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, authorityBodyKeys) ||
      !commonBodyLiterals(candidate)
    ) {
      return undefined;
    }
    const authorityId = opaque(own(candidate, 'authorityId'));
    const assignmentId = opaque(own(candidate, 'assignmentId'));
    const assignmentBodyDigest = digest(own(candidate, 'assignmentBodyDigest'));
    const activationEpoch = decimal(own(candidate, 'activationEpoch'));
    const intentId = opaque(own(candidate, 'intentId'));
    const jobId = opaque(own(candidate, 'jobId'));
    const attemptId = opaque(own(candidate, 'attemptId'));
    const platformAgentAccountId = opaque(own(candidate, 'platformAgentAccountId'));
    const enrollmentId = opaque(own(candidate, 'enrollmentId'));
    const enrollmentBodyDigest = digest(own(candidate, 'enrollmentBodyDigest'));
    const noMoneyCertificateId = opaque(own(candidate, 'noMoneyCertificateId'));
    const noMoneyCertificateBodyDigest = digest(own(candidate, 'noMoneyCertificateBodyDigest'));
    const deviceId = opaque(own(candidate, 'deviceId'));
    const deviceKeyId = opaque(own(candidate, 'deviceKeyId'));
    const executionSignerKeyId = opaque(own(candidate, 'executionSignerKeyId'));
    const pilotId = opaque(own(candidate, 'pilotId'));
    const pilotRevision = postgresInteger(own(candidate, 'pilotRevision'));
    const pilotConfigDigest = digest(own(candidate, 'pilotConfigDigest'));
    const pilotReservationId = opaque(own(candidate, 'pilotReservationId'));
    const pilotReservationDigest = digest(own(candidate, 'pilotReservationDigest'));
    const playerIdDigest = digest(own(candidate, 'playerIdDigest'));
    const fenceId = opaque(own(candidate, 'fenceId'));
    const fenceNonceDigest = digest(own(candidate, 'fenceNonceDigest'));
    const requestNonceDigest = digest(own(candidate, 'requestNonceDigest'));
    const databaseFencedAt = timestamp(own(candidate, 'databaseFencedAt'));
    const databaseAuthorityIssuedAt = timestamp(own(candidate, 'databaseAuthorityIssuedAt'));
    const serverValidUntil = timestamp(own(candidate, 'serverValidUntil'));
    if (
      !authorityId ||
      !assignmentId ||
      !assignmentBodyDigest ||
      !activationEpoch ||
      !intentId ||
      !jobId ||
      !attemptId ||
      !platformAgentAccountId ||
      !enrollmentId ||
      !enrollmentBodyDigest ||
      !noMoneyCertificateId ||
      !noMoneyCertificateBodyDigest ||
      !deviceId ||
      !deviceKeyId ||
      !executionSignerKeyId ||
      own(candidate, 'platformCode') !== COMPANION_EXECUTION_PLATFORM_CODE ||
      !pilotId ||
      !pilotRevision ||
      !pilotConfigDigest ||
      !pilotReservationId ||
      !pilotReservationDigest ||
      own(candidate, 'amountMinorUnits') !== COMPANION_EXECUTION_AMOUNT_MINOR_UNITS ||
      own(candidate, 'currencyCode') !== COMPANION_EXECUTION_CURRENCY_CODE ||
      !playerIdDigest ||
      !fenceId ||
      !fenceNonceDigest ||
      own(candidate, 'databaseFenceState') !== 'first_fence_acquired' ||
      own(candidate, 'firstFenceAcquired') !== true ||
      !requestNonceDigest ||
      own(candidate, 'oneUse') !== true ||
      !databaseFencedAt ||
      !databaseAuthorityIssuedAt ||
      !serverValidUntil ||
      Date.parse(databaseAuthorityIssuedAt) < Date.parse(databaseFencedAt) ||
      Date.parse(databaseAuthorityIssuedAt) - Date.parse(databaseFencedAt) >=
        COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS ||
      Date.parse(serverValidUntil) >
        Date.parse(databaseFencedAt) + COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS ||
      !validLifetime(
        databaseAuthorityIssuedAt,
        serverValidUntil,
        COMPANION_EXECUTION_MAX_AUTHORITY_LIFETIME_MS,
      )
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      capability: COMPANION_EXECUTION_CAPABILITY,
      actionKind: COMPANION_EXECUTION_ACTION_KIND,
      authorityId,
      assignmentId,
      assignmentBodyDigest,
      activationEpoch,
      intentId,
      jobId,
      attemptId,
      platformAgentAccountId,
      enrollmentId,
      enrollmentBodyDigest,
      noMoneyCertificateId,
      noMoneyCertificateBodyDigest,
      deviceId,
      deviceKeyId,
      executionSignerKeyId,
      platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
      pilotId,
      pilotRevision,
      pilotConfigDigest,
      pilotReservationId,
      pilotReservationDigest,
      amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
      currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
      playerIdDigest,
      fenceId,
      fenceNonceDigest,
      databaseFenceState: 'first_fence_acquired',
      firstFenceAcquired: true,
      requestNonceDigest,
      oneUse: true,
      databaseFencedAt,
      databaseAuthorityIssuedAt,
      serverValidUntil,
    });
  } catch {
    return undefined;
  }
}

export function decodeExecutionResultBody(candidate: unknown): ExecutionResultBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, resultBodyKeys) ||
      !commonBodyLiterals(candidate)
    ) {
      return undefined;
    }
    const resultId = opaque(own(candidate, 'resultId'));
    const assignmentId = opaque(own(candidate, 'assignmentId'));
    const assignmentBodyDigest = digest(own(candidate, 'assignmentBodyDigest'));
    const authorityId = nullableOpaque(own(candidate, 'authorityId'));
    const authorityBodyDigest = nullableDigest(own(candidate, 'authorityBodyDigest'));
    const activationEpoch = decimal(own(candidate, 'activationEpoch'));
    const intentId = opaque(own(candidate, 'intentId'));
    const jobId = opaque(own(candidate, 'jobId'));
    const attemptId = opaque(own(candidate, 'attemptId'));
    const platformAgentAccountId = opaque(own(candidate, 'platformAgentAccountId'));
    const enrollmentId = opaque(own(candidate, 'enrollmentId'));
    const enrollmentBodyDigest = digest(own(candidate, 'enrollmentBodyDigest'));
    const noMoneyCertificateId = opaque(own(candidate, 'noMoneyCertificateId'));
    const noMoneyCertificateBodyDigest = digest(own(candidate, 'noMoneyCertificateBodyDigest'));
    const deviceId = opaque(own(candidate, 'deviceId'));
    const deviceKeyId = opaque(own(candidate, 'deviceKeyId'));
    const executionSignerKeyId = opaque(own(candidate, 'executionSignerKeyId'));
    const pilotId = opaque(own(candidate, 'pilotId'));
    const pilotRevision = postgresInteger(own(candidate, 'pilotRevision'));
    const pilotConfigDigest = digest(own(candidate, 'pilotConfigDigest'));
    const pilotReservationId = opaque(own(candidate, 'pilotReservationId'));
    const pilotReservationDigest = digest(own(candidate, 'pilotReservationDigest'));
    const playerIdDigest = digest(own(candidate, 'playerIdDigest'));
    const fenceId = nullableOpaque(own(candidate, 'fenceId'));
    const fenceNonceDigest = nullableDigest(own(candidate, 'fenceNonceDigest'));
    const requestNonceDigest = nullableDigest(own(candidate, 'requestNonceDigest'));
    const outcome = own(candidate, 'outcome');
    const finalActionStarted = own(candidate, 'finalActionStarted');
    const finalActionStartedAt = nullableTimestamp(own(candidate, 'finalActionStartedAt'));
    const providerResponseDigest = nullableDigest(own(candidate, 'providerResponseDigest'));
    const evidenceDigest = digest(own(candidate, 'evidenceDigest'));
    const reportedAt = timestamp(own(candidate, 'reportedAt'));
    const authorityPresent =
      typeof authorityId === 'string' &&
      typeof authorityBodyDigest === 'string' &&
      typeof fenceId === 'string' &&
      typeof fenceNonceDigest === 'string' &&
      typeof requestNonceDigest === 'string';
    const authorityAbsent =
      authorityId === null &&
      authorityBodyDigest === null &&
      fenceId === null &&
      fenceNonceDigest === null &&
      requestNonceDigest === null;
    const outcomeSemantics =
      (outcome === 'submission_attempted' &&
        finalActionStarted === true &&
        typeof finalActionStartedAt === 'string' &&
        authorityPresent &&
        typeof reportedAt === 'string' &&
        Date.parse(reportedAt) >= Date.parse(finalActionStartedAt) &&
        typeof providerResponseDigest === 'string') ||
      (outcome === 'local_uncertain' &&
        finalActionStarted === true &&
        typeof finalActionStartedAt === 'string' &&
        authorityPresent &&
        typeof reportedAt === 'string' &&
        Date.parse(reportedAt) >= Date.parse(finalActionStartedAt) &&
        providerResponseDigest !== undefined) ||
      (outcome === 'refused_before_fence' &&
        finalActionStarted === false &&
        finalActionStartedAt === null &&
        authorityAbsent &&
        providerResponseDigest === null);
    if (
      !resultId ||
      !assignmentId ||
      !assignmentBodyDigest ||
      authorityId === undefined ||
      authorityBodyDigest === undefined ||
      !activationEpoch ||
      !intentId ||
      !jobId ||
      !attemptId ||
      !platformAgentAccountId ||
      !enrollmentId ||
      !enrollmentBodyDigest ||
      !noMoneyCertificateId ||
      !noMoneyCertificateBodyDigest ||
      !deviceId ||
      !deviceKeyId ||
      !executionSignerKeyId ||
      own(candidate, 'platformCode') !== COMPANION_EXECUTION_PLATFORM_CODE ||
      !pilotId ||
      !pilotRevision ||
      !pilotConfigDigest ||
      !pilotReservationId ||
      !pilotReservationDigest ||
      own(candidate, 'amountMinorUnits') !== COMPANION_EXECUTION_AMOUNT_MINOR_UNITS ||
      own(candidate, 'currencyCode') !== COMPANION_EXECUTION_CURRENCY_CODE ||
      !playerIdDigest ||
      fenceId === undefined ||
      fenceNonceDigest === undefined ||
      requestNonceDigest === undefined ||
      finalActionStartedAt === undefined ||
      providerResponseDigest === undefined ||
      !evidenceDigest ||
      !reportedAt ||
      !outcomeSemantics
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      capability: COMPANION_EXECUTION_CAPABILITY,
      actionKind: COMPANION_EXECUTION_ACTION_KIND,
      resultId,
      assignmentId,
      assignmentBodyDigest,
      authorityId,
      authorityBodyDigest,
      activationEpoch,
      intentId,
      jobId,
      attemptId,
      platformAgentAccountId,
      enrollmentId,
      enrollmentBodyDigest,
      noMoneyCertificateId,
      noMoneyCertificateBodyDigest,
      deviceId,
      deviceKeyId,
      executionSignerKeyId,
      platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
      pilotId,
      pilotRevision,
      pilotConfigDigest,
      pilotReservationId,
      pilotReservationDigest,
      amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
      currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
      playerIdDigest,
      fenceId,
      fenceNonceDigest,
      requestNonceDigest,
      outcome: outcome as ExecutionResultOutcome,
      finalActionStarted: finalActionStarted as boolean,
      finalActionStartedAt,
      providerResponseDigest,
      evidenceDigest,
      reportedAt,
    });
  } catch {
    return undefined;
  }
}

function validAuthoritativeStateCombination(
  fence: DatabaseFenceState,
  attempt: DatabaseAttemptState,
  reconciliation: DatabaseReconciliationState,
  terminal: AuthoritativeTerminalState,
  authorityPresent: boolean,
  resultDigest: string | null,
  responseDigest: string | null,
  evidenceDigest: string | null,
): boolean {
  if (
    !authorityPresent &&
    fence === 'not_acquired' &&
    attempt === 'refused_before_fence' &&
    reconciliation === 'not_required' &&
    terminal === 'refused'
  ) {
    return resultDigest === null && responseDigest === null && evidenceDigest === null;
  }
  if (!authorityPresent || fence === 'not_acquired') return false;
  if (
    fence === 'acquired' &&
    attempt === 'not_started' &&
    reconciliation === 'pending' &&
    terminal === 'non_terminal'
  ) {
    return resultDigest === null && responseDigest === null && evidenceDigest === null;
  }
  if (
    fence === 'consumed' &&
    attempt === 'submission_attempted' &&
    reconciliation === 'pending' &&
    terminal === 'non_terminal'
  ) {
    return resultDigest !== null;
  }
  if (
    fence === 'consumed' &&
    attempt === 'local_uncertain' &&
    reconciliation === 'uncertain' &&
    terminal === 'uncertain'
  ) {
    return resultDigest !== null && evidenceDigest !== null;
  }
  if (
    fence === 'consumed' &&
    attempt === 'submission_attempted' &&
    reconciliation === 'succeeded' &&
    terminal === 'succeeded'
  ) {
    return resultDigest !== null && responseDigest !== null && evidenceDigest !== null;
  }
  return (
    fence === 'consumed' &&
    attempt === 'submission_attempted' &&
    reconciliation === 'failed' &&
    terminal === 'failed' &&
    resultDigest !== null &&
    evidenceDigest !== null
  );
}

export function decodeAuthoritativeExecutionStatusBody(
  candidate: unknown,
): AuthoritativeExecutionStatusBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, statusBodyKeys) ||
      !commonBodyLiterals(candidate) ||
      own(candidate, 'statusKind') !== 'authoritative_execution_status' ||
      own(candidate, 'grantsActionAuthority') !== false ||
      own(candidate, 'oneUseActionAuthority') !== false
    ) {
      return undefined;
    }
    const statusId = opaque(own(candidate, 'statusId'));
    const statusSequence = decimal(own(candidate, 'statusSequence'));
    const queryNonceDigest = digest(own(candidate, 'queryNonceDigest'));
    const assignmentId = opaque(own(candidate, 'assignmentId'));
    const assignmentBodyDigest = digest(own(candidate, 'assignmentBodyDigest'));
    const authorityId = nullableOpaque(own(candidate, 'authorityId'));
    const authorityBodyDigest = nullableDigest(own(candidate, 'authorityBodyDigest'));
    const activationEpoch = decimal(own(candidate, 'activationEpoch'));
    const intentId = opaque(own(candidate, 'intentId'));
    const jobId = opaque(own(candidate, 'jobId'));
    const attemptId = opaque(own(candidate, 'attemptId'));
    const platformAgentAccountId = opaque(own(candidate, 'platformAgentAccountId'));
    const enrollmentId = opaque(own(candidate, 'enrollmentId'));
    const enrollmentBodyDigest = digest(own(candidate, 'enrollmentBodyDigest'));
    const noMoneyCertificateId = opaque(own(candidate, 'noMoneyCertificateId'));
    const noMoneyCertificateBodyDigest = digest(own(candidate, 'noMoneyCertificateBodyDigest'));
    const deviceId = opaque(own(candidate, 'deviceId'));
    const deviceKeyId = opaque(own(candidate, 'deviceKeyId'));
    const executionSignerKeyId = opaque(own(candidate, 'executionSignerKeyId'));
    const pilotId = opaque(own(candidate, 'pilotId'));
    const pilotRevision = postgresInteger(own(candidate, 'pilotRevision'));
    const pilotConfigDigest = digest(own(candidate, 'pilotConfigDigest'));
    const pilotReservationId = opaque(own(candidate, 'pilotReservationId'));
    const pilotReservationDigest = digest(own(candidate, 'pilotReservationDigest'));
    const playerIdDigest = digest(own(candidate, 'playerIdDigest'));
    const fenceId = nullableOpaque(own(candidate, 'fenceId'));
    const databaseFenceState = own(candidate, 'databaseFenceState');
    const databaseAttemptState = own(candidate, 'databaseAttemptState');
    const databaseReconciliationState = own(candidate, 'databaseReconciliationState');
    const terminalState = own(candidate, 'terminalState');
    const executionResultBodyDigest = nullableDigest(own(candidate, 'executionResultBodyDigest'));
    const providerResponseDigest = nullableDigest(own(candidate, 'providerResponseDigest'));
    const evidenceDigest = nullableDigest(own(candidate, 'evidenceDigest'));
    const databaseObservedAt = timestamp(own(candidate, 'databaseObservedAt'));
    const serverIssuedAt = timestamp(own(candidate, 'serverIssuedAt'));
    const serverValidUntil = timestamp(own(candidate, 'serverValidUntil'));
    const authorityPresent =
      typeof authorityId === 'string' &&
      typeof authorityBodyDigest === 'string' &&
      typeof fenceId === 'string';
    const authorityAbsent =
      authorityId === null && authorityBodyDigest === null && fenceId === null;
    if (
      !statusId ||
      !statusSequence ||
      !queryNonceDigest ||
      !assignmentId ||
      !assignmentBodyDigest ||
      authorityId === undefined ||
      authorityBodyDigest === undefined ||
      !activationEpoch ||
      !intentId ||
      !jobId ||
      !attemptId ||
      !platformAgentAccountId ||
      !enrollmentId ||
      !enrollmentBodyDigest ||
      !noMoneyCertificateId ||
      !noMoneyCertificateBodyDigest ||
      !deviceId ||
      !deviceKeyId ||
      !executionSignerKeyId ||
      own(candidate, 'platformCode') !== COMPANION_EXECUTION_PLATFORM_CODE ||
      !pilotId ||
      !pilotRevision ||
      !pilotConfigDigest ||
      !pilotReservationId ||
      !pilotReservationDigest ||
      own(candidate, 'amountMinorUnits') !== COMPANION_EXECUTION_AMOUNT_MINOR_UNITS ||
      own(candidate, 'currencyCode') !== COMPANION_EXECUTION_CURRENCY_CODE ||
      !playerIdDigest ||
      fenceId === undefined ||
      (databaseFenceState !== 'not_acquired' &&
        databaseFenceState !== 'acquired' &&
        databaseFenceState !== 'consumed') ||
      (databaseAttemptState !== 'refused_before_fence' &&
        databaseAttemptState !== 'not_started' &&
        databaseAttemptState !== 'submission_attempted' &&
        databaseAttemptState !== 'local_uncertain') ||
      (databaseReconciliationState !== 'not_required' &&
        databaseReconciliationState !== 'pending' &&
        databaseReconciliationState !== 'succeeded' &&
        databaseReconciliationState !== 'failed' &&
        databaseReconciliationState !== 'uncertain') ||
      (terminalState !== 'refused' &&
        terminalState !== 'non_terminal' &&
        terminalState !== 'succeeded' &&
        terminalState !== 'failed' &&
        terminalState !== 'uncertain') ||
      executionResultBodyDigest === undefined ||
      providerResponseDigest === undefined ||
      evidenceDigest === undefined ||
      !databaseObservedAt ||
      !serverIssuedAt ||
      !serverValidUntil ||
      Date.parse(serverIssuedAt) < Date.parse(databaseObservedAt) ||
      !validLifetime(
        serverIssuedAt,
        serverValidUntil,
        COMPANION_EXECUTION_MAX_STATUS_LIFETIME_MS,
      ) ||
      (!authorityPresent && !authorityAbsent) ||
      !validAuthoritativeStateCombination(
        databaseFenceState,
        databaseAttemptState,
        databaseReconciliationState,
        terminalState,
        authorityPresent,
        executionResultBodyDigest,
        providerResponseDigest,
        evidenceDigest,
      )
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      statusKind: 'authoritative_execution_status',
      grantsActionAuthority: false,
      oneUseActionAuthority: false,
      capability: COMPANION_EXECUTION_CAPABILITY,
      actionKind: COMPANION_EXECUTION_ACTION_KIND,
      statusId,
      statusSequence,
      queryNonceDigest,
      assignmentId,
      assignmentBodyDigest,
      authorityId,
      authorityBodyDigest,
      activationEpoch,
      intentId,
      jobId,
      attemptId,
      platformAgentAccountId,
      enrollmentId,
      enrollmentBodyDigest,
      noMoneyCertificateId,
      noMoneyCertificateBodyDigest,
      deviceId,
      deviceKeyId,
      executionSignerKeyId,
      platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
      pilotId,
      pilotRevision,
      pilotConfigDigest,
      pilotReservationId,
      pilotReservationDigest,
      amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
      currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
      playerIdDigest,
      fenceId,
      databaseFenceState,
      databaseAttemptState,
      databaseReconciliationState,
      terminalState,
      executionResultBodyDigest,
      providerResponseDigest,
      evidenceDigest,
      databaseObservedAt,
      serverIssuedAt,
      serverValidUntil,
    });
  } catch {
    return undefined;
  }
}

type BodyDecoder<T> = (candidate: unknown) => T | undefined;

function canonicalBodyBytes<T>(
  candidate: unknown,
  decoder: BodyDecoder<T>,
  keys: readonly string[],
  domain: string,
): Buffer | undefined {
  const body = decoder(candidate);
  return body
    ? encodeFields(domain, bodyFields(body as unknown as UnknownRecord, keys))
    : undefined;
}

export function canonicalExecutionEnrollmentBodyBytes(candidate: unknown): Buffer | undefined {
  return canonicalBodyBytes(
    candidate,
    decodeExecutionEnrollmentBody,
    enrollmentBodyKeys,
    'fetanagent:agent-platform-companion:execution-enrollment-body:v2',
  );
}

export function digestExecutionEnrollmentBody(candidate: unknown): string | undefined {
  const bytes = canonicalExecutionEnrollmentBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalExecutionAssignmentBodyBytes(candidate: unknown): Buffer | undefined {
  return canonicalBodyBytes(
    candidate,
    decodeExecutionAssignmentBody,
    assignmentBodyKeys,
    'fetanagent:agent-platform-companion:execution-assignment-body:v2',
  );
}

export function digestExecutionAssignmentBody(candidate: unknown): string | undefined {
  const bytes = canonicalExecutionAssignmentBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalOneUseActionAuthorityBodyBytes(candidate: unknown): Buffer | undefined {
  return canonicalBodyBytes(
    candidate,
    decodeOneUseActionAuthorityBody,
    authorityBodyKeys,
    'fetanagent:agent-platform-companion:one-use-action-authority-body:v2',
  );
}

export function digestOneUseActionAuthorityBody(candidate: unknown): string | undefined {
  const bytes = canonicalOneUseActionAuthorityBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalExecutionResultBodyBytes(candidate: unknown): Buffer | undefined {
  return canonicalBodyBytes(
    candidate,
    decodeExecutionResultBody,
    resultBodyKeys,
    'fetanagent:agent-platform-companion:execution-result-body:v2',
  );
}

export function digestExecutionResultBody(candidate: unknown): string | undefined {
  const bytes = canonicalExecutionResultBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalAuthoritativeExecutionStatusBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  return canonicalBodyBytes(
    candidate,
    decodeAuthoritativeExecutionStatusBody,
    statusBodyKeys,
    'fetanagent:agent-platform-companion:authoritative-execution-status-body:v2',
  );
}

export function digestAuthoritativeExecutionStatusBody(candidate: unknown): string | undefined {
  const bytes = canonicalAuthoritativeExecutionStatusBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

function canonicalServerSignatureBytes<T extends { readonly executionSignerKeyId: string }>(
  candidate: unknown,
  decoder: BodyDecoder<T>,
  digestBody: (candidate: unknown) => string | undefined,
  transcriptVersion: string,
  domain: string,
): Buffer | undefined {
  const body = decoder(candidate);
  const bodyDigest = body && digestBody(body);
  return body && bodyDigest
    ? encodeFields(domain, [
        ['contractVersion', COMPANION_EXECUTION_CONTRACT_VERSION],
        ['protocolMode', COMPANION_EXECUTION_PROTOCOL_MODE],
        ['transcriptVersion', transcriptVersion],
        ['bodyDigestAlgorithm', COMPANION_EXECUTION_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', COMPANION_EXECUTION_SIGNATURE_ALGORITHM],
        ['signatureEncoding', COMPANION_EXECUTION_SIGNATURE_ENCODING],
        ['signerKeyId', body.executionSignerKeyId],
      ])
    : undefined;
}

export function canonicalExecutionEnrollmentSignatureBytes(candidate: unknown): Buffer | undefined {
  return canonicalServerSignatureBytes(
    candidate,
    decodeExecutionEnrollmentBody,
    digestExecutionEnrollmentBody,
    COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT,
    'fetanagent:agent-platform-companion:execution-enrollment-signature:v2',
  );
}

export function canonicalExecutionAssignmentSignatureBytes(candidate: unknown): Buffer | undefined {
  return canonicalServerSignatureBytes(
    candidate,
    decodeExecutionAssignmentBody,
    digestExecutionAssignmentBody,
    COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT,
    'fetanagent:agent-platform-companion:execution-assignment-signature:v2',
  );
}

export function canonicalOneUseActionAuthoritySignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  return canonicalServerSignatureBytes(
    candidate,
    decodeOneUseActionAuthorityBody,
    digestOneUseActionAuthorityBody,
    COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT,
    'fetanagent:agent-platform-companion:one-use-action-authority-signature:v2',
  );
}

export function canonicalAuthoritativeExecutionStatusSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  return canonicalServerSignatureBytes(
    candidate,
    decodeAuthoritativeExecutionStatusBody,
    digestAuthoritativeExecutionStatusBody,
    COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT,
    'fetanagent:agent-platform-companion:authoritative-execution-status-signature:v2',
  );
}

export function canonicalExecutionResultSignatureBytes(candidate: unknown): Buffer | undefined {
  const body = decodeExecutionResultBody(candidate);
  const bodyDigest = body && digestExecutionResultBody(body);
  return body && bodyDigest
    ? encodeFields('fetanagent:agent-platform-companion:execution-result-signature:v2', [
        ['contractVersion', COMPANION_EXECUTION_CONTRACT_VERSION],
        ['protocolMode', COMPANION_EXECUTION_PROTOCOL_MODE],
        ['transcriptVersion', COMPANION_EXECUTION_RESULT_TRANSCRIPT],
        ['bodyDigestAlgorithm', COMPANION_EXECUTION_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', COMPANION_EXECUTION_SIGNATURE_ALGORITHM],
        ['signatureEncoding', COMPANION_EXECUTION_SIGNATURE_ENCODING],
        ['deviceKeyId', body.deviceKeyId],
      ])
    : undefined;
}

interface DecodedServerEnvelope<T> {
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly transcriptVersion: string;
  readonly bodyDigestAlgorithm: typeof COMPANION_EXECUTION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof COMPANION_EXECUTION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof COMPANION_EXECUTION_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: T;
  readonly signature: string;
}

function decodeServerEnvelope<T extends { readonly executionSignerKeyId: string }>(
  candidate: unknown,
  transcriptVersion: string,
  decoder: BodyDecoder<T>,
): DecodedServerEnvelope<T> | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, serverEnvelopeKeys) ||
      !hasHeader(candidate)
    ) {
      return undefined;
    }
    const body = decoder(own(candidate, 'body'));
    const bodyDigest = digest(own(candidate, 'bodyDigest'));
    const signerKeyId = opaque(own(candidate, 'signerKeyId'));
    const encodedSignature = parseSignature(own(candidate, 'signature'));
    if (
      own(candidate, 'transcriptVersion') !== transcriptVersion ||
      own(candidate, 'bodyDigestAlgorithm') !== COMPANION_EXECUTION_DIGEST_ALGORITHM ||
      !bodyDigest ||
      own(candidate, 'signatureAlgorithm') !== COMPANION_EXECUTION_SIGNATURE_ALGORITHM ||
      own(candidate, 'signatureEncoding') !== COMPANION_EXECUTION_SIGNATURE_ENCODING ||
      !signerKeyId ||
      !body ||
      signerKeyId !== body.executionSignerKeyId ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      transcriptVersion,
      bodyDigestAlgorithm: COMPANION_EXECUTION_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
      signatureEncoding: COMPANION_EXECUTION_SIGNATURE_ENCODING,
      signerKeyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

export function decodeSignedExecutionEnrollment(
  candidate: unknown,
): SignedExecutionEnrollment | undefined {
  return decodeServerEnvelope(
    candidate,
    COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT,
    decodeExecutionEnrollmentBody,
  ) as SignedExecutionEnrollment | undefined;
}

export function decodeSignedExecutionAssignment(
  candidate: unknown,
): SignedExecutionAssignment | undefined {
  return decodeServerEnvelope(
    candidate,
    COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT,
    decodeExecutionAssignmentBody,
  ) as SignedExecutionAssignment | undefined;
}

export function decodeSignedOneUseActionAuthority(
  candidate: unknown,
): SignedOneUseActionAuthority | undefined {
  return decodeServerEnvelope(
    candidate,
    COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT,
    decodeOneUseActionAuthorityBody,
  ) as SignedOneUseActionAuthority | undefined;
}

export function decodeSignedAuthoritativeExecutionStatus(
  candidate: unknown,
): SignedAuthoritativeExecutionStatus | undefined {
  return decodeServerEnvelope(
    candidate,
    COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT,
    decodeAuthoritativeExecutionStatusBody,
  ) as SignedAuthoritativeExecutionStatus | undefined;
}

export function decodeSignedExecutionResult(candidate: unknown): SignedExecutionResult | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, deviceEnvelopeKeys) ||
      !hasHeader(candidate)
    ) {
      return undefined;
    }
    const body = decodeExecutionResultBody(own(candidate, 'body'));
    const bodyDigest = digest(own(candidate, 'bodyDigest'));
    const deviceKeyId = opaque(own(candidate, 'deviceKeyId'));
    const encodedSignature = parseSignature(own(candidate, 'signature'));
    if (
      own(candidate, 'transcriptVersion') !== COMPANION_EXECUTION_RESULT_TRANSCRIPT ||
      own(candidate, 'bodyDigestAlgorithm') !== COMPANION_EXECUTION_DIGEST_ALGORITHM ||
      !bodyDigest ||
      own(candidate, 'signatureAlgorithm') !== COMPANION_EXECUTION_SIGNATURE_ALGORITHM ||
      own(candidate, 'signatureEncoding') !== COMPANION_EXECUTION_SIGNATURE_ENCODING ||
      !deviceKeyId ||
      !body ||
      deviceKeyId !== body.deviceKeyId ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      transcriptVersion: COMPANION_EXECUTION_RESULT_TRANSCRIPT,
      bodyDigestAlgorithm: COMPANION_EXECUTION_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
      signatureEncoding: COMPANION_EXECUTION_SIGNATURE_ENCODING,
      deviceKeyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

function createServerEnvelope<T extends { readonly executionSignerKeyId: string }>(
  bodyCandidate: unknown,
  privateKeyCandidate: unknown,
  decoder: BodyDecoder<T>,
  bodyDigestFunction: (candidate: unknown) => string | undefined,
  signatureBytesFunction: (candidate: unknown) => Buffer | undefined,
  transcriptVersion: string,
): DecodedServerEnvelope<T> | undefined {
  const body = decoder(bodyCandidate);
  const bodyDigest = body && bodyDigestFunction(body);
  const signature = body && signP1363Transcript(signatureBytesFunction(body), privateKeyCandidate);
  return body && bodyDigest && signature
    ? Object.freeze({
        contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
        protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
        transcriptVersion,
        bodyDigestAlgorithm: COMPANION_EXECUTION_DIGEST_ALGORITHM,
        bodyDigest,
        signatureAlgorithm: COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
        signatureEncoding: COMPANION_EXECUTION_SIGNATURE_ENCODING,
        signerKeyId: body.executionSignerKeyId,
        body,
        signature,
      })
    : undefined;
}

export function signExecutionEnrollment(
  bodyCandidate: unknown,
  executionSignerPrivateKey: unknown,
): SignedExecutionEnrollment | undefined {
  const body = decodeExecutionEnrollmentBody(bodyCandidate);
  const key = parseP256PrivateKey(executionSignerPrivateKey);
  if (
    !body ||
    !key ||
    key.publicKey.encoded !== body.executionSignerPublicKeySpki ||
    key.publicKey.digest !== body.executionSignerPublicKeySpkiSha256
  ) {
    return undefined;
  }
  return createServerEnvelope(
    body,
    key.key,
    decodeExecutionEnrollmentBody,
    digestExecutionEnrollmentBody,
    canonicalExecutionEnrollmentSignatureBytes,
    COMPANION_EXECUTION_ENROLLMENT_TRANSCRIPT,
  ) as SignedExecutionEnrollment | undefined;
}

export function signExecutionAssignment(
  bodyCandidate: unknown,
  executionSignerPrivateKey: unknown,
): SignedExecutionAssignment | undefined {
  return createServerEnvelope(
    bodyCandidate,
    executionSignerPrivateKey,
    decodeExecutionAssignmentBody,
    digestExecutionAssignmentBody,
    canonicalExecutionAssignmentSignatureBytes,
    COMPANION_EXECUTION_ASSIGNMENT_TRANSCRIPT,
  ) as SignedExecutionAssignment | undefined;
}

export function signOneUseActionAuthority(
  bodyCandidate: unknown,
  executionSignerPrivateKey: unknown,
): SignedOneUseActionAuthority | undefined {
  return createServerEnvelope(
    bodyCandidate,
    executionSignerPrivateKey,
    decodeOneUseActionAuthorityBody,
    digestOneUseActionAuthorityBody,
    canonicalOneUseActionAuthoritySignatureBytes,
    COMPANION_ONE_USE_ACTION_AUTHORITY_TRANSCRIPT,
  ) as SignedOneUseActionAuthority | undefined;
}

export function signExecutionResult(
  bodyCandidate: unknown,
  devicePrivateKey: unknown,
): SignedExecutionResult | undefined {
  const body = decodeExecutionResultBody(bodyCandidate);
  const bodyDigest = body && digestExecutionResultBody(body);
  const signature =
    body && signP1363Transcript(canonicalExecutionResultSignatureBytes(body), devicePrivateKey);
  return body && bodyDigest && signature
    ? Object.freeze({
        contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
        protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
        transcriptVersion: COMPANION_EXECUTION_RESULT_TRANSCRIPT,
        bodyDigestAlgorithm: COMPANION_EXECUTION_DIGEST_ALGORITHM,
        bodyDigest,
        signatureAlgorithm: COMPANION_EXECUTION_SIGNATURE_ALGORITHM,
        signatureEncoding: COMPANION_EXECUTION_SIGNATURE_ENCODING,
        deviceKeyId: body.deviceKeyId,
        body,
        signature,
      })
    : undefined;
}

export function signAuthoritativeExecutionStatus(
  bodyCandidate: unknown,
  executionSignerPrivateKey: unknown,
): SignedAuthoritativeExecutionStatus | undefined {
  return createServerEnvelope(
    bodyCandidate,
    executionSignerPrivateKey,
    decodeAuthoritativeExecutionStatusBody,
    digestAuthoritativeExecutionStatusBody,
    canonicalAuthoritativeExecutionStatusSignatureBytes,
    COMPANION_AUTHORITATIVE_EXECUTION_STATUS_TRANSCRIPT,
  ) as SignedAuthoritativeExecutionStatus | undefined;
}

export function digestCompanionExecutionPlayerId(playerIdCandidate: unknown): string | undefined {
  return typeof playerIdCandidate === 'string' && PLAYER_ID_PATTERN.test(playerIdCandidate)
    ? sha256(
        encodeFields('fetanagent:agent-platform-companion:execution-player-id:v2', [
          ['platformCode', COMPANION_EXECUTION_PLATFORM_CODE],
          ['playerId', playerIdCandidate],
        ]),
      )
    : undefined;
}

export function digestCompanionExecutionNonce(nonceCandidate: unknown): string | undefined {
  try {
    if (!(nonceCandidate instanceof Uint8Array) || isProxy(nonceCandidate)) return undefined;
    const nonce = Buffer.from(nonceCandidate);
    return nonce.byteLength >= 16 && nonce.byteLength <= 64
      ? sha256(
          encodeFields('fetanagent:agent-platform-companion:execution-nonce:v2', [
            ['nonceLength', nonce.byteLength],
            ['nonceBase64url', nonce.toString('base64url')],
          ]),
        )
      : undefined;
  } catch {
    return undefined;
  }
}

function replayIdentity<T extends object>(
  candidate: unknown,
  decoder: BodyDecoder<T>,
  digestBody: (candidate: unknown) => string | undefined,
  domain: string,
  identityKeys: readonly string[],
): string | undefined {
  const body = decoder(candidate);
  const bodyDigest = body && digestBody(body);
  const record = body as unknown as Record<string, unknown> | undefined;
  return body && bodyDigest
    ? sha256(
        encodeFields(domain, [
          ...identityKeys.map((key) => [key, record?.[key] as Scalar] as const),
          ['bodyDigest', bodyDigest],
        ]),
      )
    : undefined;
}

export function deriveExecutionAssignmentReplayIdentity(candidate: unknown): string | undefined {
  const envelope = decodeSignedExecutionAssignment(candidate);
  return envelope
    ? replayIdentity(
        envelope.body,
        decodeExecutionAssignmentBody,
        digestExecutionAssignmentBody,
        'fetanagent:agent-platform-companion:execution-assignment-replay:v2',
        [
          'assignmentId',
          'activationEpoch',
          'intentId',
          'jobId',
          'attemptId',
          'assignmentNonceDigest',
        ],
      )
    : undefined;
}

export function deriveOneUseActionAuthorityReplayIdentity(candidate: unknown): string | undefined {
  const envelope = decodeSignedOneUseActionAuthority(candidate);
  return envelope
    ? replayIdentity(
        envelope.body,
        decodeOneUseActionAuthorityBody,
        digestOneUseActionAuthorityBody,
        'fetanagent:agent-platform-companion:one-use-action-authority-replay:v2',
        [
          'authorityId',
          'assignmentId',
          'activationEpoch',
          'attemptId',
          'fenceId',
          'fenceNonceDigest',
        ],
      )
    : undefined;
}

export function deriveExecutionResultReplayIdentity(candidate: unknown): string | undefined {
  const envelope = decodeSignedExecutionResult(candidate);
  return envelope
    ? replayIdentity(
        envelope.body,
        decodeExecutionResultBody,
        digestExecutionResultBody,
        'fetanagent:agent-platform-companion:execution-result-replay:v2',
        ['resultId', 'assignmentId', 'authorityId', 'activationEpoch', 'attemptId', 'outcome'],
      )
    : undefined;
}

export function deriveAuthoritativeExecutionStatusReplayIdentity(
  candidate: unknown,
): string | undefined {
  const envelope = decodeSignedAuthoritativeExecutionStatus(candidate);
  return envelope
    ? replayIdentity(
        envelope.body,
        decodeAuthoritativeExecutionStatusBody,
        digestAuthoritativeExecutionStatusBody,
        'fetanagent:agent-platform-companion:authoritative-execution-status-replay:v2',
        [
          'statusId',
          'statusSequence',
          'queryNonceDigest',
          'assignmentId',
          'authorityId',
          'terminalState',
        ],
      )
    : undefined;
}

interface VerifiedEnrollmentChain {
  readonly enrollment: SignedExecutionEnrollment;
  readonly certificate: SignedCompanionEnrollmentCertificate;
  readonly executionKey: ParsedP256PublicKey;
  readonly deviceKey: ParsedP256PublicKey;
  readonly trustedNowMs: number;
}

function serverEnvelopeSignatureIsValid<T>(
  envelope: DecodedServerEnvelope<T>,
  expectedSignerKeyId: string,
  trustedKey: ParsedP256PublicKey,
  computedBodyDigest: string | undefined,
  transcript: Uint8Array | undefined,
): boolean {
  return (
    envelope.signerKeyId === expectedSignerKeyId &&
    envelope.bodyDigest === computedBodyDigest &&
    verifyP1363Signature(transcript, envelope.signature, trustedKey.key)
  );
}

type ChainValidityMode = 'currently_actionable' | 'historically_authenticated';

function verifyEnrollmentChainCore(
  candidate: unknown,
  context: TrustedExecutionIdentityContext,
  validityMode: ChainValidityMode,
): VerifiedEnrollmentChain | undefined {
  try {
    const enrollment = decodeSignedExecutionEnrollment(candidate);
    const certificate = decodeSignedCompanionEnrollmentCertificate(
      context.signedNoMoneyCertificate,
    );
    const noMoneyCertificateBodyDigest =
      certificate && digestCompanionEnrollmentCertificateBody(certificate.body);
    const trustedNoMoneyKey = parseP256SpkiBytes(context.trustedNoMoneyServerPublicKeySpkiDer);
    const executionKey = parseP256SpkiBytes(context.trustedExecutionSignerPublicKeySpkiDer);
    const deviceKey = certificate && parseP256SpkiText(certificate.body.devicePublicKeySpki);
    const expectedDeviceId = opaque(context.expectedDeviceId);
    const expectedDeviceKeyId = opaque(context.expectedDeviceKeyId);
    const expectedPlatformAgentAccountId = opaque(context.expectedPlatformAgentAccountId);
    const trustedExecutionSignerKeyId = opaque(context.trustedExecutionSignerKeyId);
    const nowMs = trustedNow(context.trustedNow);
    if (
      !enrollment ||
      !certificate ||
      !noMoneyCertificateBodyDigest ||
      !trustedNoMoneyKey ||
      !executionKey ||
      !deviceKey ||
      !expectedDeviceId ||
      !expectedDeviceKeyId ||
      !expectedPlatformAgentAccountId ||
      !trustedExecutionSignerKeyId ||
      nowMs === undefined ||
      certificate.body.state !== 'active' ||
      !verifySignedCompanionEnrollmentCertificate(
        certificate,
        context.trustedNoMoneyServerPublicKeySpkiDer,
      ) ||
      certificate.signerKeyId === trustedExecutionSignerKeyId ||
      trustedNoMoneyKey.digest === executionKey.digest ||
      enrollment.body.executionSignerKeyId !== trustedExecutionSignerKeyId ||
      enrollment.body.executionSignerPublicKeySpki !== executionKey.encoded ||
      enrollment.body.executionSignerPublicKeySpkiSha256 !== executionKey.digest ||
      enrollment.body.executionSignerPublicKeySpkiSha256 === deviceKey.digest ||
      !serverEnvelopeSignatureIsValid(
        enrollment,
        trustedExecutionSignerKeyId,
        executionKey,
        digestExecutionEnrollmentBody(enrollment.body),
        canonicalExecutionEnrollmentSignatureBytes(enrollment.body),
      ) ||
      enrollment.body.capabilityState !== 'active' ||
      enrollment.body.noMoneyCertificateId !== certificate.body.certificateId ||
      enrollment.body.noMoneyCertificateBodyDigest !== noMoneyCertificateBodyDigest ||
      enrollment.body.deviceId !== certificate.body.deviceId ||
      enrollment.body.deviceKeyId !== certificate.body.deviceKeyId ||
      enrollment.body.devicePublicKeySpkiSha256 !== certificate.body.devicePublicKeySpkiSha256 ||
      enrollment.body.deviceId !== expectedDeviceId ||
      enrollment.body.deviceKeyId !== expectedDeviceKeyId ||
      enrollment.body.platformAgentAccountId !== expectedPlatformAgentAccountId ||
      Date.parse(enrollment.body.issuedAt) < Date.parse(certificate.body.issuedAt) ||
      Date.parse(enrollment.body.validFrom) < Date.parse(certificate.body.validFrom) ||
      Date.parse(enrollment.body.validUntil) > Date.parse(certificate.body.validUntil) ||
      (validityMode === 'currently_actionable' &&
        (nowMs < Date.parse(certificate.body.validFrom) ||
          nowMs >= Date.parse(certificate.body.validUntil) ||
          nowMs < Date.parse(enrollment.body.validFrom) ||
          nowMs >= Date.parse(enrollment.body.validUntil)))
    ) {
      return undefined;
    }
    return Object.freeze({ enrollment, certificate, executionKey, deviceKey, trustedNowMs: nowMs });
  } catch {
    return undefined;
  }
}

export function verifySignedExecutionEnrollment(
  candidate: unknown,
  context: TrustedExecutionIdentityContext,
): boolean {
  return Boolean(verifyEnrollmentChainCore(candidate, context, 'currently_actionable'));
}

const assignmentEnrollmentBindingKeys = [
  'platformAgentAccountId',
  'noMoneyCertificateId',
  'noMoneyCertificateBodyDigest',
  'deviceId',
  'deviceKeyId',
  'executionSignerKeyId',
  'platformCode',
  'pilotId',
  'pilotRevision',
  'pilotConfigDigest',
  'amountMinorUnits',
  'currencyCode',
] as const;

const assignmentAuthorityBindingKeys = [
  'assignmentId',
  'activationEpoch',
  'intentId',
  'jobId',
  'attemptId',
  'platformAgentAccountId',
  'enrollmentId',
  'enrollmentBodyDigest',
  'noMoneyCertificateId',
  'noMoneyCertificateBodyDigest',
  'deviceId',
  'deviceKeyId',
  'executionSignerKeyId',
  'platformCode',
  'pilotId',
  'pilotRevision',
  'pilotConfigDigest',
  'pilotReservationId',
  'pilotReservationDigest',
  'amountMinorUnits',
  'currencyCode',
  'playerIdDigest',
] as const;

function equalBindings(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => left[key] === right[key]);
}

interface VerifiedAssignmentChain extends VerifiedEnrollmentChain {
  readonly assignment: SignedExecutionAssignment;
}

function verifyAssignmentChainCore(
  candidate: unknown,
  signedEnrollment: unknown,
  context: TrustedExecutionIdentityContext,
  validityMode: ChainValidityMode,
): VerifiedAssignmentChain | undefined {
  const chain = verifyEnrollmentChainCore(signedEnrollment, context, validityMode);
  const assignment = decodeSignedExecutionAssignment(candidate);
  if (!chain || !assignment) return undefined;
  const enrollment = chain.enrollment;
  if (
    !serverEnvelopeSignatureIsValid(
      assignment,
      enrollment.body.executionSignerKeyId,
      chain.executionKey,
      digestExecutionAssignmentBody(assignment.body),
      canonicalExecutionAssignmentSignatureBytes(assignment.body),
    ) ||
    assignment.body.enrollmentId !== enrollment.body.enrollmentId ||
    assignment.body.enrollmentBodyDigest !== enrollment.bodyDigest ||
    !equalBindings(
      assignment.body as unknown as Record<string, unknown>,
      enrollment.body as unknown as Record<string, unknown>,
      assignmentEnrollmentBindingKeys,
    ) ||
    Date.parse(assignment.body.serverIssuedAt) < Date.parse(enrollment.body.validFrom) ||
    Date.parse(assignment.body.serverValidUntil) > Date.parse(enrollment.body.validUntil) ||
    Date.parse(assignment.body.serverIssuedAt) < Date.parse(chain.certificate.body.validFrom) ||
    Date.parse(assignment.body.serverValidUntil) > Date.parse(chain.certificate.body.validUntil) ||
    Date.parse(assignment.body.serverValidUntil) - Date.parse(assignment.body.serverNotBefore) >
      enrollment.body.maxAssignmentLifetimeMs
  ) {
    return undefined;
  }
  return Object.freeze({ ...chain, assignment });
}

export function verifySignedExecutionAssignment(
  candidate: unknown,
  context: ExecutionAssignmentVerificationContext,
): boolean {
  try {
    const chain = verifyAssignmentChainCore(
      candidate,
      context.signedExecutionEnrollment,
      context,
      'currently_actionable',
    );
    if (!chain) return false;
    const roundTrip = trustedRoundTrip(context.roundTrip, chain.enrollment.body.maxRoundTripTimeMs);
    const now = chain.trustedNowMs;
    const body = chain.assignment.body;
    const replay = deriveExecutionAssignmentReplayIdentity(chain.assignment);
    return Boolean(
      roundTrip !== undefined &&
      Date.parse(body.serverIssuedAt) <= now + COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS &&
      Date.parse(body.serverNotBefore) <= now &&
      now < Date.parse(body.serverValidUntil) &&
      replay &&
      replayIsFresh(replay, context.consumedReplayIdentities),
    );
  } catch {
    return false;
  }
}

interface VerifiedAuthorityChain extends VerifiedAssignmentChain {
  readonly authority: SignedOneUseActionAuthority;
}

function verifyAuthorityChainCore(
  candidate: unknown,
  signedAssignment: unknown,
  signedEnrollment: unknown,
  context: TrustedExecutionIdentityContext,
  validityMode: ChainValidityMode,
): VerifiedAuthorityChain | undefined {
  const chain = verifyAssignmentChainCore(
    signedAssignment,
    signedEnrollment,
    context,
    validityMode,
  );
  const authority = decodeSignedOneUseActionAuthority(candidate);
  if (!chain || !authority) return undefined;
  const assignment = chain.assignment;
  if (
    !serverEnvelopeSignatureIsValid(
      authority,
      chain.enrollment.body.executionSignerKeyId,
      chain.executionKey,
      digestOneUseActionAuthorityBody(authority.body),
      canonicalOneUseActionAuthoritySignatureBytes(authority.body),
    ) ||
    authority.body.assignmentBodyDigest !== assignment.bodyDigest ||
    !equalBindings(
      authority.body as unknown as Record<string, unknown>,
      assignment.body as unknown as Record<string, unknown>,
      assignmentAuthorityBindingKeys,
    ) ||
    Date.parse(authority.body.databaseFencedAt) < Date.parse(assignment.body.serverNotBefore) ||
    Date.parse(authority.body.serverValidUntil) > Date.parse(assignment.body.serverValidUntil) ||
    Date.parse(authority.body.databaseAuthorityIssuedAt) >=
      Date.parse(authority.body.databaseFencedAt) +
        COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS ||
    Date.parse(authority.body.serverValidUntil) >
      Date.parse(authority.body.databaseFencedAt) +
        COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS ||
    Date.parse(authority.body.serverValidUntil) -
      Date.parse(authority.body.databaseAuthorityIssuedAt) >
      chain.enrollment.body.maxAuthorityLifetimeMs
  ) {
    return undefined;
  }
  return Object.freeze({ ...chain, authority });
}

export function verifySignedOneUseActionAuthorityCryptographically(
  candidate: unknown,
  context: OneUseActionAuthorityVerificationContext,
): CryptographicallyVerifiedOneUseActionAuthority | undefined {
  try {
    const chain = verifyAuthorityChainCore(
      candidate,
      context.signedExecutionAssignment,
      context.signedExecutionEnrollment,
      context,
      'currently_actionable',
    );
    const expectedRequestNonceDigest = digest(context.expectedRequestNonceDigest);
    if (!chain || !expectedRequestNonceDigest) return undefined;
    const roundTrip = trustedRoundTrip(context.roundTrip, chain.enrollment.body.maxRoundTripTimeMs);
    const now = chain.trustedNowMs;
    const body = chain.authority.body;
    const issuedAt = Date.parse(body.databaseAuthorityIssuedAt);
    const fencedAt = Date.parse(body.databaseFencedAt);
    const signedServerDeadline = Math.min(
      Date.parse(body.serverValidUntil),
      Date.parse(chain.assignment.body.serverValidUntil),
      fencedAt + COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS,
    );
    const monotonicRequestStartedMs = boundedInteger(
      context.roundTrip.monotonicRequestStartedMs,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const monotonicResponseReceivedMs = boundedInteger(
      context.roundTrip.monotonicResponseReceivedMs,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const replay = deriveOneUseActionAuthorityReplayIdentity(chain.authority);
    const hardMonotonicDeadline =
      monotonicRequestStartedMs === undefined
        ? undefined
        : monotonicRequestStartedMs + COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS;
    const conservativeWallNow = now + COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS;
    const remainingSignedMilliseconds = signedServerDeadline - conservativeWallNow;
    const monotonicActionDeadlineMs =
      monotonicResponseReceivedMs === undefined ||
      hardMonotonicDeadline === undefined ||
      !Number.isSafeInteger(hardMonotonicDeadline)
        ? undefined
        : Math.min(
            hardMonotonicDeadline,
            monotonicResponseReceivedMs + remainingSignedMilliseconds,
          );
    if (
      roundTrip === undefined ||
      monotonicRequestStartedMs === undefined ||
      monotonicResponseReceivedMs === undefined ||
      monotonicActionDeadlineMs === undefined ||
      monotonicResponseReceivedMs >= hardMonotonicDeadline! ||
      monotonicResponseReceivedMs >= monotonicActionDeadlineMs ||
      body.requestNonceDigest !== expectedRequestNonceDigest ||
      issuedAt >= fencedAt + COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS ||
      issuedAt < now - roundTrip - COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS ||
      issuedAt > now + COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS ||
      conservativeWallNow >= signedServerDeadline ||
      !replay ||
      !replayIsFresh(replay, context.consumedReplayIdentities)
    ) {
      return undefined;
    }
    const verified = Object.freeze({
      verificationKind: 'cryptographically_verified_one_use_action_authority' as const,
      grantsActionAuthority: false as const,
      atomicReplayConsumptionRequired: true as const,
      authorityBodyDigest: chain.authority.bodyDigest,
      replayIdentity: replay,
      signedServerActionDeadline: new Date(signedServerDeadline).toISOString(),
      monotonicActionDeadlineMs,
      verifiedAtTrustedTime: new Date(now).toISOString(),
      responseReceivedMonotonicMs: monotonicResponseReceivedMs,
    });
    cryptographicallyVerifiedAuthorities.add(verified);
    return verified;
  } catch {
    return undefined;
  }
}

/**
 * Fail-closed compatibility shim. Cryptographic verification alone cannot establish one-use
 * action authority; use `verifySignedOneUseActionAuthorityCryptographically`, atomically consume
 * its replay identity outside this storage-free package, and perform the immediate deadline check.
 */
export function verifySignedOneUseActionAuthority(
  _candidate: unknown,
  _context: OneUseActionAuthorityVerificationContext,
): false {
  return false;
}

/**
 * Rechecks only the signed and monotonic deadlines after the caller reports an external atomic
 * replay transition. Returning true authenticates deadline freshness; it still does not itself
 * prove that the external receipt is durable or grant action authority.
 */
export function recheckOneUseActionAuthorityDeadlineAfterAtomicConsumption(
  verification: unknown,
  context: ImmediateActionDeadlineRecheckContext,
): boolean {
  try {
    if (
      !isPlainNonProxyRecord(verification) ||
      !cryptographicallyVerifiedAuthorities.has(verification) ||
      own(verification, 'verificationKind') !==
        'cryptographically_verified_one_use_action_authority' ||
      own(verification, 'grantsActionAuthority') !== false ||
      own(verification, 'atomicReplayConsumptionRequired') !== true ||
      !isPlainNonProxyRecord(context?.atomicConsumptionReceipt) ||
      !hasExactEnumerableDataKeys(context.atomicConsumptionReceipt, atomicConsumptionReceiptKeys) ||
      own(context.atomicConsumptionReceipt, 'receiptKind') !==
        'external_atomic_replay_consumption' ||
      own(context.atomicConsumptionReceipt, 'consumedExactlyOnce') !== true ||
      own(context.atomicConsumptionReceipt, 'replayIdentity') !==
        own(verification, 'replayIdentity') ||
      own(context.atomicConsumptionReceipt, 'authorityBodyDigest') !==
        own(verification, 'authorityBodyDigest')
    ) {
      return false;
    }
    const now = trustedNow(context.trustedNow);
    const monotonicNow = boundedInteger(context.monotonicNowMs, 0, Number.MAX_SAFE_INTEGER);
    const verifiedAt = trustedNow(own(verification, 'verifiedAtTrustedTime'));
    const signedDeadline = trustedNow(own(verification, 'signedServerActionDeadline'));
    const responseReceived = boundedInteger(
      own(verification, 'responseReceivedMonotonicMs'),
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const monotonicDeadline = boundedInteger(
      own(verification, 'monotonicActionDeadlineMs'),
      0,
      Number.MAX_SAFE_INTEGER,
    );
    return Boolean(
      now !== undefined &&
      monotonicNow !== undefined &&
      verifiedAt !== undefined &&
      signedDeadline !== undefined &&
      responseReceived !== undefined &&
      monotonicDeadline !== undefined &&
      now >= verifiedAt &&
      now + COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS < signedDeadline &&
      monotonicNow >= responseReceived &&
      monotonicNow < monotonicDeadline,
    );
  } catch {
    return false;
  }
}

function resultMatchesAuthority(
  result: ExecutionResultBody,
  authority: SignedOneUseActionAuthority,
): boolean {
  return (
    result.authorityId === authority.body.authorityId &&
    result.authorityBodyDigest === authority.bodyDigest &&
    result.fenceId === authority.body.fenceId &&
    result.fenceNonceDigest === authority.body.fenceNonceDigest &&
    result.requestNonceDigest === authority.body.requestNonceDigest
  );
}

interface VerifiedResultChain extends VerifiedAssignmentChain {
  readonly result: SignedExecutionResult;
  readonly authority: SignedOneUseActionAuthority | null;
}

function verifyResultChainCore(
  candidate: unknown,
  signedAuthority: unknown | null,
  signedAssignment: unknown,
  signedEnrollment: unknown,
  context: TrustedExecutionIdentityContext,
  validityMode: ChainValidityMode,
): VerifiedResultChain | undefined {
  const chain = verifyAssignmentChainCore(
    signedAssignment,
    signedEnrollment,
    context,
    validityMode,
  );
  const result = decodeSignedExecutionResult(candidate);
  if (!chain || !result) return undefined;
  const assignment = chain.assignment;
  if (
    result.body.assignmentBodyDigest !== assignment.bodyDigest ||
    !equalBindings(
      result.body as unknown as Record<string, unknown>,
      assignment.body as unknown as Record<string, unknown>,
      assignmentAuthorityBindingKeys,
    ) ||
    result.body.deviceKeyId !== result.deviceKeyId ||
    result.bodyDigest !== digestExecutionResultBody(result.body) ||
    !verifyP1363Signature(
      canonicalExecutionResultSignatureBytes(result.body),
      result.signature,
      chain.deviceKey.key,
    )
  ) {
    return undefined;
  }

  let authority: SignedOneUseActionAuthority | null = null;
  if (result.body.outcome === 'refused_before_fence') {
    if (signedAuthority !== null) return undefined;
  } else {
    const authorityChain = verifyAuthorityChainCore(
      signedAuthority,
      assignment,
      chain.enrollment,
      context,
      validityMode,
    );
    if (!authorityChain || !resultMatchesAuthority(result.body, authorityChain.authority)) {
      return undefined;
    }
    authority = authorityChain.authority;
  }
  const reportedAt = Date.parse(result.body.reportedAt);
  if (authority) {
    const finalActionStartedAt =
      result.body.finalActionStartedAt === null
        ? Number.NaN
        : Date.parse(result.body.finalActionStartedAt);
    const strictActionDeadline = Math.min(
      Date.parse(authority.body.serverValidUntil),
      Date.parse(assignment.body.serverValidUntil),
      Date.parse(authority.body.databaseFencedAt) +
        COMPANION_EXECUTION_DATABASE_FINAL_ACTION_WINDOW_MS,
    );
    if (
      !Number.isFinite(finalActionStartedAt) ||
      finalActionStartedAt < Date.parse(authority.body.databaseFencedAt) ||
      finalActionStartedAt < Date.parse(authority.body.databaseAuthorityIssuedAt) ||
      finalActionStartedAt >= strictActionDeadline ||
      reportedAt < finalActionStartedAt ||
      reportedAt - finalActionStartedAt > COMPANION_EXECUTION_MAX_RESULT_REPORTING_DELAY_MS
    ) {
      return undefined;
    }
  } else if (
    reportedAt <
      Date.parse(assignment.body.serverIssuedAt) - COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS ||
    reportedAt >
      Date.parse(assignment.body.serverValidUntil) +
        COMPANION_EXECUTION_MAX_RESULT_REPORTING_DELAY_MS
  ) {
    return undefined;
  }
  return Object.freeze({ ...chain, result, authority });
}

export function verifySignedExecutionResult(
  candidate: unknown,
  context: ExecutionResultVerificationContext,
): boolean {
  try {
    const chain = verifyResultChainCore(
      candidate,
      context.signedOneUseActionAuthority,
      context.signedExecutionAssignment,
      context.signedExecutionEnrollment,
      context,
      'historically_authenticated',
    );
    if (!chain) return false;
    const reportedAt = Date.parse(chain.result.body.reportedAt);
    const replay = deriveExecutionResultReplayIdentity(chain.result);
    return Boolean(
      reportedAt <= chain.trustedNowMs + COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS &&
      replay &&
      replayIsFresh(replay, context.consumedReplayIdentities),
    );
  } catch {
    return false;
  }
}

function statusMatchesAuthority(
  status: AuthoritativeExecutionStatusBody,
  authority: SignedOneUseActionAuthority,
): boolean {
  return (
    status.authorityId === authority.body.authorityId &&
    status.authorityBodyDigest === authority.bodyDigest &&
    status.fenceId === authority.body.fenceId
  );
}

/**
 * Verifies a fresh DB-derived status. A true return value authenticates information only. The
 * exact status schema carries two literal false authority flags and cannot be decoded by the
 * one-use-authority decoder.
 */
export function verifySignedAuthoritativeExecutionStatus(
  candidate: unknown,
  context: AuthoritativeExecutionStatusVerificationContext,
): boolean {
  try {
    const chain = verifyAssignmentChainCore(
      context.signedExecutionAssignment,
      context.signedExecutionEnrollment,
      context,
      'historically_authenticated',
    );
    const status = decodeSignedAuthoritativeExecutionStatus(candidate);
    const expectedQueryNonceDigest = digest(context.expectedQueryNonceDigest);
    const minimumStatusSequence = decimal(context.minimumStatusSequence);
    if (!chain || !status || !expectedQueryNonceDigest || !minimumStatusSequence) return false;
    if (
      !serverEnvelopeSignatureIsValid(
        status,
        chain.enrollment.body.executionSignerKeyId,
        chain.executionKey,
        digestAuthoritativeExecutionStatusBody(status.body),
        canonicalAuthoritativeExecutionStatusSignatureBytes(status.body),
      ) ||
      status.body.queryNonceDigest !== expectedQueryNonceDigest ||
      status.body.assignmentBodyDigest !== chain.assignment.bodyDigest ||
      !equalBindings(
        status.body as unknown as Record<string, unknown>,
        chain.assignment.body as unknown as Record<string, unknown>,
        assignmentAuthorityBindingKeys,
      ) ||
      BigInt(status.body.statusSequence) < BigInt(minimumStatusSequence)
    ) {
      return false;
    }

    let authority: SignedOneUseActionAuthority | null = null;
    if (status.body.authorityId === null) {
      if (context.signedOneUseActionAuthority !== null) return false;
    } else {
      const authorityChain = verifyAuthorityChainCore(
        context.signedOneUseActionAuthority,
        chain.assignment,
        chain.enrollment,
        context,
        'historically_authenticated',
      );
      if (!authorityChain || !statusMatchesAuthority(status.body, authorityChain.authority)) {
        return false;
      }
      authority = authorityChain.authority;
    }

    let historicalResult: SignedExecutionResult | null = null;
    if (status.body.executionResultBodyDigest === null) {
      if (context.signedExecutionResult !== null) return false;
    } else {
      const resultChain = verifyResultChainCore(
        context.signedExecutionResult,
        authority,
        chain.assignment,
        chain.enrollment,
        context,
        'historically_authenticated',
      );
      if (
        !resultChain ||
        status.body.executionResultBodyDigest !== resultChain.result.bodyDigest ||
        status.body.providerResponseDigest !== resultChain.result.body.providerResponseDigest ||
        status.body.evidenceDigest !== resultChain.result.body.evidenceDigest ||
        (status.body.databaseAttemptState === 'submission_attempted' &&
          resultChain.result.body.outcome !== 'submission_attempted') ||
        (status.body.databaseAttemptState === 'local_uncertain' &&
          resultChain.result.body.outcome !== 'local_uncertain')
      ) {
        return false;
      }
      historicalResult = resultChain.result;
    }

    const roundTrip = trustedRoundTrip(context.roundTrip, chain.enrollment.body.maxRoundTripTimeMs);
    const issuedAt = Date.parse(status.body.serverIssuedAt);
    const observedAt = Date.parse(status.body.databaseObservedAt);
    const replay = deriveAuthoritativeExecutionStatusReplayIdentity(status);
    return Boolean(
      roundTrip !== undefined &&
      observedAt >= Date.parse(chain.assignment.body.serverIssuedAt) &&
      (!authority || observedAt >= Date.parse(authority.body.databaseFencedAt)) &&
      (!authority || observedAt >= Date.parse(authority.body.databaseAuthorityIssuedAt)) &&
      (!historicalResult || observedAt >= Date.parse(historicalResult.body.reportedAt)) &&
      observedAt >= issuedAt - roundTrip - COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS &&
      issuedAt >= chain.trustedNowMs - roundTrip - COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS &&
      issuedAt <= chain.trustedNowMs + COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS &&
      chain.trustedNowMs + COMPANION_EXECUTION_MAX_FORWARD_CLOCK_SKEW_MS <
        Date.parse(status.body.serverValidUntil) &&
      replay &&
      replayIsFresh(replay, context.consumedReplayIdentities),
    );
  } catch {
    return false;
  }
}
