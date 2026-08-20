import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  hasExactEnumerableDataKeys,
  isNonProxyArray,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
  type UnknownRecord,
} from './exact-data-record.js';
import { TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE } from './synthetic-official-receipt.js';

export const TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE = 'synthetic_shadow' as const;
export const TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION =
  'telebirr-signed-relay-transcript-v1' as const;
export const TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM = 'sha256' as const;
export const TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256' as const;
export const TELEBIRR_SIGNED_RELAY_SIGNATURE_ENCODING = 'ieee-p1363-base64url' as const;
export const TELEBIRR_SIGNED_RELAY_ADAPTER_VERSION = 'telebirr-synthetic-relay-adapter-v1' as const;
export const TELEBIRR_SIGNED_RELAY_PARSER_VERSION = 'telebirr-official-receipt-parser-v1' as const;
export const TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION =
  'telebirr-official-receipt-normalizer-v1' as const;

const FUTURE_OBSERVATION_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_REPLAY_IDENTITIES = 4_096;
const MAX_SPKI_BYTES = 512;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const VERSION_PATTERN = /^[a-z][a-z0-9_-]{0,95}[-_]v\d+$/u;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REFERENCE_FINGERPRINT_PATTERN = /^(?:hmac-sha256|fixture-hmac-sha256):[a-f0-9]{64}$/u;
const P1363_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

const enrollmentKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'enrollmentId',
  'deviceId',
  'keyId',
  'publicKeySpkiSha256',
  'signatureAlgorithm',
  'state',
  'enrolledAt',
  'validFrom',
  'validUntil',
  'sourceProfile',
  'receiverProfileId',
  'receiverProfileDigest',
  'parserVersion',
  'normalizerVersion',
] as const;
const requestKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'requestId',
  'jobId',
  'attemptNumber',
  'referenceFingerprint',
  'sourceProfile',
  'receiverProfileId',
  'receiverProfileDigest',
  'parserVersion',
  'normalizerVersion',
  'requestedAt',
] as const;
const leaseKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'leaseId',
  'requestId',
  'jobId',
  'attemptNumber',
  'deviceId',
  'keyId',
  'leaseNonceDigest',
  'challengeId',
  'challengeDigest',
  'referenceFingerprint',
  'sourceProfile',
  'receiverProfileId',
  'receiverProfileDigest',
  'parserVersion',
  'normalizerVersion',
  'issuedAt',
  'expiresAt',
] as const;
const observationBodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'requestId',
  'jobId',
  'attemptNumber',
  'leaseId',
  'deviceId',
  'keyId',
  'leaseNonceDigest',
  'challengeId',
  'challengeDigest',
  'referenceFingerprint',
  'sourceProfile',
  'receiverProfileId',
  'receiverProfileDigest',
  'adapterVersion',
  'parserVersion',
  'normalizerVersion',
  'sourceDocumentDigest',
  'normalizedFactsDigest',
  'observedAt',
  'facts',
] as const;
const signedEnvelopeKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'transcriptVersion',
  'bodyDigestAlgorithm',
  'bodyDigest',
  'signatureAlgorithm',
  'signatureEncoding',
  'body',
  'signature',
] as const;
const verificationInputKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'assessedAt',
  'enrollment',
  'request',
  'lease',
  'signedObservation',
  'serverComputedReplayIdentities',
] as const;
const foundFactsKeys = [
  'lookupOutcome',
  'evidenceSource',
  'providerIdentity',
  'providerFinalStatus',
  'canonicalReferencePresent',
  'referenceMatch',
  'amountMinor',
  'currencyCode',
  'receiverMatch',
  'maskedReceiverDiagnostic',
  'paymentMode',
  'paymentReason',
  'paymentChannel',
  'occurredAt',
  'retrievedAt',
] as const;
const unavailableFactsKeys = ['lookupOutcome', 'uncertainty'] as const;
const notFoundFactsKeys = ['lookupOutcome'] as const;

export interface TelebirrRelayEnrollmentEnvelope {
  readonly contractVersion: typeof TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE;
  readonly enrollmentId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly publicKeySpkiSha256: string;
  readonly signatureAlgorithm: typeof TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM;
  readonly state: 'active' | 'revoked';
  readonly enrolledAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly parserVersion: typeof TELEBIRR_SIGNED_RELAY_PARSER_VERSION;
  readonly normalizerVersion: typeof TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION;
}

export interface TelebirrRelayRequestEnvelope {
  readonly contractVersion: typeof TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE;
  readonly requestId: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly referenceFingerprint: string;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly parserVersion: typeof TELEBIRR_SIGNED_RELAY_PARSER_VERSION;
  readonly normalizerVersion: typeof TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION;
  readonly requestedAt: string;
}

