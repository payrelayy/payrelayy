import { createHash, createPublicKey } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  TELEBIRR_LIVE_PILOT_OUTCOME_ADAPTER_CONTRACT_VERSION,
  adaptTelebirrLivePilotOutcome,
  deriveTelebirrLivePilotDatabaseSnapshotDigest,
} from '@fetanagent/telebirr-live-pilot-outcome-adapter';
import {
  TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
  TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
  decodeTelebirrLivePilotSignedAssignment,
  decodeTelebirrLivePilotSignedObservation,
  deriveTelebirrLivePilotReplayIdentity,
  verifyTelebirrLivePrivatePilotEvidence,
  type TelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedObservation,
  type TelebirrLivePilotVerificationReason,
} from '@fetanagent/telebirr-verification-foundation';

export const TRUSTED_TELEBIRR_VERIFIER_CONTRACT_VERSION = 1 as const;
export const TRUSTED_TELEBIRR_VERIFIER_VERSION = 'trusted-telebirr-verifier-v1' as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const REQUEST_KEYS = [
  'contractVersion',
  'verificationAttemptId',
  'leaseToken',
  'completionRequestKey',
  'signedAssignment',
  'signedObservation',
] as const;
const AUTHORITY_KEYS = [
  'contractVersion',
  'capturedAt',
  'authorityStateDigest',
  'verificationAttemptId',
  'leaseTokenAccepted',
  'attempt',
  'trustedAssignmentSigner',
  'deviceEnrollment',
  'trustedRequestBinding',
  'assignmentTranscript',
  'replayIdentities',
  'existingCompletion',
  'trustedRequest',
  'trustedPilot',
  'trustedPlayer',
  'trustedProvider',
  'trustedReference',
  'trustedReceiver',
  'trustedPolicy',
  'databaseAuthority',
  'databaseFacts',
] as const;
const ATTEMPT_KEYS = [
  'assignmentId',
  'requestId',
  'jobId',
  'attemptNumber',
  'leaseNonceDigest',
  'challengeId',
  'challengeDigest',
  'issuedAt',
  'expiresAt',
] as const;
const TRANSCRIPT_KEYS = [
  'assignmentBodyDigest',
  'assignmentSignatureDigest',
  'referenceBindingDigest',
  'signedAt',
] as const;
const COMPLETION_ROW_KEYS = [
  'verification_outcome_id',
  'outcome_disposition',
  'outcome_reason_code',
  'deposit_intent_id',
  'deposit_payment_claim_id',
  'execution_job_id',
  'settlement_created',
  'already_completed',
] as const;
const EXISTING_COMPLETION_KEYS = [
  'completionRequestKey',
  'observationBodyDigest',
  'observationSignatureDigest',
  'replayIdentity',
  'sourceDocumentDigest',
  'normalizedFactsDigest',
  'observedAt',
  'protocolDisposition',
  'protocolReasonCode',
  'assessmentInputDigest',
  'assessedAt',
  'disposition',
  'reasonCode',
  'evidenceDigest',
  'retrievedAt',
  'receiptPrincipalAmountMinor',
  'occurredAt',
  'receiverIdentityDigest',
] as const;

type DataRecord = Readonly<Record<string, unknown>>;

export interface TrustedTelebirrPinnedPublicKey {
  readonly keyId: string;
  readonly publicKeySpkiDer: Uint8Array;
}

export interface TrustedTelebirrPinnedKeys {
  readonly assignmentSigners: readonly TrustedTelebirrPinnedPublicKey[];
  readonly devices: readonly TrustedTelebirrPinnedPublicKey[];
}

export interface TrustedTelebirrVerificationRequest {
  readonly contractVersion: typeof TRUSTED_TELEBIRR_VERIFIER_CONTRACT_VERSION;
  readonly verificationAttemptId: string;
  readonly leaseToken: string;
  readonly completionRequestKey: string;
  readonly signedAssignment: TelebirrLivePilotSignedAssignment;
  readonly signedObservation: TelebirrLivePilotSignedObservation;
}

export interface TrustedTelebirrCompletionInput {
  readonly verificationAttemptId: string;
  readonly leaseToken: string;
  readonly completionRequestKey: string;
  readonly observationBodyDigest: string;
  readonly observationSignatureDigest: string;
  readonly replayIdentity: string;
  readonly sourceDocumentDigest: string;
  readonly normalizedFactsDigest: string;
  readonly observedAt: string;
  readonly protocolDisposition: 'would_forward_signed_evidence' | 'would_review';
  readonly protocolReasonCode:
    | 'provider_status_not_completed'
    | 'receipt_requires_review'
    | 'receipt_semantics_incomplete'
    | 'receiver_mismatch'
    | 'reference_mismatch'
    | 'signed_evidence_verified';
  readonly assessmentInputDigest: string;
  readonly assessedAt: string;
  readonly disposition: 'definite_reject' | 'review_required' | 'settlement_candidate';
  readonly reasonCode: string;
  readonly evidenceDigest: string;
  readonly retrievedAt: string;
  readonly receiptPrincipalAmountMinor: string | null;
  readonly occurredAt: string | null;
  readonly receiverIdentityDigest: string | null;
}

