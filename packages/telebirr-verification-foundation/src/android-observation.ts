import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
  type UnknownRecord,
} from './exact-data-record.js';
import {
  TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  validatedTelebirrSafeReceiptEvidence,
  type TelebirrSafeReceiptEvidence,
} from './synthetic-official-receipt.js';

export const TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_ANDROID_OBSERVATION_PARSER_VERSION =
  'telebirr-official-receipt-parser-v1' as const;
export const TELEBIRR_ANDROID_OBSERVATION_NORMALIZER_VERSION =
  'telebirr-official-receipt-normalizer-v1' as const;

const FUTURE_OBSERVATION_TOLERANCE_MS = 5 * 60 * 1000;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const OPAQUE_DIGEST_PATTERN =
  /^(?:sha256|hmac-sha256|fixture-sha256|fixture-hmac-sha256):[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^[a-z][a-z0-9_-]{0,95}[-_]v\d+$/u;

const inputKeys = [
  'contractVersion',
  'providerCode',
  'assessedAt',
  'expectedBinding',
  'observation',
  'trustedChecks',
] as const;
const bindingKeys = [
  'jobId',
  'attemptNumber',
  'leaseNonceDigest',
  'submittedReferenceFingerprint',
  'deviceId',
  'sourceProfile',
  'parserVersion',
  'normalizerVersion',
  'leaseIssuedAt',
  'leaseExpiresAt',
] as const;
const observationKeys = [
  'contractVersion',
  'providerCode',
  'jobId',
  'attemptNumber',
  'leaseNonceDigest',
  'submittedReferenceFingerprint',
  'deviceId',
  'sourceProfile',
  'parserVersion',
  'normalizerVersion',
  'observedAt',
  'evidence',
] as const;
const trustedCheckKeys = ['signature', 'replay', 'device'] as const;
const planKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'advisoryOnly',
  'disposition',
  'reasonCode',
  'transportAllowed',
  'networkAllowed',
  'databaseWriteAllowed',
  'claimAllowed',
  'settlementAllowed',
  'enqueueAllowed',
  'executionAllowed',
  'financialActionAllowed',
] as const;

type SignatureCheck = 'valid' | 'invalid' | 'unavailable';
type ReplayCheck = 'clear' | 'replayed' | 'unavailable';
type DeviceCheck = 'active' | 'revoked' | 'offline' | 'unknown';

export interface TelebirrAndroidObservationBinding {
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly leaseNonceDigest: string;
  readonly submittedReferenceFingerprint: string;
  readonly deviceId: string;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly parserVersion: typeof TELEBIRR_ANDROID_OBSERVATION_PARSER_VERSION;
  readonly normalizerVersion: typeof TELEBIRR_ANDROID_OBSERVATION_NORMALIZER_VERSION;
  readonly leaseIssuedAt: string;
  readonly leaseExpiresAt: string;
}

export interface TelebirrAndroidObservationEnvelope {
  readonly contractVersion: typeof TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly leaseNonceDigest: string;
  readonly submittedReferenceFingerprint: string;
  readonly deviceId: string;
  readonly sourceProfile: string;
  readonly parserVersion: string;
  readonly normalizerVersion: string;
  readonly observedAt: string;
  readonly evidence: TelebirrSafeReceiptEvidence;
}

export interface TelebirrAndroidObservationPlannerInput {
  readonly contractVersion: typeof TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly assessedAt: string;
  readonly expectedBinding: TelebirrAndroidObservationBinding;
  readonly observation: TelebirrAndroidObservationEnvelope;
  /** These statuses must be established by a later trusted boundary; this pure planner does not. */
  readonly trustedChecks: {
    readonly signature: SignatureCheck;
    readonly replay: ReplayCheck;
    readonly device: DeviceCheck;
  };
}