export interface TelebirrRelayLeaseEnvelope {
  readonly contractVersion: typeof TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE;
  readonly leaseId: string;
  readonly requestId: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly deviceId: string;
  readonly keyId: string;
  readonly leaseNonceDigest: string;
  readonly challengeId: string;
  readonly challengeDigest: string;
  readonly referenceFingerprint: string;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly parserVersion: typeof TELEBIRR_SIGNED_RELAY_PARSER_VERSION;
  readonly normalizerVersion: typeof TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface TelebirrRelayFoundReceiptFacts {
  readonly lookupOutcome: 'found';
  readonly evidenceSource: 'provider_receipt_lookup';
  readonly providerIdentity: 'matched' | 'mismatched' | 'unknown';
  readonly providerFinalStatus: 'completed' | 'pending' | 'failed' | 'reversed' | 'unknown';
  readonly canonicalReferencePresent: boolean;
  readonly referenceMatch: 'matched' | 'mismatched' | 'unknown';
  readonly amountMinor: number | null;
  readonly currencyCode: 'ETB' | 'unknown';
  readonly receiverMatch: 'matched' | 'mismatched' | 'unknown';
  readonly maskedReceiverDiagnostic: 'matched' | 'mismatched' | 'unknown';
  readonly paymentMode: 'telebirr' | 'other' | 'unknown';
  readonly paymentReason: 'send_money_to_registered_customer' | 'other' | 'unknown';
  readonly paymentChannel: 'api_app' | 'other' | 'unknown';
  readonly occurredAt: string | null;
  readonly retrievedAt: string | null;
}

export type TelebirrRelayReceiptFacts =
  | TelebirrRelayFoundReceiptFacts
  | { readonly lookupOutcome: 'not_found' }
  | {
      readonly lookupOutcome: 'unavailable';
      readonly uncertainty: 'provider' | 'network' | 'parser' | 'device';
    };

export interface TelebirrRelayObservationBody {
  readonly contractVersion: typeof TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE;
  readonly requestId: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly leaseId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly leaseNonceDigest: string;
  readonly challengeId: string;
  readonly challengeDigest: string;
  readonly referenceFingerprint: string;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly adapterVersion: typeof TELEBIRR_SIGNED_RELAY_ADAPTER_VERSION;
  readonly parserVersion: typeof TELEBIRR_SIGNED_RELAY_PARSER_VERSION;
  readonly normalizerVersion: typeof TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION;
  readonly sourceDocumentDigest: string;
  readonly normalizedFactsDigest: string;
  readonly observedAt: string;
  readonly facts: TelebirrRelayReceiptFacts;
}

export interface TelebirrRelaySignedObservationEnvelope {
  readonly contractVersion: typeof TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE;
  readonly transcriptVersion: typeof TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof TELEBIRR_SIGNED_RELAY_SIGNATURE_ENCODING;
  readonly body: TelebirrRelayObservationBody;
  readonly signature: string;
}

export interface TelebirrSignedRelayVerificationInput {
  readonly contractVersion: typeof TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE;
  readonly assessedAt: string;
  readonly enrollment: TelebirrRelayEnrollmentEnvelope;
  readonly request: TelebirrRelayRequestEnvelope;
  readonly lease: TelebirrRelayLeaseEnvelope;
  readonly signedObservation: TelebirrRelaySignedObservationEnvelope;
  /** Replay identities previously computed at the trusted server boundary. */
  readonly serverComputedReplayIdentities: readonly string[];
}

type TelebirrSignedRelayReason =
  | 'invalid_request'
  | 'device_revoked'
  | 'enrollment_expired'
  | 'lease_expired'
  | 'observation_time_invalid'
  | 'binding_mismatch'
  | 'source_profile_mismatch'
  | 'receiver_profile_mismatch'
  | 'parser_version_mismatch'
  | 'normalizer_version_mismatch'
  | 'adapter_version_mismatch'
  | 'facts_digest_mismatch'
  | 'body_digest_mismatch'
  | 'public_key_invalid'
  | 'key_fingerprint_mismatch'
  | 'signature_invalid'
  | 'replay_detected'
  | 'signed_observation_verified';

interface DisabledRelayCapabilities {
  readonly transportAllowed: false;
  readonly networkAllowed: false;
  readonly providerInteractionAllowed: false;
  readonly databaseWriteAllowed: false;
  readonly persistenceAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
}

export interface TelebirrSignedRelayVerificationResult extends DisabledRelayCapabilities {
  readonly contractVersion: typeof TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly transcriptVersion: typeof TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM;
  readonly signatureAlgorithm: typeof TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM;
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_request' | 'would_review' | 'would_forward_signed_observation';
  readonly reasonCode: TelebirrSignedRelayReason;
  readonly verifiedBodyDigest: string | null;
  readonly replayIdentity: string | null;
}

export type RedactedTelebirrSignedRelayVerificationLogProjection = Omit<
  TelebirrSignedRelayVerificationResult,
  'verifiedBodyDigest' | 'replayIdentity'
>;

type CanonicalScalar = string | number | boolean | null;
type CanonicalField = readonly [name: string, value: CanonicalScalar];

const disabledCapabilities: DisabledRelayCapabilities = Object.freeze({
  transportAllowed: false as const,
  networkAllowed: false as const,
  providerInteractionAllowed: false as const,
  databaseWriteAllowed: false as const,
  persistenceAllowed: false as const,
  claimAllowed: false as const,
  settlementAllowed: false as const,
  enqueueAllowed: false as const,
  executionAllowed: false as const,
  financialActionAllowed: false as const,
});

const resultBase = Object.freeze({
  contractVersion: TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION,
  providerCode: 'telebirr' as const,
  protocolMode: TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE,
  sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  transcriptVersion: TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION,
  bodyDigestAlgorithm: TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM,
  signatureAlgorithm: TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM,
  advisoryOnly: true as const,
  ...disabledCapabilities,
});

function result(
  disposition: TelebirrSignedRelayVerificationResult['disposition'],
  reasonCode: TelebirrSignedRelayReason,
  verifiedBodyDigest: string | null = null,
  replayIdentity: string | null = null,
): TelebirrSignedRelayVerificationResult {
  return Object.freeze({
    ...resultBase,
    disposition,
    reasonCode,
    verifiedBodyDigest,
    replayIdentity,
  });
}

const invalidResult = result('invalid_request', 'invalid_request');

function parseOpaqueId(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value) ? value : undefined;
}

function parseVersion(value: unknown): string | undefined {
  return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : undefined;
}

function parseSha256Digest(value: unknown): string | undefined {
  return typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value) ? value : undefined;
}

function parseReferenceFingerprint(value: unknown): string | undefined {
  return typeof value === 'string' && REFERENCE_FINGERPRINT_PATTERN.test(value) ? value : undefined;
}

function parseTimestamp(value: unknown): string | undefined {
  const parsed = parseCanonicalUtcTimestamp(value);
  return typeof parsed === 'string' ? parsed : undefined;
}

function parseAttemptNumber(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1_000_000
    ? (value as number)
    : undefined;
}

function hasRelayHeader(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') === TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'telebirr' &&
    ownDataValue(candidate, 'protocolMode') === TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE
  );
}