export interface TrustedTelebirrVerifierDatabase {
  loadAuthority(
    verificationAttemptId: string,
    leaseToken: string,
    occurredAt: string | null,
  ): Promise<unknown>;
  complete(input: TrustedTelebirrCompletionInput): Promise<unknown>;
}

export type TrustedTelebirrVerificationResult =
  | {
      readonly status: 'not_settled';
      readonly disposition: 'definite_reject' | 'invalid' | 'review_required';
      readonly reasonCode: string;
    }
  | {
      readonly status: 'completed_without_settlement';
      readonly verificationOutcomeId: string;
      readonly disposition: 'definite_reject' | 'review_required';
      readonly reasonCode: string;
      readonly alreadyCompleted: boolean;
    }
  | {
      readonly status: 'settled';
      readonly verificationOutcomeId: string;
      readonly depositIntentId: string;
      readonly depositPaymentClaimId: string;
      readonly executionJobId: string;
      readonly alreadyCompleted: boolean;
    };

export interface RedactedTrustedTelebirrVerificationLogProjection {
  readonly verifierVersion: typeof TRUSTED_TELEBIRR_VERIFIER_VERSION;
  readonly status: TrustedTelebirrVerificationResult['status'];
  readonly disposition: string;
  readonly reasonCode: string;
  readonly alreadyCompleted: boolean;
}

export interface TrustedTelebirrVerifier {
  verifyAndComplete(
    request: TrustedTelebirrVerificationRequest,
  ): Promise<TrustedTelebirrVerificationResult>;
}

export class TrustedTelebirrVerifierUnavailableError extends Error {
  constructor() {
    super('The trusted TeleBirr verifier is unavailable.');
    this.name = 'TrustedTelebirrVerifierUnavailableError';
  }
}

function exactDataRecord(value: unknown, keys: readonly string[]): DataRecord | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return undefined;
    }
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        return undefined;
      }
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return undefined;
  }
}

function dataRecord(value: unknown): DataRecord | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== 'string' ||
          descriptors[key]?.enumerable !== true ||
          !Object.hasOwn(descriptors[key] ?? {}, 'value'),
      )
    ) {
      return undefined;
    }
    return value as DataRecord;
  } catch {
    return undefined;
  }
}

function canonicalTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function decodedSignatureDigest(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86}$/u.test(value)) return undefined;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength === 64 ? sha256(decoded) : undefined;
  } catch {
    return undefined;
  }
}

function canonicalP256Spki(value: Uint8Array): Uint8Array | undefined {
  try {
    const input = Buffer.from(value);
    const publicKey = createPublicKey({ key: input, format: 'der', type: 'spki' });
    const canonical = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }));
    return publicKey.type === 'public' &&
      publicKey.asymmetricKeyType === 'ec' &&
      publicKey.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
      canonical.byteLength === 91 &&
      canonical.equals(input)
      ? Uint8Array.from(canonical)
      : undefined;
  } catch {
    return undefined;
  }
}

function pinnedKeyMap(
  candidates: readonly TrustedTelebirrPinnedPublicKey[],
): ReadonlyMap<string, Readonly<{ fingerprint: string; spki: Uint8Array }>> {
  const result = new Map<string, Readonly<{ fingerprint: string; spki: Uint8Array }>>();
  const fingerprints = new Set<string>();
  for (const candidate of candidates) {
    const record = exactDataRecord(candidate, ['keyId', 'publicKeySpkiDer']);
    if (
      !record ||
      typeof record.keyId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(record.keyId) ||
      !(record.publicKeySpkiDer instanceof Uint8Array) ||
      isProxy(record.publicKeySpkiDer) ||
      result.has(record.keyId)
    ) {
      throw new TrustedTelebirrVerifierUnavailableError();
    }
    const spki = canonicalP256Spki(record.publicKeySpkiDer);
    if (!spki) throw new TrustedTelebirrVerifierUnavailableError();
    const fingerprint = sha256(spki);
    if (fingerprints.has(fingerprint)) throw new TrustedTelebirrVerifierUnavailableError();
    fingerprints.add(fingerprint);
    result.set(record.keyId, Object.freeze({ fingerprint, spki }));
  }
  if (result.size === 0) throw new TrustedTelebirrVerifierUnavailableError();
  return result;
}