type TelebirrAndroidObservationReviewReason =
  | 'device_revoked'
  | 'device_unavailable'
  | 'signature_invalid'
  | 'signature_unavailable'
  | 'replay_detected'
  | 'replay_check_unavailable'
  | 'binding_mismatch'
  | 'source_profile_mismatch'
  | 'parser_version_mismatch'
  | 'normalizer_version_mismatch'
  | 'lease_expired'
  | 'observation_time_invalid'
  | 'receipt_unavailable'
  | 'receipt_provenance_incomplete';

type TelebirrAndroidObservationPlanReason =
  'invalid_request' | 'observation_bound' | TelebirrAndroidObservationReviewReason;

interface DisabledObservationCapabilities {
  readonly transportAllowed: false;
  readonly networkAllowed: false;
  readonly databaseWriteAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
}

interface ObservationPlanBase extends DisabledObservationCapabilities {
  readonly contractVersion: typeof TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly advisoryOnly: true;
}

export interface TelebirrAndroidObservationInvalidPlan extends ObservationPlanBase {
  readonly disposition: 'invalid_request';
  readonly reasonCode: 'invalid_request';
}

export interface TelebirrAndroidObservationReviewPlan extends ObservationPlanBase {
  readonly disposition: 'would_review';
  readonly reasonCode: TelebirrAndroidObservationReviewReason;
}

export interface TelebirrAndroidObservationForwardPlan extends ObservationPlanBase {
  readonly disposition: 'would_forward_safe_observation';
  readonly reasonCode: 'observation_bound';
}

export type TelebirrAndroidObservationPlan =
  | TelebirrAndroidObservationInvalidPlan
  | TelebirrAndroidObservationReviewPlan
  | TelebirrAndroidObservationForwardPlan;

export type RedactedTelebirrAndroidObservationPlanLogProjection = TelebirrAndroidObservationPlan;

interface ParsedBinding {
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly leaseNonceDigest: string;
  readonly submittedReferenceFingerprint: string;
  readonly deviceId: string;
  readonly sourceProfile: string;
  readonly parserVersion: string;
  readonly normalizerVersion: string;
  readonly leaseIssuedAt: string;
  readonly leaseExpiresAt: string;
}

interface ParsedObservation {
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly leaseNonceDigest: string;
  readonly submittedReferenceFingerprint: string;
  readonly deviceId: string;
  readonly sourceProfile: string;
  readonly parserVersion: string;
  readonly normalizerVersion: string;
  readonly observedAt: string;
  readonly evidence: TelebirrSafeReceiptEvidence;
}

interface ParsedInput {
  readonly assessedAt: string;
  readonly expectedBinding: ParsedBinding;
  readonly observation: ParsedObservation;
  readonly trustedChecks: {
    readonly signature: SignatureCheck;
    readonly replay: ReplayCheck;
    readonly device: DeviceCheck;
  };
}

const disabledCapabilities: DisabledObservationCapabilities = Object.freeze({
  transportAllowed: false as const,
  networkAllowed: false as const,
  databaseWriteAllowed: false as const,
  claimAllowed: false as const,
  settlementAllowed: false as const,
  enqueueAllowed: false as const,
  executionAllowed: false as const,
  financialActionAllowed: false as const,
});

const planBase = Object.freeze({
  contractVersion: TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION,
  providerCode: 'telebirr' as const,
  sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  advisoryOnly: true as const,
  ...disabledCapabilities,
});

const invalidPlan: TelebirrAndroidObservationInvalidPlan = Object.freeze({
  ...planBase,
  disposition: 'invalid_request' as const,
  reasonCode: 'invalid_request' as const,
});

const forwardPlan: TelebirrAndroidObservationForwardPlan = Object.freeze({
  ...planBase,
  disposition: 'would_forward_safe_observation' as const,
  reasonCode: 'observation_bound' as const,
});

function reviewPlan(
  reasonCode: TelebirrAndroidObservationReviewReason,
): TelebirrAndroidObservationReviewPlan {
  return Object.freeze({ ...planBase, disposition: 'would_review' as const, reasonCode });
}