export function decodeTelebirrRelayEnrollmentEnvelope(
  candidate: unknown,
): TelebirrRelayEnrollmentEnvelope | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, enrollmentKeys) ||
      !hasRelayHeader(candidate)
    ) {
      return undefined;
    }

    const enrollmentId = parseOpaqueId(ownDataValue(candidate, 'enrollmentId'));
    const deviceId = parseOpaqueId(ownDataValue(candidate, 'deviceId'));
    const keyId = parseOpaqueId(ownDataValue(candidate, 'keyId'));
    const publicKeySpkiSha256 = parseSha256Digest(ownDataValue(candidate, 'publicKeySpkiSha256'));
    const state = ownDataValue(candidate, 'state');
    const enrolledAt = parseTimestamp(ownDataValue(candidate, 'enrolledAt'));
    const validFrom = parseTimestamp(ownDataValue(candidate, 'validFrom'));
    const validUntil = parseTimestamp(ownDataValue(candidate, 'validUntil'));
    const receiverProfileId = parseOpaqueId(ownDataValue(candidate, 'receiverProfileId'));
    const receiverProfileDigest = parseSha256Digest(
      ownDataValue(candidate, 'receiverProfileDigest'),
    );
    if (
      !enrollmentId ||
      !deviceId ||
      !keyId ||
      !publicKeySpkiSha256 ||
      ownDataValue(candidate, 'signatureAlgorithm') !== TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM ||
      (state !== 'active' && state !== 'revoked') ||
      !enrolledAt ||
      !validFrom ||
      !validUntil ||
      enrolledAt > validFrom ||
      validFrom >= validUntil ||
      ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      !receiverProfileId ||
      !receiverProfileDigest ||
      ownDataValue(candidate, 'parserVersion') !== TELEBIRR_SIGNED_RELAY_PARSER_VERSION ||
      ownDataValue(candidate, 'normalizerVersion') !== TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION
    ) {
      return undefined;
    }

    return Object.freeze({
      contractVersion: TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION,
      providerCode: 'telebirr' as const,
      protocolMode: TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE,
      enrollmentId,
      deviceId,
      keyId,
      publicKeySpkiSha256,
      signatureAlgorithm: TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM,
      state,
      enrolledAt,
      validFrom,
      validUntil,
      sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
      receiverProfileId,
      receiverProfileDigest,
      parserVersion: TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
      normalizerVersion: TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
    });
  } catch {
    return undefined;
  }
}

export function decodeTelebirrRelayRequestEnvelope(
  candidate: unknown,
): TelebirrRelayRequestEnvelope | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, requestKeys) ||
      !hasRelayHeader(candidate)
    ) {
      return undefined;
    }

    const requestId = parseOpaqueId(ownDataValue(candidate, 'requestId'));
    const jobId = parseOpaqueId(ownDataValue(candidate, 'jobId'));
    const attemptNumber = parseAttemptNumber(ownDataValue(candidate, 'attemptNumber'));
    const referenceFingerprint = parseReferenceFingerprint(
      ownDataValue(candidate, 'referenceFingerprint'),
    );
    const receiverProfileId = parseOpaqueId(ownDataValue(candidate, 'receiverProfileId'));
    const receiverProfileDigest = parseSha256Digest(
      ownDataValue(candidate, 'receiverProfileDigest'),
    );
    const requestedAt = parseTimestamp(ownDataValue(candidate, 'requestedAt'));
    if (
      !requestId ||
      !jobId ||
      !attemptNumber ||
      !referenceFingerprint ||
      ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      !receiverProfileId ||
      !receiverProfileDigest ||
      ownDataValue(candidate, 'parserVersion') !== TELEBIRR_SIGNED_RELAY_PARSER_VERSION ||
      ownDataValue(candidate, 'normalizerVersion') !== TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION ||
      !requestedAt
    ) {
      return undefined;
    }

    return Object.freeze({
      contractVersion: TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION,
      providerCode: 'telebirr' as const,
      protocolMode: TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE,
      requestId,
      jobId,
      attemptNumber,
      referenceFingerprint,
      sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
      receiverProfileId,
      receiverProfileDigest,
      parserVersion: TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
      normalizerVersion: TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
      requestedAt,
    });
  } catch {
    return undefined;
  }
}

export function decodeTelebirrRelayLeaseEnvelope(
  candidate: unknown,
): TelebirrRelayLeaseEnvelope | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, leaseKeys) ||
      !hasRelayHeader(candidate)
    ) {
      return undefined;
    }

    const leaseId = parseOpaqueId(ownDataValue(candidate, 'leaseId'));
    const requestId = parseOpaqueId(ownDataValue(candidate, 'requestId'));
    const jobId = parseOpaqueId(ownDataValue(candidate, 'jobId'));
    const attemptNumber = parseAttemptNumber(ownDataValue(candidate, 'attemptNumber'));
    const deviceId = parseOpaqueId(ownDataValue(candidate, 'deviceId'));
    const keyId = parseOpaqueId(ownDataValue(candidate, 'keyId'));
    const leaseNonceDigest = parseSha256Digest(ownDataValue(candidate, 'leaseNonceDigest'));
    const challengeId = parseOpaqueId(ownDataValue(candidate, 'challengeId'));
    const challengeDigest = parseSha256Digest(ownDataValue(candidate, 'challengeDigest'));
    const referenceFingerprint = parseReferenceFingerprint(
      ownDataValue(candidate, 'referenceFingerprint'),
    );
    const receiverProfileId = parseOpaqueId(ownDataValue(candidate, 'receiverProfileId'));
    const receiverProfileDigest = parseSha256Digest(
      ownDataValue(candidate, 'receiverProfileDigest'),
    );
    const issuedAt = parseTimestamp(ownDataValue(candidate, 'issuedAt'));
    const expiresAt = parseTimestamp(ownDataValue(candidate, 'expiresAt'));
    if (
      !leaseId ||
      !requestId ||
      !jobId ||
      !attemptNumber ||
      !deviceId ||
      !keyId ||
      !leaseNonceDigest ||
      !challengeId ||
      !challengeDigest ||
      !referenceFingerprint ||
      ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      !receiverProfileId ||
      !receiverProfileDigest ||
      ownDataValue(candidate, 'parserVersion') !== TELEBIRR_SIGNED_RELAY_PARSER_VERSION ||
      ownDataValue(candidate, 'normalizerVersion') !== TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION ||
      !issuedAt ||
      !expiresAt ||
      issuedAt >= expiresAt
    ) {
      return undefined;
    }

    return Object.freeze({
      contractVersion: TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION,
      providerCode: 'telebirr' as const,
      protocolMode: TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE,
      leaseId,
      requestId,
      jobId,
      attemptNumber,
      deviceId,
      keyId,
      leaseNonceDigest,
      challengeId,
      challengeDigest,
      referenceFingerprint,
      sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
      receiverProfileId,
      receiverProfileDigest,
      parserVersion: TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
      normalizerVersion: TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
      issuedAt,
      expiresAt,
    });
  } catch {
    return undefined;
  }
}