function requestFrom(value: unknown):
  | Readonly<{
      verificationAttemptId: string;
      leaseToken: string;
      completionRequestKey: string;
      signedAssignment: TelebirrLivePilotSignedAssignment;
      signedObservation: TelebirrLivePilotSignedObservation;
    }>
  | undefined {
  const record = exactDataRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.contractVersion !== TRUSTED_TELEBIRR_VERIFIER_CONTRACT_VERSION ||
    typeof record.verificationAttemptId !== 'string' ||
    !UUID_PATTERN.test(record.verificationAttemptId) ||
    typeof record.leaseToken !== 'string' ||
    !UUID_PATTERN.test(record.leaseToken) ||
    typeof record.completionRequestKey !== 'string' ||
    !UUID_V4_PATTERN.test(record.completionRequestKey)
  ) {
    return undefined;
  }
  const signedAssignment = decodeTelebirrLivePilotSignedAssignment(record.signedAssignment);
  const signedObservation = decodeTelebirrLivePilotSignedObservation(record.signedObservation);
  return signedAssignment && signedObservation
    ? Object.freeze({
        verificationAttemptId: record.verificationAttemptId,
        leaseToken: record.leaseToken,
        completionRequestKey: record.completionRequestKey,
        signedAssignment,
        signedObservation,
      })
    : undefined;
}

function timestampFields(
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  const record = dataRecord(value);
  if (!record) return undefined;
  const copy: Record<string, unknown> = { ...record };
  for (const field of fields) {
    const timestamp = canonicalTimestamp(record[field]);
    if (!timestamp) return undefined;
    copy[field] = timestamp;
  }
  return Object.freeze(copy);
}

function databaseFactsFrom(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const facts = dataRecord(value);
  const receiver = dataRecord(facts?.receiverAtOccurredAt);
  const policy = dataRecord(facts?.currentPolicy);
  const eligibility = dataRecord(facts?.currentEligibility);
  const duplicate = dataRecord(facts?.duplicateState);
  if (!facts || !receiver || !policy || !eligibility || !duplicate) return undefined;
  const resolvedForOccurredAt =
    receiver.resolvedForOccurredAt === null
      ? null
      : canonicalTimestamp(receiver.resolvedForOccurredAt);
  const effectiveFrom =
    receiver.effectiveFrom === null ? null : canonicalTimestamp(receiver.effectiveFrom);
  const effectiveUntil =
    receiver.effectiveUntil === null ? null : canonicalTimestamp(receiver.effectiveUntil);
  const policyCheckedAt = canonicalTimestamp(policy.checkedAt);
  const eligibilityCheckedAt = canonicalTimestamp(eligibility.checkedAt);
  const duplicateCheckedAt = canonicalTimestamp(duplicate.checkedAt);
  if (
    resolvedForOccurredAt === undefined ||
    effectiveFrom === undefined ||
    effectiveUntil === undefined ||
    !policyCheckedAt ||
    !eligibilityCheckedAt ||
    !duplicateCheckedAt
  ) {
    return undefined;
  }
  return Object.freeze({
    receiverAtOccurredAt: Object.freeze({
      ...receiver,
      resolvedForOccurredAt,
      effectiveFrom,
      effectiveUntil,
    }),
    currentPolicy: Object.freeze({ ...policy, checkedAt: policyCheckedAt }),
    currentEligibility: Object.freeze({ ...eligibility, checkedAt: eligibilityCheckedAt }),
    duplicateState: Object.freeze({ ...duplicate, checkedAt: duplicateCheckedAt }),
  });
}

interface ParsedAuthority {
  readonly capturedAt: string;
  readonly authorityStateDigest: string;
  readonly attempt: DataRecord;
  readonly assignmentTranscript: DataRecord;
  readonly signer: DataRecord;
  readonly signerSpkiFingerprint: string;
  readonly device: DataRecord;
  readonly deviceSpkiFingerprint: string;
  readonly trustedRequestBinding: DataRecord;
  readonly replayIdentities: readonly string[];
  readonly existingCompletion: TrustedTelebirrCompletionInput | null;
  readonly outcomeInputBase: Readonly<Record<string, unknown>>;
}