function parseOpaqueId(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value) ? value : undefined;
}

function parseOpaqueDigest(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_DIGEST_PATTERN.test(value) ? value : undefined;
}

function parseVersion(value: unknown): string | undefined {
  return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : undefined;
}

function parseBinding(candidate: unknown): ParsedBinding | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, bindingKeys)) {
    return undefined;
  }

  const jobId = parseOpaqueId(ownDataValue(candidate, 'jobId'));
  const attemptNumber = ownDataValue(candidate, 'attemptNumber');
  const leaseNonceDigest = parseOpaqueDigest(ownDataValue(candidate, 'leaseNonceDigest'));
  const submittedReferenceFingerprint = parseOpaqueDigest(
    ownDataValue(candidate, 'submittedReferenceFingerprint'),
  );
  const deviceId = parseOpaqueId(ownDataValue(candidate, 'deviceId'));
  const sourceProfile = parseVersion(ownDataValue(candidate, 'sourceProfile'));
  const parserVersion = parseVersion(ownDataValue(candidate, 'parserVersion'));
  const normalizerVersion = parseVersion(ownDataValue(candidate, 'normalizerVersion'));
  const leaseIssuedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'leaseIssuedAt'));
  const leaseExpiresAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'leaseExpiresAt'));
  if (
    !jobId ||
    !Number.isSafeInteger(attemptNumber) ||
    (attemptNumber as number) < 1 ||
    (attemptNumber as number) > 1_000_000 ||
    !leaseNonceDigest ||
    !submittedReferenceFingerprint ||
    !deviceId ||
    sourceProfile !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
    parserVersion !== TELEBIRR_ANDROID_OBSERVATION_PARSER_VERSION ||
    normalizerVersion !== TELEBIRR_ANDROID_OBSERVATION_NORMALIZER_VERSION ||
    !leaseIssuedAt ||
    !leaseExpiresAt ||
    leaseIssuedAt >= leaseExpiresAt
  ) {
    return undefined;
  }

  return Object.freeze({
    jobId,
    attemptNumber: attemptNumber as number,
    leaseNonceDigest,
    submittedReferenceFingerprint,
    deviceId,
    sourceProfile,
    parserVersion,
    normalizerVersion,
    leaseIssuedAt,
    leaseExpiresAt,
  });
}

function parseObservation(candidate: unknown): ParsedObservation | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, observationKeys)
  ) {
    return undefined;
  }

  const jobId = parseOpaqueId(ownDataValue(candidate, 'jobId'));
  const attemptNumber = ownDataValue(candidate, 'attemptNumber');
  const leaseNonceDigest = parseOpaqueDigest(ownDataValue(candidate, 'leaseNonceDigest'));
  const submittedReferenceFingerprint = parseOpaqueDigest(
    ownDataValue(candidate, 'submittedReferenceFingerprint'),
  );
  const deviceId = parseOpaqueId(ownDataValue(candidate, 'deviceId'));
  const sourceProfile = parseVersion(ownDataValue(candidate, 'sourceProfile'));
  const parserVersion = parseVersion(ownDataValue(candidate, 'parserVersion'));
  const normalizerVersion = parseVersion(ownDataValue(candidate, 'normalizerVersion'));
  const observedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'observedAt'));
  const evidence = validatedTelebirrSafeReceiptEvidence(ownDataValue(candidate, 'evidence'));

  if (
    ownDataValue(candidate, 'contractVersion') !== TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
    !jobId ||
    !Number.isSafeInteger(attemptNumber) ||
    (attemptNumber as number) < 1 ||
    (attemptNumber as number) > 1_000_000 ||
    !leaseNonceDigest ||
    !submittedReferenceFingerprint ||
    !deviceId ||
    !sourceProfile ||
    !parserVersion ||
    !normalizerVersion ||
    !observedAt ||
    !evidence
  ) {
    return undefined;
  }

  return Object.freeze({
    jobId,
    attemptNumber: attemptNumber as number,
    leaseNonceDigest,
    submittedReferenceFingerprint,
    deviceId,
    sourceProfile,
    parserVersion,
    normalizerVersion,
    observedAt,
    evidence,
  });
}