function decodeFoundFacts(candidate: UnknownRecord): TelebirrRelayFoundReceiptFacts | undefined {
  if (!hasExactEnumerableDataKeys(candidate, foundFactsKeys)) return undefined;

  const providerIdentity = ownDataValue(candidate, 'providerIdentity');
  const providerFinalStatus = ownDataValue(candidate, 'providerFinalStatus');
  const canonicalReferencePresent = ownDataValue(candidate, 'canonicalReferencePresent');
  const referenceMatch = ownDataValue(candidate, 'referenceMatch');
  const amountMinor = ownDataValue(candidate, 'amountMinor');
  const currencyCode = ownDataValue(candidate, 'currencyCode');
  const receiverMatch = ownDataValue(candidate, 'receiverMatch');
  const maskedReceiverDiagnostic = ownDataValue(candidate, 'maskedReceiverDiagnostic');
  const paymentMode = ownDataValue(candidate, 'paymentMode');
  const paymentReason = ownDataValue(candidate, 'paymentReason');
  const paymentChannel = ownDataValue(candidate, 'paymentChannel');
  const occurredAtValue = ownDataValue(candidate, 'occurredAt');
  const retrievedAtValue = ownDataValue(candidate, 'retrievedAt');
  const occurredAt = occurredAtValue === null ? null : parseTimestamp(occurredAtValue);
  const retrievedAt = retrievedAtValue === null ? null : parseTimestamp(retrievedAtValue);

  if (
    ownDataValue(candidate, 'lookupOutcome') !== 'found' ||
    ownDataValue(candidate, 'evidenceSource') !== 'provider_receipt_lookup' ||
    (providerIdentity !== 'matched' &&
      providerIdentity !== 'mismatched' &&
      providerIdentity !== 'unknown') ||
    (providerFinalStatus !== 'completed' &&
      providerFinalStatus !== 'pending' &&
      providerFinalStatus !== 'failed' &&
      providerFinalStatus !== 'reversed' &&
      providerFinalStatus !== 'unknown') ||
    typeof canonicalReferencePresent !== 'boolean' ||
    (referenceMatch !== 'matched' &&
      referenceMatch !== 'mismatched' &&
      referenceMatch !== 'unknown') ||
    (canonicalReferencePresent ? referenceMatch === 'unknown' : referenceMatch !== 'unknown') ||
    (amountMinor !== null &&
      (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0)) ||
    (currencyCode !== 'ETB' && currencyCode !== 'unknown') ||
    (amountMinor === null ? currencyCode !== 'unknown' : currencyCode !== 'ETB') ||
    (receiverMatch !== 'matched' &&
      receiverMatch !== 'mismatched' &&
      receiverMatch !== 'unknown') ||
    (maskedReceiverDiagnostic !== 'matched' &&
      maskedReceiverDiagnostic !== 'mismatched' &&
      maskedReceiverDiagnostic !== 'unknown') ||
    (paymentMode !== 'telebirr' && paymentMode !== 'other' && paymentMode !== 'unknown') ||
    (paymentReason !== 'send_money_to_registered_customer' &&
      paymentReason !== 'other' &&
      paymentReason !== 'unknown') ||
    (paymentChannel !== 'api_app' && paymentChannel !== 'other' && paymentChannel !== 'unknown') ||
    occurredAt === undefined ||
    retrievedAt === undefined ||
    (occurredAt !== null && retrievedAt !== null && retrievedAt < occurredAt)
  ) {
    return undefined;
  }

  return Object.freeze({
    lookupOutcome: 'found' as const,
    evidenceSource: 'provider_receipt_lookup' as const,
    providerIdentity,
    providerFinalStatus,
    canonicalReferencePresent,
    referenceMatch,
    amountMinor: amountMinor as number | null,
    currencyCode,
    receiverMatch,
    maskedReceiverDiagnostic,
    paymentMode,
    paymentReason,
    paymentChannel,
    occurredAt,
    retrievedAt,
  });
}

export function decodeTelebirrRelayReceiptFacts(
  candidate: unknown,
): TelebirrRelayReceiptFacts | undefined {
  try {
    if (!isPlainNonProxyRecord(candidate)) return undefined;
    const lookupOutcome = ownDataValue(candidate, 'lookupOutcome');
    if (lookupOutcome === 'not_found') {
      return hasExactEnumerableDataKeys(candidate, notFoundFactsKeys)
        ? Object.freeze({ lookupOutcome: 'not_found' as const })
        : undefined;
    }
    if (lookupOutcome === 'unavailable') {
      const uncertainty = ownDataValue(candidate, 'uncertainty');
      return hasExactEnumerableDataKeys(candidate, unavailableFactsKeys) &&
        (uncertainty === 'provider' ||
          uncertainty === 'network' ||
          uncertainty === 'parser' ||
          uncertainty === 'device')
        ? Object.freeze({ lookupOutcome: 'unavailable' as const, uncertainty })
        : undefined;
    }
    return lookupOutcome === 'found' ? decodeFoundFacts(candidate) : undefined;
  } catch {
    return undefined;
  }
}