function existingCompletionFrom(
  value: unknown,
  verificationAttemptId: string,
  leaseToken: string,
): TrustedTelebirrCompletionInput | null | undefined {
  if (value === null) return null;
  const record = exactDataRecord(value, EXISTING_COMPLETION_KEYS);
  const observedAt = canonicalTimestamp(record?.observedAt);
  const assessedAt = canonicalTimestamp(record?.assessedAt);
  const retrievedAt = canonicalTimestamp(record?.retrievedAt);
  const occurredAt = record?.occurredAt === null ? null : canonicalTimestamp(record?.occurredAt);
  if (
    !record ||
    typeof record.completionRequestKey !== 'string' ||
    !UUID_V4_PATTERN.test(record.completionRequestKey) ||
    typeof record.observationBodyDigest !== 'string' ||
    !SHA256_PATTERN.test(record.observationBodyDigest) ||
    typeof record.observationSignatureDigest !== 'string' ||
    !SHA256_PATTERN.test(record.observationSignatureDigest) ||
    typeof record.replayIdentity !== 'string' ||
    !SHA256_PATTERN.test(record.replayIdentity) ||
    typeof record.sourceDocumentDigest !== 'string' ||
    !SHA256_PATTERN.test(record.sourceDocumentDigest) ||
    typeof record.normalizedFactsDigest !== 'string' ||
    !SHA256_PATTERN.test(record.normalizedFactsDigest) ||
    !observedAt ||
    (record.protocolDisposition !== 'would_review' &&
      record.protocolDisposition !== 'would_forward_signed_evidence') ||
    typeof record.protocolReasonCode !== 'string' ||
    !isAuthenticatedEvidenceReason(
      record.protocolReasonCode as TelebirrLivePilotVerificationReason,
    ) ||
    typeof record.assessmentInputDigest !== 'string' ||
    !SHA256_PATTERN.test(record.assessmentInputDigest) ||
    !assessedAt ||
    (record.disposition !== 'settlement_candidate' &&
      record.disposition !== 'definite_reject' &&
      record.disposition !== 'review_required') ||
    typeof record.reasonCode !== 'string' ||
    !/^[a-z][a-z0-9_]{2,127}$/u.test(record.reasonCode) ||
    typeof record.evidenceDigest !== 'string' ||
    !SHA256_PATTERN.test(record.evidenceDigest) ||
    !retrievedAt ||
    (record.receiptPrincipalAmountMinor !== null &&
      (typeof record.receiptPrincipalAmountMinor !== 'string' ||
        !/^[1-9][0-9]{0,18}$/u.test(record.receiptPrincipalAmountMinor))) ||
    occurredAt === undefined ||
    (record.receiverIdentityDigest !== null &&
      (typeof record.receiverIdentityDigest !== 'string' ||
        !SHA256_PATTERN.test(record.receiverIdentityDigest))) ||
    (record.disposition === 'settlement_candidate'
      ? record.reasonCode !== 'exact_proof_match' ||
        record.receiptPrincipalAmountMinor === null ||
        occurredAt === null ||
        record.receiverIdentityDigest === null
      : record.receiptPrincipalAmountMinor !== null ||
        occurredAt !== null ||
        record.receiverIdentityDigest !== null)
  ) {
    return undefined;
  }
  return Object.freeze({
    verificationAttemptId,
    leaseToken,
    completionRequestKey: record.completionRequestKey,
    observationBodyDigest: record.observationBodyDigest,
    observationSignatureDigest: record.observationSignatureDigest,
    replayIdentity: record.replayIdentity,
    sourceDocumentDigest: record.sourceDocumentDigest,
    normalizedFactsDigest: record.normalizedFactsDigest,
    observedAt,
    protocolDisposition: record.protocolDisposition,
    protocolReasonCode: record.protocolReasonCode as AuthenticatedEvidenceReason,
    assessmentInputDigest: record.assessmentInputDigest,
    assessedAt,
    disposition: record.disposition,
    reasonCode: record.reasonCode,
    evidenceDigest: record.evidenceDigest,
    retrievedAt,
    receiptPrincipalAmountMinor: record.receiptPrincipalAmountMinor,
    occurredAt,
    receiverIdentityDigest: record.receiverIdentityDigest,
  });
}