function parseTrustedChecks(candidate: unknown): ParsedInput['trustedChecks'] | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, trustedCheckKeys)
  ) {
    return undefined;
  }

  const signature = ownDataValue(candidate, 'signature');
  const replay = ownDataValue(candidate, 'replay');
  const device = ownDataValue(candidate, 'device');
  if (
    (signature !== 'valid' && signature !== 'invalid' && signature !== 'unavailable') ||
    (replay !== 'clear' && replay !== 'replayed' && replay !== 'unavailable') ||
    (device !== 'active' && device !== 'revoked' && device !== 'offline' && device !== 'unknown')
  ) {
    return undefined;
  }

  return Object.freeze({ signature, replay, device });
}

function parseInput(candidate: unknown): ParsedInput | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, inputKeys)) {
    return undefined;
  }

  const assessedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'assessedAt'));
  const expectedBinding = parseBinding(ownDataValue(candidate, 'expectedBinding'));
  const observation = parseObservation(ownDataValue(candidate, 'observation'));
  const trustedChecks = parseTrustedChecks(ownDataValue(candidate, 'trustedChecks'));
  if (
    ownDataValue(candidate, 'contractVersion') !== TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
    !assessedAt ||
    !expectedBinding ||
    !observation ||
    !trustedChecks ||
    assessedAt < expectedBinding.leaseIssuedAt
  ) {
    return undefined;
  }

  return Object.freeze({ assessedAt, expectedBinding, observation, trustedChecks });
}

/**
 * Produces an advisory routing decision only. Signature, replay, and device checks are injected as
 * facts by a future trusted boundary; this module neither performs them nor grants any capability.
 */
export function planTelebirrAndroidObservation(
  inputCandidate: unknown,
): TelebirrAndroidObservationPlan {
  try {
    const input = parseInput(inputCandidate);
    if (!input) return invalidPlan;

    if (input.trustedChecks.device === 'revoked') return reviewPlan('device_revoked');
    if (input.trustedChecks.device === 'offline' || input.trustedChecks.device === 'unknown') {
      return reviewPlan('device_unavailable');
    }
    if (input.trustedChecks.signature === 'invalid') return reviewPlan('signature_invalid');
    if (input.trustedChecks.signature === 'unavailable') {
      return reviewPlan('signature_unavailable');
    }
    if (input.trustedChecks.replay === 'replayed') return reviewPlan('replay_detected');
    if (input.trustedChecks.replay === 'unavailable') {
      return reviewPlan('replay_check_unavailable');
    }

    const expected = input.expectedBinding;
    const observation = input.observation;
    if (
      observation.jobId !== expected.jobId ||
      observation.attemptNumber !== expected.attemptNumber ||
      observation.leaseNonceDigest !== expected.leaseNonceDigest ||
      observation.submittedReferenceFingerprint !== expected.submittedReferenceFingerprint ||
      observation.deviceId !== expected.deviceId
    ) {
      return reviewPlan('binding_mismatch');
    }

    if (observation.sourceProfile !== expected.sourceProfile) {
      return reviewPlan('source_profile_mismatch');
    }
    if (observation.parserVersion !== expected.parserVersion) {
      return reviewPlan('parser_version_mismatch');
    }
    if (observation.normalizerVersion !== expected.normalizerVersion) {
      return reviewPlan('normalizer_version_mismatch');
    }

    const assessedAtMs = Date.parse(input.assessedAt);
    const leaseIssuedAtMs = Date.parse(expected.leaseIssuedAt);
    const leaseExpiresAtMs = Date.parse(expected.leaseExpiresAt);
    const observedAtMs = Date.parse(observation.observedAt);
    if (assessedAtMs >= leaseExpiresAtMs) return reviewPlan('lease_expired');
    if (
      observedAtMs < leaseIssuedAtMs ||
      observedAtMs >= leaseExpiresAtMs ||
      observedAtMs > assessedAtMs + FUTURE_OBSERVATION_TOLERANCE_MS
    ) {
      return reviewPlan('observation_time_invalid');
    }

    if (observation.evidence.lookupOutcome === 'unavailable') {
      return reviewPlan('receipt_unavailable');
    }

    if (observation.evidence.lookupOutcome === 'found') {
      if (
        observation.evidence.retrievedAt !== observation.observedAt ||
        !observation.evidence.provenance.adapterVersionPresent ||
        !observation.evidence.provenance.normalizationVersionPresent ||
        !observation.evidence.provenance.evidenceDigestPresent
      ) {
        return reviewPlan('receipt_provenance_incomplete');
      }
    }

    return forwardPlan;
  } catch {
    return invalidPlan;
  }
}