export function decodeTelebirrRelayObservationBody(
  candidate: unknown,
): TelebirrRelayObservationBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, observationBodyKeys) ||
      !hasRelayHeader(candidate)
    ) {
      return undefined;
    }

    const requestId = parseOpaqueId(ownDataValue(candidate, 'requestId'));
    const jobId = parseOpaqueId(ownDataValue(candidate, 'jobId'));
    const attemptNumber = parseAttemptNumber(ownDataValue(candidate, 'attemptNumber'));
    const leaseId = parseOpaqueId(ownDataValue(candidate, 'leaseId'));
    const deviceId = parseOpaqueId(ownDataValue(candidate, 'deviceId'));
    const keyId = parseOpaqueId(ownDataValue(candidate, 'keyId'));
    const leaseNonceDigest = parseSha256Digest(ownDataValue(candidate, 'leaseNonceDigest'));
    const challengeId = parseOpaqueId(ownDataValue(candidate, 'challengeId'));
    const challengeDigest = parseSha256Digest(ownDataValue(candidate, 'challengeDigest'));
    const referenceFingerprint = parseReferenceFingerprint(
      ownDataValue(candidate, 'referenceFingerprint'),
    );
    const receiverProfileId = parseOpaqueId(ownDataValue(candidate, 'receiverProfileId'));
    const receiverProfileDigest = parseSha256Digest(
      ownDataValue(candidate, 'receiverProfileDigest'),
    );
    const sourceDocumentDigest = parseSha256Digest(ownDataValue(candidate, 'sourceDocumentDigest'));
    const normalizedFactsDigest = parseSha256Digest(
      ownDataValue(candidate, 'normalizedFactsDigest'),
    );
    const observedAt = parseTimestamp(ownDataValue(candidate, 'observedAt'));
    const facts = decodeTelebirrRelayReceiptFacts(ownDataValue(candidate, 'facts'));
    if (
      !requestId ||
      !jobId ||
      !attemptNumber ||
      !leaseId ||
      !deviceId ||
      !keyId ||
      !leaseNonceDigest ||
      !challengeId ||
      !challengeDigest ||
      !referenceFingerprint ||
      ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      !receiverProfileId ||
      !receiverProfileDigest ||
      ownDataValue(candidate, 'adapterVersion') !== TELEBIRR_SIGNED_RELAY_ADAPTER_VERSION ||
      ownDataValue(candidate, 'parserVersion') !== TELEBIRR_SIGNED_RELAY_PARSER_VERSION ||
      ownDataValue(candidate, 'normalizerVersion') !== TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION ||
      !sourceDocumentDigest ||
      !normalizedFactsDigest ||
      !observedAt ||
      !facts
    ) {
      return undefined;
    }

    return Object.freeze({
      contractVersion: TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION,
      providerCode: 'telebirr' as const,
      protocolMode: TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE,
      requestId,
      jobId,
      attemptNumber,
      leaseId,
      deviceId,
      keyId,
      leaseNonceDigest,
      challengeId,
      challengeDigest,
      referenceFingerprint,
      sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
      receiverProfileId,
      receiverProfileDigest,
      adapterVersion: TELEBIRR_SIGNED_RELAY_ADAPTER_VERSION,
      parserVersion: TELEBIRR_SIGNED_RELAY_PARSER_VERSION,
      normalizerVersion: TELEBIRR_SIGNED_RELAY_NORMALIZER_VERSION,
      sourceDocumentDigest,
      normalizedFactsDigest,
      observedAt,
      facts,
    });
  } catch {
    return undefined;
  }
}

export function decodeTelebirrRelaySignedObservationEnvelope(
  candidate: unknown,
): TelebirrRelaySignedObservationEnvelope | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, signedEnvelopeKeys) ||
      !hasRelayHeader(candidate)
    ) {
      return undefined;
    }
    const bodyDigest = parseSha256Digest(ownDataValue(candidate, 'bodyDigest'));
    const body = decodeTelebirrRelayObservationBody(ownDataValue(candidate, 'body'));
    const signature = ownDataValue(candidate, 'signature');
    if (
      ownDataValue(candidate, 'transcriptVersion') !== TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !==
        TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM ||
      !bodyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !== TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !== TELEBIRR_SIGNED_RELAY_SIGNATURE_ENCODING ||
      !body ||
      typeof signature !== 'string' ||
      !P1363_BASE64URL_PATTERN.test(signature) ||
      Buffer.from(signature, 'base64url').length !== 64 ||
      Buffer.from(signature, 'base64url').toString('base64url') !== signature
    ) {
      return undefined;
    }

    return Object.freeze({
      contractVersion: TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION,
      providerCode: 'telebirr' as const,
      protocolMode: TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE,
      transcriptVersion: TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM,
      signatureEncoding: TELEBIRR_SIGNED_RELAY_SIGNATURE_ENCODING,
      body,
      signature,
    });
  } catch {
    return undefined;
  }
}

function scalarText(value: CanonicalScalar): string {
  if (value === null) return 'null:';
  if (typeof value === 'string') return `string:${value}`;
  if (typeof value === 'number') return `number:${String(value)}`;
  return `boolean:${value ? 'true' : 'false'}`;
}

/** Encodes fixed fields as domain-separated, unsigned 32-bit big-endian length-prefixed UTF-8. */
function encodeCanonicalFields(domain: string, fields: readonly CanonicalField[]): Buffer {
  const values: string[] = [domain, String(fields.length)];
  for (const [name, value] of fields) values.push(name, scalarText(value));
  const chunks: Buffer[] = [];
  for (const value of values) {
    const encoded = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.length);
    chunks.push(length, encoded);
  }
  return Buffer.concat(chunks);
}

function factsFields(facts: TelebirrRelayReceiptFacts): readonly CanonicalField[] {
  if (facts.lookupOutcome === 'not_found') {
    return [['facts.lookupOutcome', facts.lookupOutcome]];
  }
  if (facts.lookupOutcome === 'unavailable') {
    return [
      ['facts.lookupOutcome', facts.lookupOutcome],
      ['facts.uncertainty', facts.uncertainty],
    ];
  }
  return [
    ['facts.lookupOutcome', facts.lookupOutcome],
    ['facts.evidenceSource', facts.evidenceSource],
    ['facts.providerIdentity', facts.providerIdentity],
    ['facts.providerFinalStatus', facts.providerFinalStatus],
    ['facts.canonicalReferencePresent', facts.canonicalReferencePresent],
    ['facts.referenceMatch', facts.referenceMatch],
    ['facts.amountMinor', facts.amountMinor],
    ['facts.currencyCode', facts.currencyCode],
    ['facts.receiverMatch', facts.receiverMatch],
    ['facts.maskedReceiverDiagnostic', facts.maskedReceiverDiagnostic],
    ['facts.paymentMode', facts.paymentMode],
    ['facts.paymentReason', facts.paymentReason],
    ['facts.paymentChannel', facts.paymentChannel],
    ['facts.occurredAt', facts.occurredAt],
    ['facts.retrievedAt', facts.retrievedAt],
  ];
}