function authorityFrom(
  value: unknown,
  expectedAttemptId: string,
  expectedLeaseToken: string,
): ParsedAuthority | undefined {
  const record = exactDataRecord(value, AUTHORITY_KEYS);
  const capturedAt = canonicalTimestamp(record?.capturedAt);
  const attempt = exactDataRecord(record?.attempt, ATTEMPT_KEYS);
  const transcript = exactDataRecord(record?.assignmentTranscript, TRANSCRIPT_KEYS);
  const signer = timestampFields(record?.trustedAssignmentSigner, ['validFrom', 'validUntil']);
  const device = timestampFields(record?.deviceEnrollment, ['validFrom', 'validUntil']);
  const pilot = timestampFields(record?.trustedPilot, ['validFrom', 'validUntil']);
  const trustedRequest = timestampFields(record?.trustedRequest, ['submittedAt']);
  const databaseFacts = databaseFactsFrom(record?.databaseFacts);
  const databaseAuthority = dataRecord(record?.databaseAuthority);
  const trustedRequestBinding = dataRecord(record?.trustedRequestBinding);
  const existingCompletion = existingCompletionFrom(
    record?.existingCompletion,
    expectedAttemptId,
    expectedLeaseToken,
  );
  if (
    !record ||
    record.contractVersion !== TRUSTED_TELEBIRR_VERIFIER_CONTRACT_VERSION ||
    record.verificationAttemptId !== expectedAttemptId ||
    record.leaseTokenAccepted !== true ||
    !capturedAt ||
    typeof record.authorityStateDigest !== 'string' ||
    !SHA256_PATTERN.test(record.authorityStateDigest) ||
    !attempt ||
    !transcript ||
    !signer ||
    !device ||
    !pilot ||
    !trustedRequest ||
    !databaseFacts ||
    !databaseAuthority ||
    !trustedRequestBinding ||
    existingCompletion === undefined ||
    typeof signer.signerKeyId !== 'string' ||
    typeof signer.publicKeySpkiSha256 !== 'string' ||
    !SHA256_PATTERN.test(signer.publicKeySpkiSha256) ||
    typeof device.keyId !== 'string' ||
    typeof device.publicKeySpkiSha256 !== 'string' ||
    !SHA256_PATTERN.test(device.publicKeySpkiSha256) ||
    !Array.isArray(record.replayIdentities) ||
    record.replayIdentities.some(
      (identity) => typeof identity !== 'string' || !SHA256_PATTERN.test(identity),
    )
  ) {
    return undefined;
  }
  const issuedAt = canonicalTimestamp(attempt.issuedAt);
  const expiresAt = canonicalTimestamp(attempt.expiresAt);
  const signedAt = canonicalTimestamp(transcript.signedAt);
  if (!issuedAt || !expiresAt || !signedAt) return undefined;
  return Object.freeze({
    capturedAt,
    authorityStateDigest: record.authorityStateDigest,
    attempt: Object.freeze({ ...attempt, issuedAt, expiresAt }),
    assignmentTranscript: Object.freeze({ ...transcript, signedAt }),
    signer,
    signerSpkiFingerprint: signer.publicKeySpkiSha256,
    device,
    deviceSpkiFingerprint: device.publicKeySpkiSha256,
    trustedRequestBinding,
    replayIdentities: Object.freeze([...record.replayIdentities]) as readonly string[],
    existingCompletion,
    outcomeInputBase: Object.freeze({
      contractVersion: TELEBIRR_LIVE_PILOT_OUTCOME_ADAPTER_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
      assessedAt: capturedAt,
      trustedRequest,
      trustedPilot: pilot,
      trustedPlayer: record.trustedPlayer,
      trustedProvider: record.trustedProvider,
      trustedReference: record.trustedReference,
      trustedReceiver: record.trustedReceiver,
      trustedPolicy: record.trustedPolicy,
      databaseAuthority,
      databaseFacts,
    }),
  });
}

function exactTranscriptMatch(
  authority: ParsedAuthority,
  signedAssignment: TelebirrLivePilotSignedAssignment,
): boolean {
  return (
    authority.assignmentTranscript.assignmentBodyDigest === signedAssignment.bodyDigest &&
    authority.assignmentTranscript.referenceBindingDigest ===
      signedAssignment.body.referenceBindingDigest &&
    authority.assignmentTranscript.assignmentSignatureDigest ===
      decodedSignatureDigest(signedAssignment.signature) &&
    authority.attempt.assignmentId === signedAssignment.body.assignmentId &&
    authority.attempt.requestId === signedAssignment.body.requestId &&
    authority.attempt.jobId === signedAssignment.body.jobId &&
    authority.attempt.attemptNumber === signedAssignment.body.attemptNumber &&
    authority.attempt.leaseNonceDigest === signedAssignment.body.leaseNonceDigest &&
    authority.attempt.challengeId === signedAssignment.body.challengeId &&
    authority.attempt.challengeDigest === signedAssignment.body.challengeDigest &&
    authority.attempt.issuedAt === signedAssignment.body.issuedAt &&
    authority.attempt.expiresAt === signedAssignment.body.expiresAt
  );
}

function verificationInput(
  authority: ParsedAuthority,
  signedAssignment: TelebirrLivePilotSignedAssignment,
  signedObservation: TelebirrLivePilotSignedObservation,
) {
  return {
    contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
    providerCode: 'telebirr' as const,
    protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
    assessedAt: authority.capturedAt,
    trustedAssignmentSigner: authority.signer,
    trustedRequestBinding: authority.trustedRequestBinding,
    deviceEnrollment: authority.device,
    signedAssignment,
    signedObservation,
    serverComputedReplayIdentities: authority.replayIdentities,
  };
}

type AuthenticatedEvidenceReason = TrustedTelebirrCompletionInput['protocolReasonCode'];

const AUTHENTICATED_EVIDENCE_REASONS = new Set<TelebirrLivePilotVerificationReason>([
  'receipt_requires_review',
  'reference_mismatch',
  'receiver_mismatch',
  'provider_status_not_completed',
  'receipt_semantics_incomplete',
  'signed_evidence_verified',
]);

function isAuthenticatedEvidenceReason(
  reason: TelebirrLivePilotVerificationReason,
): reason is AuthenticatedEvidenceReason {
  return AUTHENTICATED_EVIDENCE_REASONS.has(reason);
}