function isReasonCode(value: unknown): value is TelebirrAndroidObservationPlanReason {
  return (
    value === 'invalid_request' ||
    value === 'observation_bound' ||
    value === 'device_revoked' ||
    value === 'device_unavailable' ||
    value === 'signature_invalid' ||
    value === 'signature_unavailable' ||
    value === 'replay_detected' ||
    value === 'replay_check_unavailable' ||
    value === 'binding_mismatch' ||
    value === 'source_profile_mismatch' ||
    value === 'parser_version_mismatch' ||
    value === 'normalizer_version_mismatch' ||
    value === 'lease_expired' ||
    value === 'observation_time_invalid' ||
    value === 'receipt_unavailable' ||
    value === 'receipt_provenance_incomplete'
  );
}

function hasDisabledCapabilities(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'transportAllowed') === false &&
    ownDataValue(candidate, 'networkAllowed') === false &&
    ownDataValue(candidate, 'databaseWriteAllowed') === false &&
    ownDataValue(candidate, 'claimAllowed') === false &&
    ownDataValue(candidate, 'settlementAllowed') === false &&
    ownDataValue(candidate, 'enqueueAllowed') === false &&
    ownDataValue(candidate, 'executionAllowed') === false &&
    ownDataValue(candidate, 'financialActionAllowed') === false
  );
}

/** Revalidates a plan and returns only fixed, allowlisted, non-sensitive fields. */
export function redactedTelebirrAndroidObservationPlanForLog(
  planCandidate: unknown,
): RedactedTelebirrAndroidObservationPlanLogProjection {
  try {
    if (
      !isPlainNonProxyRecord(planCandidate) ||
      !hasExactEnumerableDataKeys(planCandidate, planKeys) ||
      ownDataValue(planCandidate, 'contractVersion') !==
        TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION ||
      ownDataValue(planCandidate, 'providerCode') !== 'telebirr' ||
      ownDataValue(planCandidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      ownDataValue(planCandidate, 'advisoryOnly') !== true ||
      !hasDisabledCapabilities(planCandidate)
    ) {
      return invalidPlan;
    }

    const disposition = ownDataValue(planCandidate, 'disposition');
    const reasonCode = ownDataValue(planCandidate, 'reasonCode');
    if (!isReasonCode(reasonCode)) return invalidPlan;

    if (disposition === 'invalid_request' && reasonCode === 'invalid_request') return invalidPlan;
    if (disposition === 'would_forward_safe_observation' && reasonCode === 'observation_bound') {
      return forwardPlan;
    }
    if (
      disposition === 'would_review' &&
      reasonCode !== 'invalid_request' &&
      reasonCode !== 'observation_bound'
    ) {
      return reviewPlan(reasonCode);
    }
    return invalidPlan;
  } catch {
    return invalidPlan;
  }
}