function observationBodyFields(body: TelebirrRelayObservationBody): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['providerCode', body.providerCode],
    ['protocolMode', body.protocolMode],
    ['requestId', body.requestId],
    ['jobId', body.jobId],
    ['attemptNumber', body.attemptNumber],
    ['leaseId', body.leaseId],
    ['deviceId', body.deviceId],
    ['keyId', body.keyId],
    ['leaseNonceDigest', body.leaseNonceDigest],
    ['challengeId', body.challengeId],
    ['challengeDigest', body.challengeDigest],
    ['referenceFingerprint', body.referenceFingerprint],
    ['sourceProfile', body.sourceProfile],
    ['receiverProfileId', body.receiverProfileId],
    ['receiverProfileDigest', body.receiverProfileDigest],
    ['adapterVersion', body.adapterVersion],
    ['parserVersion', body.parserVersion],
    ['normalizerVersion', body.normalizerVersion],
    ['sourceDocumentDigest', body.sourceDocumentDigest],
    ['normalizedFactsDigest', body.normalizedFactsDigest],
    ['observedAt', body.observedAt],
    ...factsFields(body.facts),
  ];
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function canonicalTelebirrRelayReceiptFactsBytes(
  factsCandidate: unknown,
): Buffer | undefined {
  const facts = decodeTelebirrRelayReceiptFacts(factsCandidate);
  return facts
    ? encodeCanonicalFields('fetanagent:telebirr:relay:facts:v1', factsFields(facts))
    : undefined;
}