function authenticatedOutcome(
  authority: ParsedAuthority,
  signedAssignment: TelebirrLivePilotSignedAssignment,
  signedObservation: TelebirrLivePilotSignedObservation,
  signerSpki: Uint8Array,
  deviceSpki: Uint8Array,
) {
  const protocolInput = verificationInput(authority, signedAssignment, signedObservation);
  const protocol = verifyTelebirrLivePrivatePilotEvidence(protocolInput, signerSpki, deviceSpki);
  if (
    protocol.replayIdentity === null ||
    !isAuthenticatedEvidenceReason(protocol.reasonCode) ||
    (protocol.reasonCode === 'signed_evidence_verified'
      ? protocol.disposition !== 'would_forward_signed_evidence'
      : protocol.disposition !== 'would_review')
  ) {
    return undefined;
  }
  const databaseSnapshotMaterial = {
    snapshotId: authority.outcomeInputBase.trustedRequest
      ? (authority.outcomeInputBase.trustedRequest as DataRecord).databaseSnapshotId
      : undefined,
    capturedAt: authority.capturedAt,
    authority: authority.outcomeInputBase.databaseAuthority,
    facts: authority.outcomeInputBase.databaseFacts,
  };
  const snapshotDigest = deriveTelebirrLivePilotDatabaseSnapshotDigest(databaseSnapshotMaterial);
  if (!snapshotDigest) return undefined;
  const outcome = adaptTelebirrLivePilotOutcome(
    {
      contractVersion: TELEBIRR_LIVE_PILOT_OUTCOME_ADAPTER_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
      assessedAt: authority.capturedAt,
      trustedRequest: authority.outcomeInputBase.trustedRequest,
      trustedPilot: authority.outcomeInputBase.trustedPilot,
      trustedPlayer: authority.outcomeInputBase.trustedPlayer,
      trustedProvider: authority.outcomeInputBase.trustedProvider,
      trustedReference: authority.outcomeInputBase.trustedReference,
      trustedReceiver: authority.outcomeInputBase.trustedReceiver,
      trustedPolicy: authority.outcomeInputBase.trustedPolicy,
      trustedDatabaseSnapshot: {
        ...databaseSnapshotMaterial,
        snapshotDigest,
      },
      verificationInput: protocolInput,
    },
    signerSpki,
    deviceSpki,
  );
  if (
    !outcome ||
    outcome.reasonCode === 'database_facts_unbound' ||
    outcome.reasonCode === 'invalid_assessment_input'
  ) {
    return undefined;
  }
  return Object.freeze({
    outcome,
    protocol: Object.freeze({
      disposition: protocol.disposition as TrustedTelebirrCompletionInput['protocolDisposition'],
      reasonCode: protocol.reasonCode,
      replayIdentity: protocol.replayIdentity,
    }),
  });
}

function nonSettlementResult(
  outcome: ReturnType<typeof adaptTelebirrLivePilotOutcome>,
): Extract<TrustedTelebirrVerificationResult, { readonly status: 'not_settled' }> {
  if (!outcome) {
    return Object.freeze({
      status: 'not_settled' as const,
      disposition: 'invalid' as const,
      reasonCode: 'trusted_evidence_invalid',
    });
  }
  if (outcome.disposition === 'settlement_candidate') {
    return Object.freeze({
      status: 'not_settled' as const,
      disposition: 'invalid' as const,
      reasonCode: 'trusted_evidence_invalid',
    });
  }
  return Object.freeze({
    status: 'not_settled' as const,
    disposition: outcome.disposition,
    reasonCode: outcome.reasonCode,
  });
}

function completionResult(
  value: unknown,
  expectedDisposition: TrustedTelebirrCompletionInput['disposition'],
  expectedReasonCode: string,
): TrustedTelebirrVerificationResult | undefined {
  const row = exactDataRecord(value, COMPLETION_ROW_KEYS);
  if (
    !row ||
    row.outcome_disposition !== expectedDisposition ||
    row.outcome_reason_code !== expectedReasonCode ||
    typeof row.already_completed !== 'boolean' ||
    typeof row.verification_outcome_id !== 'string' ||
    !UUID_PATTERN.test(row.verification_outcome_id)
  ) {
    return undefined;
  }
  if (expectedDisposition !== 'settlement_candidate') {
    if (
      row.settlement_created !== false ||
      row.deposit_intent_id !== null ||
      row.deposit_payment_claim_id !== null ||
      row.execution_job_id !== null
    ) {
      return undefined;
    }
    return Object.freeze({
      status: 'completed_without_settlement' as const,
      verificationOutcomeId: row.verification_outcome_id,
      disposition: expectedDisposition,
      reasonCode: expectedReasonCode,
      alreadyCompleted: row.already_completed,
    });
  }
  if (
    expectedReasonCode !== 'exact_proof_match' ||
    row.settlement_created !== true ||
    typeof row.deposit_intent_id !== 'string' ||
    !UUID_PATTERN.test(row.deposit_intent_id) ||
    typeof row.deposit_payment_claim_id !== 'string' ||
    !UUID_PATTERN.test(row.deposit_payment_claim_id) ||
    typeof row.execution_job_id !== 'string' ||
    !UUID_PATTERN.test(row.execution_job_id)
  ) {
    return undefined;
  }
  return Object.freeze({
    status: 'settled' as const,
    verificationOutcomeId: row.verification_outcome_id,
    depositIntentId: row.deposit_intent_id,
    depositPaymentClaimId: row.deposit_payment_claim_id,
    executionJobId: row.execution_job_id,
    alreadyCompleted: row.already_completed,
  });
}