export function digestTelebirrRelayReceiptFacts(factsCandidate: unknown): string | undefined {
  const bytes = canonicalTelebirrRelayReceiptFactsBytes(factsCandidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalTelebirrRelayObservationBodyBytes(
  bodyCandidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrRelayObservationBody(bodyCandidate);
  return body
    ? encodeCanonicalFields(
        'fetanagent:telebirr:relay:observation-body:v1',
        observationBodyFields(body),
      )
    : undefined;
}

export function digestTelebirrRelayObservationBody(bodyCandidate: unknown): string | undefined {
  const bytes = canonicalTelebirrRelayObservationBodyBytes(bodyCandidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalTelebirrRelaySignatureTranscriptBytes(
  bodyCandidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrRelayObservationBody(bodyCandidate);
  if (!body) return undefined;
  const bodyDigest = digestTelebirrRelayObservationBody(body);
  if (!bodyDigest) return undefined;
  return encodeCanonicalFields('fetanagent:telebirr:relay:signature-transcript:v1', [
    ['contractVersion', TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION],
    ['providerCode', 'telebirr'],
    ['protocolMode', TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE],
    ['transcriptVersion', TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION],
    ['bodyDigestAlgorithm', TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM],
    ['bodyDigest', bodyDigest],
    ['signatureAlgorithm', TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM],
    ['signatureEncoding', TELEBIRR_SIGNED_RELAY_SIGNATURE_ENCODING],
  ]);
}

/** Replay identity commits to the canonical envelope metadata and body digest, never signature bytes. */
export function deriveTelebirrRelayReplayIdentity(envelopeCandidate: unknown): string | undefined {
  const envelope = decodeTelebirrRelaySignedObservationEnvelope(envelopeCandidate);
  if (!envelope) return undefined;
  const computedBodyDigest = digestTelebirrRelayObservationBody(envelope.body);
  if (!computedBodyDigest || computedBodyDigest !== envelope.bodyDigest) return undefined;
  return sha256(
    encodeCanonicalFields('fetanagent:telebirr:relay:replay-identity:v1', [
      ['contractVersion', envelope.contractVersion],
      ['providerCode', envelope.providerCode],
      ['protocolMode', envelope.protocolMode],
      ['transcriptVersion', envelope.transcriptVersion],
      ['bodyDigestAlgorithm', envelope.bodyDigestAlgorithm],
      ['bodyDigest', envelope.bodyDigest],
      ['signatureAlgorithm', envelope.signatureAlgorithm],
      ['signatureEncoding', envelope.signatureEncoding],
    ]),
  );
}

interface ParsedVerificationInput {
  readonly assessedAt: string;
  readonly enrollment: TelebirrRelayEnrollmentEnvelope;
  readonly request: TelebirrRelayRequestEnvelope;
  readonly lease: TelebirrRelayLeaseEnvelope;
  readonly signedObservation: TelebirrRelaySignedObservationEnvelope;
  readonly serverComputedReplayIdentities: readonly string[];
}

function parseReplayIdentities(candidate: unknown): readonly string[] | undefined {
  if (
    !isNonProxyArray(candidate) ||
    candidate.length > MAX_REPLAY_IDENTITIES ||
    Reflect.ownKeys(candidate).some(
      (key) => typeof key !== 'string' || (key !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    return undefined;
  }
  const identities: string[] = [];
  for (let index = 0; index < candidate.length; index += 1) {
    if (!Object.hasOwn(candidate, index)) return undefined;
    const identity = parseSha256Digest(candidate[index]);
    if (!identity || identities.includes(identity)) return undefined;
    identities.push(identity);
  }
  return Object.freeze(identities);
}

function parseVerificationInput(candidate: unknown): ParsedVerificationInput | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, verificationInputKeys) ||
    !hasRelayHeader(candidate)
  ) {
    return undefined;
  }
  const assessedAt = parseTimestamp(ownDataValue(candidate, 'assessedAt'));
  const enrollment = decodeTelebirrRelayEnrollmentEnvelope(ownDataValue(candidate, 'enrollment'));
  const request = decodeTelebirrRelayRequestEnvelope(ownDataValue(candidate, 'request'));
  const lease = decodeTelebirrRelayLeaseEnvelope(ownDataValue(candidate, 'lease'));
  const signedObservation = decodeTelebirrRelaySignedObservationEnvelope(
    ownDataValue(candidate, 'signedObservation'),
  );
  const serverComputedReplayIdentities = parseReplayIdentities(
    ownDataValue(candidate, 'serverComputedReplayIdentities'),
  );
  return assessedAt &&
    enrollment &&
    request &&
    lease &&
    signedObservation &&
    serverComputedReplayIdentities
    ? Object.freeze({
        assessedAt,
        enrollment,
        request,
        lease,
        signedObservation,
        serverComputedReplayIdentities,
      })
    : undefined;
}

function parseP256PublicKey(
  candidate: unknown,
): { readonly key: KeyObject; readonly der: Buffer } | undefined {
  try {
    if (!(candidate instanceof Uint8Array) || isProxy(candidate)) return undefined;
    const der = Buffer.from(candidate);
    if (der.length < 1 || der.length > MAX_SPKI_BYTES) return undefined;
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    const details = key.asymmetricKeyDetails;
    const canonical = key.export({ format: 'der', type: 'spki' });
    if (
      key.type !== 'public' ||
      key.asymmetricKeyType !== 'ec' ||
      details?.namedCurve !== 'prime256v1' ||
      !Buffer.isBuffer(canonical) ||
      !canonical.equals(der)
    ) {
      return undefined;
    }
    return Object.freeze({ key, der });
  } catch {
    return undefined;
  }
}

function allBindingsMatch(
  enrollment: TelebirrRelayEnrollmentEnvelope,
  request: TelebirrRelayRequestEnvelope,
  lease: TelebirrRelayLeaseEnvelope,
  body: TelebirrRelayObservationBody,
): boolean {
  return (
    enrollment.deviceId === lease.deviceId &&
    enrollment.deviceId === body.deviceId &&
    enrollment.keyId === lease.keyId &&
    enrollment.keyId === body.keyId &&
    request.requestId === lease.requestId &&
    request.requestId === body.requestId &&
    request.jobId === lease.jobId &&
    request.jobId === body.jobId &&
    request.attemptNumber === lease.attemptNumber &&
    request.attemptNumber === body.attemptNumber &&
    lease.leaseId === body.leaseId &&
    lease.leaseNonceDigest === body.leaseNonceDigest &&
    lease.challengeId === body.challengeId &&
    lease.challengeDigest === body.challengeDigest &&
    request.referenceFingerprint === lease.referenceFingerprint &&
    request.referenceFingerprint === body.referenceFingerprint
  );
}

/**
 * Verifies only a synthetic signed relay envelope. The public SPKI is injected separately and the
 * server supplies already-computed replay identities. This function has no transport, provider,
 * database, persistence, claim, settlement, enqueue, execution, or financial capability.
 */
export function verifySyntheticTelebirrSignedRelayObservation(
  inputCandidate: unknown,
  enrolledPublicKeySpkiDerCandidate: unknown,
): TelebirrSignedRelayVerificationResult {
  try {
    const input = parseVerificationInput(inputCandidate);
    if (!input) return invalidResult;

    const { enrollment, request, lease, signedObservation } = input;
    const body = signedObservation.body;
    if (enrollment.state === 'revoked') return result('would_review', 'device_revoked');

    const assessedAtMs = Date.parse(input.assessedAt);
    const validFromMs = Date.parse(enrollment.validFrom);
    const validUntilMs = Date.parse(enrollment.validUntil);
    const requestedAtMs = Date.parse(request.requestedAt);
    const issuedAtMs = Date.parse(lease.issuedAt);
    const expiresAtMs = Date.parse(lease.expiresAt);
    const observedAtMs = Date.parse(body.observedAt);
    if (
      assessedAtMs < validFromMs ||
      assessedAtMs >= validUntilMs ||
      requestedAtMs < validFromMs ||
      requestedAtMs >= validUntilMs ||
      issuedAtMs < validFromMs ||
      issuedAtMs >= validUntilMs ||
      observedAtMs < validFromMs ||
      observedAtMs >= validUntilMs
    ) {
      return result('would_review', 'enrollment_expired');
    }
    if (requestedAtMs > issuedAtMs || assessedAtMs < issuedAtMs || assessedAtMs >= expiresAtMs) {
      return result('would_review', 'lease_expired');
    }
    if (
      observedAtMs < issuedAtMs ||
      observedAtMs >= expiresAtMs ||
      observedAtMs > assessedAtMs + FUTURE_OBSERVATION_TOLERANCE_MS
    ) {
      return result('would_review', 'observation_time_invalid');
    }

    if (!allBindingsMatch(enrollment, request, lease, body)) {
      return result('would_review', 'binding_mismatch');
    }
    if (
      enrollment.sourceProfile !== request.sourceProfile ||
      enrollment.sourceProfile !== lease.sourceProfile ||
      enrollment.sourceProfile !== body.sourceProfile
    ) {
      return result('would_review', 'source_profile_mismatch');
    }
    if (
      enrollment.receiverProfileId !== request.receiverProfileId ||
      enrollment.receiverProfileId !== lease.receiverProfileId ||
      enrollment.receiverProfileId !== body.receiverProfileId ||
      enrollment.receiverProfileDigest !== request.receiverProfileDigest ||
      enrollment.receiverProfileDigest !== lease.receiverProfileDigest ||
      enrollment.receiverProfileDigest !== body.receiverProfileDigest
    ) {
      return result('would_review', 'receiver_profile_mismatch');
    }
    if (
      enrollment.parserVersion !== request.parserVersion ||
      enrollment.parserVersion !== lease.parserVersion ||
      enrollment.parserVersion !== body.parserVersion
    ) {
      return result('would_review', 'parser_version_mismatch');
    }
    if (
      enrollment.normalizerVersion !== request.normalizerVersion ||
      enrollment.normalizerVersion !== lease.normalizerVersion ||
      enrollment.normalizerVersion !== body.normalizerVersion
    ) {
      return result('would_review', 'normalizer_version_mismatch');
    }
    if (body.adapterVersion !== TELEBIRR_SIGNED_RELAY_ADAPTER_VERSION) {
      return result('would_review', 'adapter_version_mismatch');
    }

    const factsDigest = digestTelebirrRelayReceiptFacts(body.facts);
    if (!factsDigest || factsDigest !== body.normalizedFactsDigest) {
      return result('would_review', 'facts_digest_mismatch');
    }
    const computedBodyDigest = digestTelebirrRelayObservationBody(body);
    if (!computedBodyDigest || computedBodyDigest !== signedObservation.bodyDigest) {
      return result('would_review', 'body_digest_mismatch');
    }

    const replayIdentity = deriveTelebirrRelayReplayIdentity(signedObservation);
    if (!replayIdentity) return invalidResult;

    const publicKey = parseP256PublicKey(enrolledPublicKeySpkiDerCandidate);
    if (!publicKey) {
      return result('would_review', 'public_key_invalid', computedBodyDigest, replayIdentity);
    }
    if (sha256(publicKey.der) !== enrollment.publicKeySpkiSha256) {
      return result('would_review', 'key_fingerprint_mismatch', computedBodyDigest, replayIdentity);
    }

    const transcript = canonicalTelebirrRelaySignatureTranscriptBytes(body);
    if (!transcript) return invalidResult;
    const signature = Buffer.from(signedObservation.signature, 'base64url');
    const signatureValid = verifySignature(
      'sha256',
      transcript,
      { key: publicKey.key, dsaEncoding: 'ieee-p1363' },
      signature,
    );
    if (!signatureValid) {
      return result('would_review', 'signature_invalid', computedBodyDigest, replayIdentity);
    }
    if (input.serverComputedReplayIdentities.includes(replayIdentity)) {
      return result('would_review', 'replay_detected', computedBodyDigest, replayIdentity);
    }

    return result(
      'would_forward_signed_observation',
      'signed_observation_verified',
      computedBodyDigest,
      replayIdentity,
    );
  } catch {
    return invalidResult;
  }
}

function hasDisabledCapabilities(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'transportAllowed') === false &&
    ownDataValue(candidate, 'networkAllowed') === false &&
    ownDataValue(candidate, 'providerInteractionAllowed') === false &&
    ownDataValue(candidate, 'databaseWriteAllowed') === false &&
    ownDataValue(candidate, 'persistenceAllowed') === false &&
    ownDataValue(candidate, 'claimAllowed') === false &&
    ownDataValue(candidate, 'settlementAllowed') === false &&
    ownDataValue(candidate, 'enqueueAllowed') === false &&
    ownDataValue(candidate, 'executionAllowed') === false &&
    ownDataValue(candidate, 'financialActionAllowed') === false
  );
}

const verificationResultKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'sourceProfile',
  'transcriptVersion',
  'bodyDigestAlgorithm',
  'signatureAlgorithm',
  'advisoryOnly',
  'transportAllowed',
  'networkAllowed',
  'providerInteractionAllowed',
  'databaseWriteAllowed',
  'persistenceAllowed',
  'claimAllowed',
  'settlementAllowed',
  'enqueueAllowed',
  'executionAllowed',
  'financialActionAllowed',
  'disposition',
  'reasonCode',
  'verifiedBodyDigest',
  'replayIdentity',
] as const;