export function createTrustedTelebirrVerifier(
  database: TrustedTelebirrVerifierDatabase,
  pinnedKeys: TrustedTelebirrPinnedKeys,
): TrustedTelebirrVerifier {
  const pinRecord = exactDataRecord(pinnedKeys, ['assignmentSigners', 'devices']);
  if (
    !pinRecord ||
    !Array.isArray(pinRecord.assignmentSigners) ||
    !Array.isArray(pinRecord.devices)
  ) {
    throw new TrustedTelebirrVerifierUnavailableError();
  }
  const signerPins = pinnedKeyMap(pinRecord.assignmentSigners);
  const devicePins = pinnedKeyMap(pinRecord.devices);
  const signerFingerprints = new Set([...signerPins.values()].map((pin) => pin.fingerprint));
  if (
    [...devicePins.keys()].some((keyId) => signerPins.has(keyId)) ||
    [...devicePins.values()].some((pin) => signerFingerprints.has(pin.fingerprint))
  ) {
    throw new TrustedTelebirrVerifierUnavailableError();
  }

  return Object.freeze({
    async verifyAndComplete(requestCandidate: TrustedTelebirrVerificationRequest) {
      try {
        const request = requestFrom(requestCandidate);
        if (!request) throw new Error();
        const observation = request.signedObservation.body;
        const occurredAt =
          observation.facts.lookupOutcome === 'found' ? observation.facts.occurredAt : null;

        const firstAuthority = authorityFrom(
          await database.loadAuthority(
            request.verificationAttemptId,
            request.leaseToken,
            occurredAt,
          ),
          request.verificationAttemptId,
          request.leaseToken,
        );
        if (!firstAuthority || !exactTranscriptMatch(firstAuthority, request.signedAssignment)) {
          throw new Error();
        }
        const signerPin = signerPins.get(String(firstAuthority.signer.signerKeyId));
        const devicePin = devicePins.get(String(firstAuthority.device.keyId));
        if (
          !signerPin ||
          signerPin.fingerprint !== firstAuthority.signerSpkiFingerprint ||
          !devicePin ||
          devicePin.fingerprint !== firstAuthority.deviceSpkiFingerprint
        ) {
          return nonSettlementResult(undefined);
        }

        const firstVerification = authenticatedOutcome(
          firstAuthority,
          request.signedAssignment,
          request.signedObservation,
          signerPin.spki,
          devicePin.spki,
        );
        if (!firstVerification) return nonSettlementResult(undefined);

        const secondAuthority = authorityFrom(
          await database.loadAuthority(
            request.verificationAttemptId,
            request.leaseToken,
            occurredAt,
          ),
          request.verificationAttemptId,
          request.leaseToken,
        );
        if (
          !secondAuthority ||
          secondAuthority.authorityStateDigest !== firstAuthority.authorityStateDigest ||
          !exactTranscriptMatch(secondAuthority, request.signedAssignment)
        ) {
          return nonSettlementResult(undefined);
        }
        const secondSignerPin = signerPins.get(String(secondAuthority.signer.signerKeyId));
        const secondDevicePin = devicePins.get(String(secondAuthority.device.keyId));
        if (
          !secondSignerPin ||
          secondSignerPin.fingerprint !== secondAuthority.signerSpkiFingerprint ||
          !secondDevicePin ||
          secondDevicePin.fingerprint !== secondAuthority.deviceSpkiFingerprint
        ) {
          return nonSettlementResult(undefined);
        }
        const secondVerification = authenticatedOutcome(
          secondAuthority,
          request.signedAssignment,
          request.signedObservation,
          secondSignerPin.spki,
          secondDevicePin.spki,
        );
        if (!secondVerification) return nonSettlementResult(undefined);
        const { outcome: secondOutcome, protocol: secondProtocol } = secondVerification;

        const trustedReference = dataRecord(secondAuthority.outcomeInputBase.trustedReference);
        if (
          !trustedReference ||
          (secondOutcome.disposition === 'settlement_candidate' &&
            (secondOutcome.canonicalReference.ciphertext !== trustedReference.ciphertext ||
              secondOutcome.canonicalReference.fingerprint !== trustedReference.fingerprint ||
              secondOutcome.canonicalReference.masked !== trustedReference.masked))
        ) {
          return nonSettlementResult(undefined);
        }
        const replayIdentity = deriveTelebirrLivePilotReplayIdentity(
          request.signedAssignment,
          request.signedObservation,
        );
        const observationSignatureDigest = decodedSignatureDigest(
          request.signedObservation.signature,
        );
        if (
          !replayIdentity ||
          replayIdentity !== secondProtocol.replayIdentity ||
          !observationSignatureDigest
        ) {
          return nonSettlementResult(undefined);
        }

        const isSettlement = secondOutcome.disposition === 'settlement_candidate';
        const currentCompletionInput: TrustedTelebirrCompletionInput = {
          verificationAttemptId: request.verificationAttemptId,
          leaseToken: request.leaseToken,
          completionRequestKey: request.completionRequestKey,
          observationBodyDigest: request.signedObservation.bodyDigest,
          observationSignatureDigest,
          replayIdentity,
          sourceDocumentDigest: observation.sourceDocumentDigest,
          normalizedFactsDigest: observation.normalizedFactsDigest,
          observedAt: observation.observedAt,
          protocolDisposition: secondProtocol.disposition,
          protocolReasonCode: secondProtocol.reasonCode,
          assessmentInputDigest: secondOutcome.assessmentInputDigest,
          assessedAt: secondOutcome.assessedAt,
          disposition: secondOutcome.disposition,
          reasonCode: secondOutcome.reasonCode,
          evidenceDigest: secondOutcome.evidenceDigest,
          retrievedAt: secondOutcome.retrievedAt,
          receiptPrincipalAmountMinor: isSettlement ? secondOutcome.principalAmountMinor : null,
          occurredAt: isSettlement ? secondOutcome.occurredAt : null,
          receiverIdentityDigest: isSettlement ? secondOutcome.receiverIdentityDigest : null,
        };
        const existingCompletion = secondAuthority.existingCompletion;
        const trustedReceiver = dataRecord(secondAuthority.outcomeInputBase.trustedReceiver);
        const signedFoundFacts =
          observation.facts.lookupOutcome === 'found' ? observation.facts : undefined;
        if (
          existingCompletion !== null &&
          (existingCompletion.completionRequestKey !== request.completionRequestKey ||
            existingCompletion.observationBodyDigest !== request.signedObservation.bodyDigest ||
            existingCompletion.observationSignatureDigest !== observationSignatureDigest ||
            existingCompletion.replayIdentity !== replayIdentity ||
            existingCompletion.sourceDocumentDigest !== observation.sourceDocumentDigest ||
            existingCompletion.normalizedFactsDigest !== observation.normalizedFactsDigest ||
            existingCompletion.observedAt !== observation.observedAt ||
            (existingCompletion.disposition === 'settlement_candidate' &&
              (!signedFoundFacts ||
                existingCompletion.receiptPrincipalAmountMinor !==
                  String(signedFoundFacts.amountMinor) ||
                existingCompletion.occurredAt !== signedFoundFacts.occurredAt ||
                existingCompletion.receiverIdentityDigest !==
                  signedFoundFacts.creditedPartyNameDigest ||
                !trustedReceiver ||
                existingCompletion.receiverIdentityDigest !== trustedReceiver.identityDigest)))
        ) {
          return nonSettlementResult(undefined);
        }
        const completionInput = existingCompletion ?? currentCompletionInput;

        const completed = completionResult(
          await database.complete(completionInput),
          completionInput.disposition,
          completionInput.reasonCode,
        );
        if (!completed) throw new Error();
        return completed;
      } catch {
        throw new TrustedTelebirrVerifierUnavailableError();
      }
    },
  });
}

/** Fixed-key projection; it excludes IDs, references, digests, signatures, tokens, and keys. */
export function redactedTrustedTelebirrVerificationForLog(
  result: TrustedTelebirrVerificationResult,
): RedactedTrustedTelebirrVerificationLogProjection {
  if (result.status === 'settled') {
    return Object.freeze({
      verifierVersion: TRUSTED_TELEBIRR_VERIFIER_VERSION,
      status: 'settled',
      disposition: 'settlement_candidate',
      reasonCode: 'exact_proof_match',
      alreadyCompleted: result.alreadyCompleted,
    });
  }
  if (result.status === 'completed_without_settlement') {
    return Object.freeze({
      verifierVersion: TRUSTED_TELEBIRR_VERIFIER_VERSION,
      status: 'completed_without_settlement',
      disposition: result.disposition,
      reasonCode: 'verification_completed_without_settlement',
      alreadyCompleted: result.alreadyCompleted,
    });
  }
  return Object.freeze({
    verifierVersion: TRUSTED_TELEBIRR_VERIFIER_VERSION,
    status: 'not_settled',
    disposition: result.disposition,
    reasonCode: 'verification_not_settled',
    alreadyCompleted: false,
  });
}