function isReasonCode(candidate: unknown): candidate is TelebirrSignedRelayReason {
  return (
    candidate === 'invalid_request' ||
    candidate === 'device_revoked' ||
    candidate === 'enrollment_expired' ||
    candidate === 'lease_expired' ||
    candidate === 'observation_time_invalid' ||
    candidate === 'binding_mismatch' ||
    candidate === 'source_profile_mismatch' ||
    candidate === 'receiver_profile_mismatch' ||
    candidate === 'parser_version_mismatch' ||
    candidate === 'normalizer_version_mismatch' ||
    candidate === 'adapter_version_mismatch' ||
    candidate === 'facts_digest_mismatch' ||
    candidate === 'body_digest_mismatch' ||
    candidate === 'public_key_invalid' ||
    candidate === 'key_fingerprint_mismatch' ||
    candidate === 'signature_invalid' ||
    candidate === 'replay_detected' ||
    candidate === 'signed_observation_verified'
  );
}

const reviewReasonsWithComputedDigests = Object.freeze([
  'public_key_invalid',
  'key_fingerprint_mismatch',
  'signature_invalid',
  'replay_detected',
] as const);

function hasExactResultVariant(
  disposition: unknown,
  reasonCode: unknown,
  verifiedBodyDigest: unknown,
  replayIdentity: unknown,
): boolean {
  const hasNoDigests = verifiedBodyDigest === null && replayIdentity === null;
  const hasBothDigests =
    parseSha256Digest(verifiedBodyDigest) !== undefined &&
    parseSha256Digest(replayIdentity) !== undefined;

  if (disposition === 'invalid_request') {
    return reasonCode === 'invalid_request' && hasNoDigests;
  }
  if (disposition === 'would_forward_signed_observation') {
    return reasonCode === 'signed_observation_verified' && hasBothDigests;
  }
  if (
    disposition !== 'would_review' ||
    !isReasonCode(reasonCode) ||
    reasonCode === 'invalid_request' ||
    reasonCode === 'signed_observation_verified'
  ) {
    return false;
  }

  return reviewReasonsWithComputedDigests.includes(
    reasonCode as (typeof reviewReasonsWithComputedDigests)[number],
  )
    ? hasBothDigests
    : hasNoDigests;
}

const redactedInvalidResult: RedactedTelebirrSignedRelayVerificationLogProjection = Object.freeze({
  ...resultBase,
  disposition: 'invalid_request' as const,
  reasonCode: 'invalid_request' as const,
});

/** Revalidates a verification result and drops every identifier, digest, signature, and fact. */
export function redactedTelebirrSignedRelayVerificationForLog(
  candidate: unknown,
): RedactedTelebirrSignedRelayVerificationLogProjection {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, verificationResultKeys) ||
      ownDataValue(candidate, 'contractVersion') !== TELEBIRR_SIGNED_RELAY_CONTRACT_VERSION ||
      ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
      ownDataValue(candidate, 'protocolMode') !== TELEBIRR_SIGNED_RELAY_PROTOCOL_MODE ||
      ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      ownDataValue(candidate, 'transcriptVersion') !== TELEBIRR_SIGNED_RELAY_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !==
        TELEBIRR_SIGNED_RELAY_BODY_DIGEST_ALGORITHM ||
      ownDataValue(candidate, 'signatureAlgorithm') !== TELEBIRR_SIGNED_RELAY_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'advisoryOnly') !== true ||
      !hasDisabledCapabilities(candidate)
    ) {
      return redactedInvalidResult;
    }
    const disposition = ownDataValue(candidate, 'disposition');
    const reasonCode = ownDataValue(candidate, 'reasonCode');
    const verifiedBodyDigest = ownDataValue(candidate, 'verifiedBodyDigest');
    const replayIdentity = ownDataValue(candidate, 'replayIdentity');
    if (!hasExactResultVariant(disposition, reasonCode, verifiedBodyDigest, replayIdentity)) {
      return redactedInvalidResult;
    }
    return Object.freeze({
      ...resultBase,
      disposition: disposition as TelebirrSignedRelayVerificationResult['disposition'],
      reasonCode: reasonCode as TelebirrSignedRelayReason,
    });
  } catch {
    return redactedInvalidResult;
  }
}
