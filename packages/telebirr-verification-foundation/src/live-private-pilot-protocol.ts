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
  utf8ByteLengthWithin,
  type UnknownRecord,
} from './exact-data-record.js';
import { TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE } from './synthetic-official-receipt.js';

/**
 * A jointly versioned, evidence-only protocol for the bounded private pilot. It is deliberately
 * separate from `synthetic_shadow`; nothing in this module supplies transport, persistence, claim,
 * settlement, enqueue, execution, or financial authority.
 */
export const TELEBIRR_LIVE_PILOT_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_LIVE_PILOT_PROTOCOL_MODE = 'live_private_pilot_v1' as const;
export const TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION =
  'telebirr-live-private-pilot-assignment-transcript-v1' as const;
export const TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION =
  'telebirr-live-private-pilot-observation-transcript-v1' as const;
export const TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256' as const;
export const TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING = 'ieee-p1363-base64url' as const;
export const TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM = 'sha256' as const;
export const TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE =
  'telebirr-provider-reference-binding-v1' as const;
export const TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION =
  'telebirr-credited-party-name-normalizer-v1' as const;
export const TELEBIRR_LIVE_PILOT_ADAPTER_VERSION =
  'telebirr-live-private-pilot-adapter-v1' as const;
export const TELEBIRR_LIVE_PILOT_PARSER_VERSION =
  'telebirr-official-receipt-live-pilot-parser-v1' as const;
export const TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION =
  'telebirr-live-private-pilot-facts-normalizer-v1' as const;

const FUTURE_OBSERVATION_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_REPLAY_IDENTITIES = 4_096;
const MAX_SPKI_BYTES = 512;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REFERENCE_FINGERPRINT_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;
const RAW_REFERENCE_PATTERN = /^[A-Z0-9]{8,64}$/u;
const P1363_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const FORBIDDEN_NAME_CODE_UNIT_PATTERN = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u;
const ASCII_WHITESPACE_PATTERN = /[\u0009-\u000d\u0020]+/gu;

const signerKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'signerKeyId',
  'publicKeySpkiSha256',
  'signatureAlgorithm',
  'state',
  'validFrom',
  'validUntil',
] as const;
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
  'validFrom',
  'validUntil',
  'pilotRevisionId',
  'receiverRevisionId',
  'receiverProfileId',
  'receiverProfileDigest',
  'receiverConfigurationDigest',
] as const;
const trustedRequestBindingKeys = [
  'assignmentId',
  'requestId',
  'jobId',
  'attemptNumber',
  'pilotRevisionId',
  'deviceId',
  'keyId',
  'referenceFingerprint',
  'receiverRevisionId',
  'receiverProfileId',
  'receiverProfileDigest',
  'receiverConfigurationDigest',
  'expectedReceiverNameDigest',
] as const;
const assignmentBodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'assignmentId',
  'requestId',
  'jobId',
  'attemptNumber',
  'pilotRevisionId',
  'deviceId',
  'keyId',
  'leaseNonceDigest',
  'challengeId',
  'challengeDigest',
  'rawReference',
  'referenceFingerprint',
  'referenceBindingProfile',
  'referenceBindingDigest',
  'sourceProfile',
  'receiverRevisionId',
  'receiverProfileId',
  'receiverProfileDigest',
  'receiverConfigurationDigest',
  'receiverNameNormalizerVersion',
  'expectedReceiverNameNormalized',
  'expectedReceiverNameDigest',
  'adapterVersion',
  'parserVersion',
  'factsNormalizerVersion',
  'issuedAt',
  'expiresAt',
] as const;
const signedAssignmentKeys = [
  'contractVersion',
  'providerCode',
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
const foundFactsKeys = [
  'lookupOutcome',
  'evidenceSource',
  'layoutAttestation',
  'providerFinalStatus',
  'canonicalReferencePresent',
  'referenceMatch',
  'amountMinor',
  'currencyCode',
  'receiverMatch',
  'creditedPartyNameDigest',
  'paymentMode',
  'paymentReason',
  'paymentChannel',
  'occurredAt',
  'retrievedAt',
] as const;
const reviewFactsKeys = ['lookupOutcome', 'reviewReason', 'retrievedAt'] as const;
const observationBodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'assignmentId',
  'requestId',
  'jobId',
  'attemptNumber',
  'pilotRevisionId',
  'deviceId',
  'keyId',
  'leaseNonceDigest',
  'challengeId',
  'challengeDigest',
  'assignmentBodyDigest',
  'referenceFingerprint',
  'referenceBindingDigest',
  'sourceProfile',
  'receiverRevisionId',
  'receiverProfileId',
  'receiverProfileDigest',
  'receiverConfigurationDigest',
  'receiverNameNormalizerVersion',
  'expectedReceiverNameDigest',
  'adapterVersion',
  'parserVersion',
  'factsNormalizerVersion',
  'sourceDocumentDigest',
  'normalizedFactsDigest',
  'observedAt',
  'facts',
] as const;
const signedObservationKeys = [
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
  'trustedAssignmentSigner',
  'trustedRequestBinding',
  'deviceEnrollment',
  'signedAssignment',
  'signedObservation',
  'serverComputedReplayIdentities',
] as const;

export interface TelebirrLivePilotTrustedAssignmentSigner {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly signerKeyId: string;
  readonly publicKeySpkiSha256: string;
  readonly signatureAlgorithm: typeof TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM;
  readonly state: 'active' | 'revoked';
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface TelebirrLivePilotDeviceEnrollment {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly enrollmentId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly publicKeySpkiSha256: string;
  readonly signatureAlgorithm: typeof TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM;
  readonly state: 'active' | 'revoked';
  readonly validFrom: string;
  readonly validUntil: string;
  readonly pilotRevisionId: string;
  readonly receiverRevisionId: string;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly receiverConfigurationDigest: string;
}

/** Trusted values loaded independently from the server job/receiver revision, never from Android. */
export interface TelebirrLivePilotTrustedRequestBinding {
  readonly assignmentId: string;
  readonly requestId: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly pilotRevisionId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly referenceFingerprint: string;
  readonly receiverRevisionId: string;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly receiverConfigurationDigest: string;
  readonly expectedReceiverNameDigest: string;
}

export interface TelebirrLivePilotAssignmentBody {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly assignmentId: string;
  readonly requestId: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly pilotRevisionId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly leaseNonceDigest: string;
  readonly challengeId: string;
  readonly challengeDigest: string;
  /** Sensitive. Delivered only inside the authenticated assignment and never copied to logs. */
  readonly rawReference: string;
  /** Server-produced provider-domain fingerprint already attached to the proof request. */
  readonly referenceFingerprint: string;
  readonly referenceBindingProfile: typeof TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE;
  /** Commits the authenticated raw reference to the protected server fingerprint. */
  readonly referenceBindingDigest: string;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly receiverRevisionId: string;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly receiverConfigurationDigest: string;
  readonly receiverNameNormalizerVersion: typeof TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION;
  /** Sensitive. Exact normalized credited-party full name; never copied into the observation. */
  readonly expectedReceiverNameNormalized: string;
  readonly expectedReceiverNameDigest: string;
  readonly adapterVersion: typeof TELEBIRR_LIVE_PILOT_ADAPTER_VERSION;
  readonly parserVersion: typeof TELEBIRR_LIVE_PILOT_PARSER_VERSION;
  readonly factsNormalizerVersion: typeof TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface TelebirrLivePilotSignedAssignment {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly transcriptVersion: typeof TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: TelebirrLivePilotAssignmentBody;
  readonly signature: string;
}

export type TelebirrLivePilotReviewReason =
  | 'provider_not_found_unattested'
  | 'provider_unavailable'
  | 'network_unavailable'
  | 'unknown_layout'
  | 'invalid_layout'
  | 'parser_uncertain'
  | 'device_error';

export interface TelebirrLivePilotFoundFacts {
  readonly lookupOutcome: 'found';
  readonly evidenceSource: 'provider_receipt_lookup';
  readonly layoutAttestation: 'recognized_layout_v1';
  readonly providerFinalStatus: 'completed' | 'pending' | 'failed' | 'reversed' | 'unknown';
  readonly canonicalReferencePresent: boolean;
  readonly referenceMatch: 'matched' | 'mismatched' | 'unknown';
  readonly amountMinor: number | null;
  readonly currencyCode: 'ETB' | 'unknown';
  readonly receiverMatch: 'matched' | 'mismatched' | 'unknown';
  readonly creditedPartyNameDigest: string | null;
  readonly paymentMode: 'telebirr' | 'other' | 'unknown';
  readonly paymentReason: 'send_money_to_registered_customer' | 'other' | 'unknown';
  readonly paymentChannel: 'api_app' | 'other' | 'unknown';
  readonly occurredAt: string | null;
  readonly retrievedAt: string;
}

export type TelebirrLivePilotReceiptFacts =
  | TelebirrLivePilotFoundFacts
  | {
      readonly lookupOutcome: 'review_required';
      readonly reviewReason: TelebirrLivePilotReviewReason;
      readonly retrievedAt: string | null;
    };

export interface TelebirrLivePilotObservationBody {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly assignmentId: string;
  readonly requestId: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly pilotRevisionId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly leaseNonceDigest: string;
  readonly challengeId: string;
  readonly challengeDigest: string;
  readonly assignmentBodyDigest: string;
  readonly referenceFingerprint: string;
  readonly referenceBindingDigest: string;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly receiverRevisionId: string;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly receiverConfigurationDigest: string;
  readonly receiverNameNormalizerVersion: typeof TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION;
  readonly expectedReceiverNameDigest: string;
  readonly adapterVersion: typeof TELEBIRR_LIVE_PILOT_ADAPTER_VERSION;
  readonly parserVersion: typeof TELEBIRR_LIVE_PILOT_PARSER_VERSION;
  readonly factsNormalizerVersion: typeof TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION;
  readonly sourceDocumentDigest: string;
  readonly normalizedFactsDigest: string;
  readonly observedAt: string;
  readonly facts: TelebirrLivePilotReceiptFacts;
}

export interface TelebirrLivePilotSignedObservation {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly transcriptVersion: typeof TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING;
  readonly body: TelebirrLivePilotObservationBody;
  readonly signature: string;
}

export interface TelebirrLivePilotVerificationInput {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly assessedAt: string;
  readonly trustedAssignmentSigner: TelebirrLivePilotTrustedAssignmentSigner;
  readonly trustedRequestBinding: TelebirrLivePilotTrustedRequestBinding;
  readonly deviceEnrollment: TelebirrLivePilotDeviceEnrollment;
  readonly signedAssignment: TelebirrLivePilotSignedAssignment;
  readonly signedObservation: TelebirrLivePilotSignedObservation;
  readonly serverComputedReplayIdentities: readonly string[];
}

interface DisabledCapabilities {
  readonly transportAllowed: false;
  readonly networkAllowed: false;
  readonly providerInteractionAllowed: false;
  readonly databaseReadAllowed: false;
  readonly databaseWriteAllowed: false;
  readonly persistenceAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
}

export type TelebirrLivePilotVerificationReason =
  | 'invalid_request'
  | 'assignment_signer_revoked'
  | 'assignment_signer_expired'
  | 'assignment_signer_key_invalid'
  | 'assignment_signer_key_mismatch'
  | 'assignment_signature_invalid'
  | 'device_revoked'
  | 'device_enrollment_expired'
  | 'device_key_invalid'
  | 'device_key_mismatch'
  | 'device_signature_invalid'
  | 'assignment_expired'
  | 'observation_time_invalid'
  | 'binding_mismatch'
  | 'reference_binding_mismatch'
  | 'receiver_binding_mismatch'
  | 'source_profile_mismatch'
  | 'version_mismatch'
  | 'facts_digest_mismatch'
  | 'assignment_body_digest_mismatch'
  | 'observation_body_digest_mismatch'
  | 'replay_detected'
  | 'receipt_requires_review'
  | 'reference_mismatch'
  | 'receiver_mismatch'
  | 'provider_status_not_completed'
  | 'receipt_semantics_incomplete'
  | 'signed_evidence_verified';

export interface TelebirrLivePilotVerificationResult extends DisabledCapabilities {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly assignmentTranscriptVersion: typeof TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION;
  readonly observationTranscriptVersion: typeof TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION;
  readonly advisoryEvidenceOnly: true;
  readonly disposition: 'invalid_request' | 'would_review' | 'would_forward_signed_evidence';
  readonly reasonCode: TelebirrLivePilotVerificationReason;
  readonly replayIdentity: string | null;
}

type Scalar = string | number | boolean | null;
type Field = readonly [string, Scalar];

const disabledCapabilities: DisabledCapabilities = Object.freeze({
  transportAllowed: false,
  networkAllowed: false,
  providerInteractionAllowed: false,
  databaseReadAllowed: false,
  databaseWriteAllowed: false,
  persistenceAllowed: false,
  claimAllowed: false,
  settlementAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
});

const resultBase = Object.freeze({
  contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
  providerCode: 'telebirr' as const,
  protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
  assignmentTranscriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
  observationTranscriptVersion: TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
  advisoryEvidenceOnly: true as const,
  ...disabledCapabilities,
});

function result(
  disposition: TelebirrLivePilotVerificationResult['disposition'],
  reasonCode: TelebirrLivePilotVerificationReason,
  replayIdentity: string | null = null,
): TelebirrLivePilotVerificationResult {
  return Object.freeze({ ...resultBase, disposition, reasonCode, replayIdentity });
}

const invalidResult = result('invalid_request', 'invalid_request');

function header(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') === TELEBIRR_LIVE_PILOT_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'telebirr' &&
    ownDataValue(candidate, 'protocolMode') === TELEBIRR_LIVE_PILOT_PROTOCOL_MODE
  );
}

function opaque(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value) ? value : undefined;
}

function digest(value: unknown): string | undefined {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? value : undefined;
}

function fingerprint(value: unknown): string | undefined {
  return typeof value === 'string' && REFERENCE_FINGERPRINT_PATTERN.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  const parsed = parseCanonicalUtcTimestamp(value);
  return typeof parsed === 'string' ? parsed : undefined;
}

function attempt(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1_000_000
    ? (value as number)
    : undefined;
}

/**
 * Cross-runtime name normalization: NFC, ASCII-whitespace collapse/trim, and ASCII-only case fold.
 * Non-ASCII letters (including Ethiopic) are preserved byte-for-byte after NFC.
 */
export function normalizeTelebirrCreditedPartyFullName(value: unknown): string | undefined {
  try {
    if (typeof value !== 'string' || FORBIDDEN_NAME_CODE_UNIT_PATTERN.test(value)) return undefined;
    const normalized = value
      .normalize('NFC')
      .replace(ASCII_WHITESPACE_PATTERN, ' ')
      .trim()
      .replace(/[A-Z]/gu, (character) => character.toLowerCase());
    return normalized.length >= 2 &&
      normalized.length <= 160 &&
      utf8ByteLengthWithin(normalized, 320)
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

function scalarText(value: Scalar): string {
  if (value === null) return 'null:';
  if (typeof value === 'string') return `string:${value}`;
  if (typeof value === 'number') return `number:${String(value)}`;
  return `boolean:${value ? 'true' : 'false'}`;
}

function encodeFields(domain: string, fields: readonly Field[]): Buffer {
  const values: string[] = [domain, String(fields.length)];
  for (const [name, value] of fields) values.push(name, scalarText(value));
  const chunks: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function digestTelebirrLivePilotReceiverName(value: unknown): string | undefined {
  const normalized = normalizeTelebirrCreditedPartyFullName(value);
  return normalized
    ? sha256(
        encodeFields('fetanagent:telebirr:live-private-pilot:receiver-name:v1', [
          ['normalizerVersion', TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION],
          ['normalizedName', normalized],
        ]),
      )
    : undefined;
}

export function deriveTelebirrLivePilotReferenceBindingDigest(input: {
  readonly rawReference: string;
  readonly referenceFingerprint: string;
}): string | undefined {
  if (
    !RAW_REFERENCE_PATTERN.test(input.rawReference) ||
    !REFERENCE_FINGERPRINT_PATTERN.test(input.referenceFingerprint)
  ) {
    return undefined;
  }
  return sha256(
    encodeFields('fetanagent:telebirr:live-private-pilot:reference-binding:v1', [
      ['providerCode', 'telebirr'],
      ['sourceProfile', TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE],
      ['referenceBindingProfile', TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE],
      ['rawReference', input.rawReference],
      ['referenceFingerprint', input.referenceFingerprint],
    ]),
  );
}

export function decodeTelebirrLivePilotTrustedAssignmentSigner(
  candidate: unknown,
): TelebirrLivePilotTrustedAssignmentSigner | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, signerKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const signerKeyId = opaque(ownDataValue(candidate, 'signerKeyId'));
    const publicKeySpkiSha256 = digest(ownDataValue(candidate, 'publicKeySpkiSha256'));
    const state = ownDataValue(candidate, 'state');
    const validFrom = timestamp(ownDataValue(candidate, 'validFrom'));
    const validUntil = timestamp(ownDataValue(candidate, 'validUntil'));
    if (
      !signerKeyId ||
      !publicKeySpkiSha256 ||
      ownDataValue(candidate, 'signatureAlgorithm') !== TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM ||
      (state !== 'active' && state !== 'revoked') ||
      !validFrom ||
      !validUntil ||
      validFrom >= validUntil
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
      signerKeyId,
      publicKeySpkiSha256,
      signatureAlgorithm: TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM,
      state,
      validFrom,
      validUntil,
    });
  } catch {
    return undefined;
  }
}

export function decodeTelebirrLivePilotDeviceEnrollment(
  candidate: unknown,
): TelebirrLivePilotDeviceEnrollment | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, enrollmentKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const enrollmentId = opaque(ownDataValue(candidate, 'enrollmentId'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const publicKeySpkiSha256 = digest(ownDataValue(candidate, 'publicKeySpkiSha256'));
    const state = ownDataValue(candidate, 'state');
    const validFrom = timestamp(ownDataValue(candidate, 'validFrom'));
    const validUntil = timestamp(ownDataValue(candidate, 'validUntil'));
    const pilotRevisionId = opaque(ownDataValue(candidate, 'pilotRevisionId'));
    const receiverRevisionId = opaque(ownDataValue(candidate, 'receiverRevisionId'));
    const receiverProfileId = opaque(ownDataValue(candidate, 'receiverProfileId'));
    const receiverProfileDigest = digest(ownDataValue(candidate, 'receiverProfileDigest'));
    const receiverConfigurationDigest = digest(
      ownDataValue(candidate, 'receiverConfigurationDigest'),
    );
    if (
      !enrollmentId ||
      !deviceId ||
      !keyId ||
      !publicKeySpkiSha256 ||
      ownDataValue(candidate, 'signatureAlgorithm') !== TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM ||
      (state !== 'active' && state !== 'revoked') ||
      !validFrom ||
      !validUntil ||
      validFrom >= validUntil ||
      !pilotRevisionId ||
      !receiverRevisionId ||
      !receiverProfileId ||
      !receiverProfileDigest ||
      !receiverConfigurationDigest
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
      enrollmentId,
      deviceId,
      keyId,
      publicKeySpkiSha256,
      signatureAlgorithm: TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM,
      state,
      validFrom,
      validUntil,
      pilotRevisionId,
      receiverRevisionId,
      receiverProfileId,
      receiverProfileDigest,
      receiverConfigurationDigest,
    });
  } catch {
    return undefined;
  }
}

export function decodeTelebirrLivePilotTrustedRequestBinding(
  candidate: unknown,
): TelebirrLivePilotTrustedRequestBinding | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, trustedRequestBindingKeys)
    ) {
      return undefined;
    }
    const assignmentId = opaque(ownDataValue(candidate, 'assignmentId'));
    const requestId = opaque(ownDataValue(candidate, 'requestId'));
    const jobId = opaque(ownDataValue(candidate, 'jobId'));
    const attemptNumber = attempt(ownDataValue(candidate, 'attemptNumber'));
    const pilotRevisionId = opaque(ownDataValue(candidate, 'pilotRevisionId'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const referenceFingerprint = fingerprint(ownDataValue(candidate, 'referenceFingerprint'));
    const receiverRevisionId = opaque(ownDataValue(candidate, 'receiverRevisionId'));
    const receiverProfileId = opaque(ownDataValue(candidate, 'receiverProfileId'));
    const receiverProfileDigest = digest(ownDataValue(candidate, 'receiverProfileDigest'));
    const receiverConfigurationDigest = digest(
      ownDataValue(candidate, 'receiverConfigurationDigest'),
    );
    const expectedReceiverNameDigest = digest(
      ownDataValue(candidate, 'expectedReceiverNameDigest'),
    );
    if (
      !assignmentId ||
      !requestId ||
      !jobId ||
      !attemptNumber ||
      !pilotRevisionId ||
      !deviceId ||
      !keyId ||
      !referenceFingerprint ||
      !receiverRevisionId ||
      !receiverProfileId ||
      !receiverProfileDigest ||
      !receiverConfigurationDigest ||
      !expectedReceiverNameDigest
    ) {
      return undefined;
    }
    return Object.freeze({
      assignmentId,
      requestId,
      jobId,
      attemptNumber,
      pilotRevisionId,
      deviceId,
      keyId,
      referenceFingerprint,
      receiverRevisionId,
      receiverProfileId,
      receiverProfileDigest,
      receiverConfigurationDigest,
      expectedReceiverNameDigest,
    });
  } catch {
    return undefined;
  }
}

export function decodeTelebirrLivePilotAssignmentBody(
  candidate: unknown,
): TelebirrLivePilotAssignmentBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, assignmentBodyKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const assignmentId = opaque(ownDataValue(candidate, 'assignmentId'));
    const requestId = opaque(ownDataValue(candidate, 'requestId'));
    const jobId = opaque(ownDataValue(candidate, 'jobId'));
    const attemptNumber = attempt(ownDataValue(candidate, 'attemptNumber'));
    const pilotRevisionId = opaque(ownDataValue(candidate, 'pilotRevisionId'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const leaseNonceDigest = digest(ownDataValue(candidate, 'leaseNonceDigest'));
    const challengeId = opaque(ownDataValue(candidate, 'challengeId'));
    const challengeDigest = digest(ownDataValue(candidate, 'challengeDigest'));
    const rawReference = ownDataValue(candidate, 'rawReference');
    const referenceFingerprint = fingerprint(ownDataValue(candidate, 'referenceFingerprint'));
    const referenceBindingDigest = digest(ownDataValue(candidate, 'referenceBindingDigest'));
    const receiverRevisionId = opaque(ownDataValue(candidate, 'receiverRevisionId'));
    const receiverProfileId = opaque(ownDataValue(candidate, 'receiverProfileId'));
    const receiverProfileDigest = digest(ownDataValue(candidate, 'receiverProfileDigest'));
    const receiverConfigurationDigest = digest(
      ownDataValue(candidate, 'receiverConfigurationDigest'),
    );
    const expectedReceiverNameNormalized = normalizeTelebirrCreditedPartyFullName(
      ownDataValue(candidate, 'expectedReceiverNameNormalized'),
    );
    const expectedReceiverNameDigest = digest(
      ownDataValue(candidate, 'expectedReceiverNameDigest'),
    );
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const expiresAt = timestamp(ownDataValue(candidate, 'expiresAt'));
    if (
      !assignmentId ||
      !requestId ||
      !jobId ||
      !attemptNumber ||
      !pilotRevisionId ||
      !deviceId ||
      !keyId ||
      !leaseNonceDigest ||
      !challengeId ||
      !challengeDigest ||
      typeof rawReference !== 'string' ||
      !RAW_REFERENCE_PATTERN.test(rawReference) ||
      !referenceFingerprint ||
      ownDataValue(candidate, 'referenceBindingProfile') !==
        TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE ||
      !referenceBindingDigest ||
      referenceBindingDigest !==
        deriveTelebirrLivePilotReferenceBindingDigest({ rawReference, referenceFingerprint }) ||
      ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      !receiverRevisionId ||
      !receiverProfileId ||
      !receiverProfileDigest ||
      !receiverConfigurationDigest ||
      ownDataValue(candidate, 'receiverNameNormalizerVersion') !==
        TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION ||
      !expectedReceiverNameNormalized ||
      expectedReceiverNameNormalized !==
        ownDataValue(candidate, 'expectedReceiverNameNormalized') ||
      !expectedReceiverNameDigest ||
      expectedReceiverNameDigest !==
        digestTelebirrLivePilotReceiverName(expectedReceiverNameNormalized) ||
      ownDataValue(candidate, 'adapterVersion') !== TELEBIRR_LIVE_PILOT_ADAPTER_VERSION ||
      ownDataValue(candidate, 'parserVersion') !== TELEBIRR_LIVE_PILOT_PARSER_VERSION ||
      ownDataValue(candidate, 'factsNormalizerVersion') !==
        TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION ||
      !issuedAt ||
      !expiresAt ||
      issuedAt >= expiresAt
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
      assignmentId,
      requestId,
      jobId,
      attemptNumber,
      pilotRevisionId,
      deviceId,
      keyId,
      leaseNonceDigest,
      challengeId,
      challengeDigest,
      rawReference,
      referenceFingerprint,
      referenceBindingProfile: TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
      referenceBindingDigest,
      sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
      receiverRevisionId,
      receiverProfileId,
      receiverProfileDigest,
      receiverConfigurationDigest,
      receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
      expectedReceiverNameNormalized,
      expectedReceiverNameDigest,
      adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
      parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
      factsNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
      issuedAt,
      expiresAt,
    });
  } catch {
    return undefined;
  }
}

function assignmentFields(body: TelebirrLivePilotAssignmentBody): readonly Field[] {
  return assignmentBodyKeys.map((key) => [key, body[key] as Scalar] as const);
}

export function canonicalTelebirrLivePilotAssignmentBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrLivePilotAssignmentBody(candidate);
  return body
    ? encodeFields(
        'fetanagent:telebirr:live-private-pilot:assignment-body:v1',
        assignmentFields(body),
      )
    : undefined;
}

export function digestTelebirrLivePilotAssignmentBody(candidate: unknown): string | undefined {
  const bytes = canonicalTelebirrLivePilotAssignmentBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalTelebirrLivePilotAssignmentSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrLivePilotAssignmentBody(candidate);
  const bodyDigest = body && digestTelebirrLivePilotAssignmentBody(body);
  return body && bodyDigest
    ? encodeFields('fetanagent:telebirr:live-private-pilot:assignment-signature:v1', [
        ['contractVersion', TELEBIRR_LIVE_PILOT_CONTRACT_VERSION],
        ['providerCode', 'telebirr'],
        ['protocolMode', TELEBIRR_LIVE_PILOT_PROTOCOL_MODE],
        ['transcriptVersion', TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM],
        ['signatureEncoding', TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING],
      ])
    : undefined;
}

export function decodeTelebirrLivePilotSignedAssignment(
  candidate: unknown,
): TelebirrLivePilotSignedAssignment | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, signedAssignmentKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const body = decodeTelebirrLivePilotAssignmentBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const signerKeyId = opaque(ownDataValue(candidate, 'signerKeyId'));
    const signature = ownDataValue(candidate, 'signature');
    if (
      ownDataValue(candidate, 'transcriptVersion') !==
        TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !== TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM ||
      !bodyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !== TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !== TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING ||
      !signerKeyId ||
      !body ||
      typeof signature !== 'string' ||
      !P1363_BASE64URL_PATTERN.test(signature)
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
      transcriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM,
      signatureEncoding: TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING,
      signerKeyId,
      body,
      signature,
    });
  } catch {
    return undefined;
  }
}

export function decodeTelebirrLivePilotReceiptFacts(
  candidate: unknown,
): TelebirrLivePilotReceiptFacts | undefined {
  try {
    if (!isPlainNonProxyRecord(candidate)) return undefined;
    const outcome = ownDataValue(candidate, 'lookupOutcome');
    if (outcome === 'review_required') {
      if (!hasExactEnumerableDataKeys(candidate, reviewFactsKeys)) return undefined;
      const reviewReason = ownDataValue(candidate, 'reviewReason');
      const retrievedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'retrievedAt'));
      if (
        ![
          'provider_not_found_unattested',
          'provider_unavailable',
          'network_unavailable',
          'unknown_layout',
          'invalid_layout',
          'parser_uncertain',
          'device_error',
        ].includes(reviewReason as string) ||
        retrievedAt === undefined
      ) {
        return undefined;
      }
      return Object.freeze({
        lookupOutcome: 'review_required',
        reviewReason: reviewReason as TelebirrLivePilotReviewReason,
        retrievedAt,
      });
    }
    if (outcome !== 'found' || !hasExactEnumerableDataKeys(candidate, foundFactsKeys)) {
      return undefined;
    }
    const providerFinalStatus = ownDataValue(candidate, 'providerFinalStatus');
    const canonicalReferencePresent = ownDataValue(candidate, 'canonicalReferencePresent');
    const referenceMatch = ownDataValue(candidate, 'referenceMatch');
    const amountMinor = ownDataValue(candidate, 'amountMinor');
    const currencyCode = ownDataValue(candidate, 'currencyCode');
    const receiverMatch = ownDataValue(candidate, 'receiverMatch');
    const creditedPartyNameDigest = ownDataValue(candidate, 'creditedPartyNameDigest');
    const paymentMode = ownDataValue(candidate, 'paymentMode');
    const paymentReason = ownDataValue(candidate, 'paymentReason');
    const paymentChannel = ownDataValue(candidate, 'paymentChannel');
    const occurredAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'occurredAt'));
    const retrievedAt = timestamp(ownDataValue(candidate, 'retrievedAt'));
    if (
      ownDataValue(candidate, 'evidenceSource') !== 'provider_receipt_lookup' ||
      ownDataValue(candidate, 'layoutAttestation') !== 'recognized_layout_v1' ||
      !['completed', 'pending', 'failed', 'reversed', 'unknown'].includes(
        providerFinalStatus as string,
      ) ||
      typeof canonicalReferencePresent !== 'boolean' ||
      !['matched', 'mismatched', 'unknown'].includes(referenceMatch as string) ||
      (canonicalReferencePresent ? referenceMatch === 'unknown' : referenceMatch !== 'unknown') ||
      (amountMinor !== null &&
        (!Number.isSafeInteger(amountMinor) || (amountMinor as number) < 1)) ||
      currencyCode !== (amountMinor === null ? 'unknown' : 'ETB') ||
      !['matched', 'mismatched', 'unknown'].includes(receiverMatch as string) ||
      (creditedPartyNameDigest !== null && !digest(creditedPartyNameDigest)) ||
      (receiverMatch === 'unknown'
        ? creditedPartyNameDigest !== null
        : creditedPartyNameDigest === null) ||
      !['telebirr', 'other', 'unknown'].includes(paymentMode as string) ||
      !['send_money_to_registered_customer', 'other', 'unknown'].includes(
        paymentReason as string,
      ) ||
      !['api_app', 'other', 'unknown'].includes(paymentChannel as string) ||
      occurredAt === undefined ||
      !retrievedAt ||
      (typeof occurredAt === 'string' && occurredAt > retrievedAt)
    ) {
      return undefined;
    }
    return Object.freeze({
      lookupOutcome: 'found',
      evidenceSource: 'provider_receipt_lookup',
      layoutAttestation: 'recognized_layout_v1',
      providerFinalStatus:
        providerFinalStatus as TelebirrLivePilotFoundFacts['providerFinalStatus'],
      canonicalReferencePresent,
      referenceMatch: referenceMatch as TelebirrLivePilotFoundFacts['referenceMatch'],
      amountMinor: amountMinor as number | null,
      currencyCode: currencyCode as 'ETB' | 'unknown',
      receiverMatch: receiverMatch as TelebirrLivePilotFoundFacts['receiverMatch'],
      creditedPartyNameDigest: creditedPartyNameDigest as string | null,
      paymentMode: paymentMode as TelebirrLivePilotFoundFacts['paymentMode'],
      paymentReason: paymentReason as TelebirrLivePilotFoundFacts['paymentReason'],
      paymentChannel: paymentChannel as TelebirrLivePilotFoundFacts['paymentChannel'],
      occurredAt,
      retrievedAt,
    });
  } catch {
    return undefined;
  }
}

function factsFields(facts: TelebirrLivePilotReceiptFacts): readonly Field[] {
  if (facts.lookupOutcome === 'review_required') {
    return [
      ['facts.lookupOutcome', facts.lookupOutcome],
      ['facts.reviewReason', facts.reviewReason],
      ['facts.retrievedAt', facts.retrievedAt],
    ];
  }
  return [
    ['facts.lookupOutcome', facts.lookupOutcome],
    ['facts.evidenceSource', facts.evidenceSource],
    ['facts.layoutAttestation', facts.layoutAttestation],
    ['facts.providerFinalStatus', facts.providerFinalStatus],
    ['facts.canonicalReferencePresent', facts.canonicalReferencePresent],
    ['facts.referenceMatch', facts.referenceMatch],
    ['facts.amountMinor', facts.amountMinor],
    ['facts.currencyCode', facts.currencyCode],
    ['facts.receiverMatch', facts.receiverMatch],
    ['facts.creditedPartyNameDigest', facts.creditedPartyNameDigest],
    ['facts.paymentMode', facts.paymentMode],
    ['facts.paymentReason', facts.paymentReason],
    ['facts.paymentChannel', facts.paymentChannel],
    ['facts.occurredAt', facts.occurredAt],
    ['facts.retrievedAt', facts.retrievedAt],
  ];
}

export function canonicalTelebirrLivePilotReceiptFactsBytes(
  candidate: unknown,
): Buffer | undefined {
  const facts = decodeTelebirrLivePilotReceiptFacts(candidate);
  return facts
    ? encodeFields('fetanagent:telebirr:live-private-pilot:facts:v1', factsFields(facts))
    : undefined;
}

export function digestTelebirrLivePilotReceiptFacts(candidate: unknown): string | undefined {
  const bytes = canonicalTelebirrLivePilotReceiptFactsBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function decodeTelebirrLivePilotObservationBody(
  candidate: unknown,
): TelebirrLivePilotObservationBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, observationBodyKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const ids = Object.fromEntries(
      [
        'assignmentId',
        'requestId',
        'jobId',
        'pilotRevisionId',
        'deviceId',
        'keyId',
        'challengeId',
        'receiverRevisionId',
        'receiverProfileId',
      ].map((key) => [key, opaque(ownDataValue(candidate, key))]),
    );
    const attemptNumber = attempt(ownDataValue(candidate, 'attemptNumber'));
    const digests = Object.fromEntries(
      [
        'leaseNonceDigest',
        'challengeDigest',
        'assignmentBodyDigest',
        'referenceBindingDigest',
        'receiverProfileDigest',
        'receiverConfigurationDigest',
        'expectedReceiverNameDigest',
        'sourceDocumentDigest',
        'normalizedFactsDigest',
      ].map((key) => [key, digest(ownDataValue(candidate, key))]),
    );
    const referenceFingerprint = fingerprint(ownDataValue(candidate, 'referenceFingerprint'));
    const observedAt = timestamp(ownDataValue(candidate, 'observedAt'));
    const facts = decodeTelebirrLivePilotReceiptFacts(ownDataValue(candidate, 'facts'));
    if (
      Object.values(ids).some((value) => !value) ||
      !attemptNumber ||
      Object.values(digests).some((value) => !value) ||
      !referenceFingerprint ||
      ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      ownDataValue(candidate, 'receiverNameNormalizerVersion') !==
        TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION ||
      ownDataValue(candidate, 'adapterVersion') !== TELEBIRR_LIVE_PILOT_ADAPTER_VERSION ||
      ownDataValue(candidate, 'parserVersion') !== TELEBIRR_LIVE_PILOT_PARSER_VERSION ||
      ownDataValue(candidate, 'factsNormalizerVersion') !==
        TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION ||
      !observedAt ||
      !facts
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
      assignmentId: ids.assignmentId!,
      requestId: ids.requestId!,
      jobId: ids.jobId!,
      attemptNumber,
      pilotRevisionId: ids.pilotRevisionId!,
      deviceId: ids.deviceId!,
      keyId: ids.keyId!,
      leaseNonceDigest: digests.leaseNonceDigest!,
      challengeId: ids.challengeId!,
      challengeDigest: digests.challengeDigest!,
      assignmentBodyDigest: digests.assignmentBodyDigest!,
      referenceFingerprint,
      referenceBindingDigest: digests.referenceBindingDigest!,
      sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
      receiverRevisionId: ids.receiverRevisionId!,
      receiverProfileId: ids.receiverProfileId!,
      receiverProfileDigest: digests.receiverProfileDigest!,
      receiverConfigurationDigest: digests.receiverConfigurationDigest!,
      receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
      expectedReceiverNameDigest: digests.expectedReceiverNameDigest!,
      adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
      parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
      factsNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
      sourceDocumentDigest: digests.sourceDocumentDigest!,
      normalizedFactsDigest: digests.normalizedFactsDigest!,
      observedAt,
      facts,
    });
  } catch {
    return undefined;
  }
}

function observationFields(body: TelebirrLivePilotObservationBody): readonly Field[] {
  const bodyFields: Field[] = observationBodyKeys
    .filter((key) => key !== 'facts')
    .map((key) => [key, body[key] as Scalar]);
  return [...bodyFields, ...factsFields(body.facts)];
}

export function canonicalTelebirrLivePilotObservationBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrLivePilotObservationBody(candidate);
  return body
    ? encodeFields(
        'fetanagent:telebirr:live-private-pilot:observation-body:v1',
        observationFields(body),
      )
    : undefined;
}

export function digestTelebirrLivePilotObservationBody(candidate: unknown): string | undefined {
  const bytes = canonicalTelebirrLivePilotObservationBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalTelebirrLivePilotObservationSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrLivePilotObservationBody(candidate);
  const bodyDigest = body && digestTelebirrLivePilotObservationBody(body);
  return body && bodyDigest
    ? encodeFields('fetanagent:telebirr:live-private-pilot:observation-signature:v1', [
        ['contractVersion', TELEBIRR_LIVE_PILOT_CONTRACT_VERSION],
        ['providerCode', 'telebirr'],
        ['protocolMode', TELEBIRR_LIVE_PILOT_PROTOCOL_MODE],
        ['transcriptVersion', TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM],
        ['signatureEncoding', TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING],
      ])
    : undefined;
}

export function decodeTelebirrLivePilotSignedObservation(
  candidate: unknown,
): TelebirrLivePilotSignedObservation | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, signedObservationKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const body = decodeTelebirrLivePilotObservationBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const signature = ownDataValue(candidate, 'signature');
    if (
      ownDataValue(candidate, 'transcriptVersion') !==
        TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !== TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM ||
      !bodyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !== TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !== TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING ||
      !body ||
      typeof signature !== 'string' ||
      !P1363_BASE64URL_PATTERN.test(signature)
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
      transcriptVersion: TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM,
      signatureEncoding: TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING,
      body,
      signature,
    });
  } catch {
    return undefined;
  }
}

function parsePublicKey(
  candidate: unknown,
): { readonly key: KeyObject; readonly der: Buffer } | undefined {
  try {
    if (!(candidate instanceof Uint8Array) || isProxy(candidate)) return undefined;
    const der = Buffer.from(candidate);
    if (der.length < 1 || der.length > MAX_SPKI_BYTES) return undefined;
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    const canonical = key.export({ format: 'der', type: 'spki' });
    if (
      key.type !== 'public' ||
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
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
  const values: string[] = [];
  for (let index = 0; index < candidate.length; index += 1) {
    if (!Object.hasOwn(candidate, index)) return undefined;
    const value = digest(candidate[index]);
    if (!value || values.includes(value)) return undefined;
    values.push(value);
  }
  return Object.freeze(values);
}

function parseVerificationInput(
  candidate: unknown,
): TelebirrLivePilotVerificationInput | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, verificationInputKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const assessedAt = timestamp(ownDataValue(candidate, 'assessedAt'));
    const trustedAssignmentSigner = decodeTelebirrLivePilotTrustedAssignmentSigner(
      ownDataValue(candidate, 'trustedAssignmentSigner'),
    );
    const trustedRequestBinding = decodeTelebirrLivePilotTrustedRequestBinding(
      ownDataValue(candidate, 'trustedRequestBinding'),
    );
    const deviceEnrollment = decodeTelebirrLivePilotDeviceEnrollment(
      ownDataValue(candidate, 'deviceEnrollment'),
    );
    const signedAssignment = decodeTelebirrLivePilotSignedAssignment(
      ownDataValue(candidate, 'signedAssignment'),
    );
    const signedObservation = decodeTelebirrLivePilotSignedObservation(
      ownDataValue(candidate, 'signedObservation'),
    );
    const serverComputedReplayIdentities = parseReplayIdentities(
      ownDataValue(candidate, 'serverComputedReplayIdentities'),
    );
    return assessedAt &&
      trustedAssignmentSigner &&
      trustedRequestBinding &&
      deviceEnrollment &&
      signedAssignment &&
      signedObservation &&
      serverComputedReplayIdentities
      ? Object.freeze({
          contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
          providerCode: 'telebirr',
          protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
          assessedAt,
          trustedAssignmentSigner,
          trustedRequestBinding,
          deviceEnrollment,
          signedAssignment,
          signedObservation,
          serverComputedReplayIdentities,
        })
      : undefined;
  } catch {
    return undefined;
  }
}

function assignmentObservationBindingsMatch(
  enrollment: TelebirrLivePilotDeviceEnrollment,
  assignment: TelebirrLivePilotAssignmentBody,
  observation: TelebirrLivePilotObservationBody,
): boolean {
  return (
    enrollment.deviceId === assignment.deviceId &&
    enrollment.deviceId === observation.deviceId &&
    enrollment.keyId === assignment.keyId &&
    enrollment.keyId === observation.keyId &&
    enrollment.pilotRevisionId === assignment.pilotRevisionId &&
    enrollment.pilotRevisionId === observation.pilotRevisionId &&
    assignment.assignmentId === observation.assignmentId &&
    assignment.requestId === observation.requestId &&
    assignment.jobId === observation.jobId &&
    assignment.attemptNumber === observation.attemptNumber &&
    assignment.leaseNonceDigest === observation.leaseNonceDigest &&
    assignment.challengeId === observation.challengeId &&
    assignment.challengeDigest === observation.challengeDigest
  );
}

export function deriveTelebirrLivePilotReplayIdentity(
  assignmentCandidate: unknown,
  observationCandidate: unknown,
): string | undefined {
  const assignment = decodeTelebirrLivePilotSignedAssignment(assignmentCandidate);
  const observation = decodeTelebirrLivePilotSignedObservation(observationCandidate);
  if (!assignment || !observation) return undefined;
  const assignmentDigest = digestTelebirrLivePilotAssignmentBody(assignment.body);
  const observationDigest = digestTelebirrLivePilotObservationBody(observation.body);
  if (
    !assignmentDigest ||
    !observationDigest ||
    assignmentDigest !== assignment.bodyDigest ||
    observationDigest !== observation.bodyDigest
  ) {
    return undefined;
  }
  return sha256(
    encodeFields('fetanagent:telebirr:live-private-pilot:replay-identity:v1', [
      ['assignmentBodyDigest', assignmentDigest],
      ['observationBodyDigest', observationDigest],
      ['deviceId', observation.body.deviceId],
      ['keyId', observation.body.keyId],
    ]),
  );
}

function verifyP1363(key: KeyObject, bytes: Uint8Array, signature: string): boolean {
  try {
    return verifySignature(
      'sha256',
      bytes,
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

/**
 * Verifies two signatures and every pilot/reference/receiver/time binding, then returns only an
 * advisory evidence route. Even a successful result cannot claim or settle a payment.
 */
export function verifyTelebirrLivePrivatePilotEvidence(
  inputCandidate: unknown,
  trustedAssignmentSignerSpkiDerCandidate: unknown,
  enrolledDeviceSpkiDerCandidate: unknown,
): TelebirrLivePilotVerificationResult {
  try {
    const input = parseVerificationInput(inputCandidate);
    if (!input) return invalidResult;
    const {
      trustedAssignmentSigner,
      trustedRequestBinding,
      deviceEnrollment,
      signedAssignment,
      signedObservation,
    } = input;
    const assignment = signedAssignment.body;
    const observation = signedObservation.body;
    const assessedAtMs = Date.parse(input.assessedAt);
    const issuedAtMs = Date.parse(assignment.issuedAt);
    const expiresAtMs = Date.parse(assignment.expiresAt);
    const observedAtMs = Date.parse(observation.observedAt);

    if (trustedAssignmentSigner.state === 'revoked') {
      return result('would_review', 'assignment_signer_revoked');
    }
    if (
      assessedAtMs < Date.parse(trustedAssignmentSigner.validFrom) ||
      assessedAtMs >= Date.parse(trustedAssignmentSigner.validUntil) ||
      issuedAtMs < Date.parse(trustedAssignmentSigner.validFrom) ||
      issuedAtMs >= Date.parse(trustedAssignmentSigner.validUntil) ||
      expiresAtMs > Date.parse(trustedAssignmentSigner.validUntil)
    ) {
      return result('would_review', 'assignment_signer_expired');
    }
    if (trustedAssignmentSigner.signerKeyId !== signedAssignment.signerKeyId) {
      return result('would_review', 'binding_mismatch');
    }
    const signerKey = parsePublicKey(trustedAssignmentSignerSpkiDerCandidate);
    if (!signerKey) return result('would_review', 'assignment_signer_key_invalid');
    if (sha256(signerKey.der) !== trustedAssignmentSigner.publicKeySpkiSha256) {
      return result('would_review', 'assignment_signer_key_mismatch');
    }
    const assignmentBodyDigest = digestTelebirrLivePilotAssignmentBody(assignment);
    if (!assignmentBodyDigest || assignmentBodyDigest !== signedAssignment.bodyDigest) {
      return result('would_review', 'assignment_body_digest_mismatch');
    }
    const assignmentTranscript = canonicalTelebirrLivePilotAssignmentSignatureBytes(assignment);
    if (
      !assignmentTranscript ||
      !verifyP1363(signerKey.key, assignmentTranscript, signedAssignment.signature)
    ) {
      return result('would_review', 'assignment_signature_invalid');
    }
    if (
      trustedRequestBinding.assignmentId !== assignment.assignmentId ||
      trustedRequestBinding.requestId !== assignment.requestId ||
      trustedRequestBinding.jobId !== assignment.jobId ||
      trustedRequestBinding.attemptNumber !== assignment.attemptNumber ||
      trustedRequestBinding.pilotRevisionId !== assignment.pilotRevisionId ||
      trustedRequestBinding.deviceId !== assignment.deviceId ||
      trustedRequestBinding.keyId !== assignment.keyId
    ) {
      return result('would_review', 'binding_mismatch');
    }
    if (trustedRequestBinding.referenceFingerprint !== assignment.referenceFingerprint) {
      return result('would_review', 'reference_binding_mismatch');
    }
    if (
      trustedRequestBinding.receiverRevisionId !== assignment.receiverRevisionId ||
      trustedRequestBinding.receiverProfileId !== assignment.receiverProfileId ||
      trustedRequestBinding.receiverProfileDigest !== assignment.receiverProfileDigest ||
      trustedRequestBinding.receiverConfigurationDigest !==
        assignment.receiverConfigurationDigest ||
      trustedRequestBinding.expectedReceiverNameDigest !== assignment.expectedReceiverNameDigest
    ) {
      return result('would_review', 'receiver_binding_mismatch');
    }

    if (deviceEnrollment.state === 'revoked') return result('would_review', 'device_revoked');
    if (
      assessedAtMs < Date.parse(deviceEnrollment.validFrom) ||
      assessedAtMs >= Date.parse(deviceEnrollment.validUntil) ||
      issuedAtMs < Date.parse(deviceEnrollment.validFrom) ||
      issuedAtMs >= Date.parse(deviceEnrollment.validUntil) ||
      expiresAtMs > Date.parse(deviceEnrollment.validUntil) ||
      observedAtMs < Date.parse(deviceEnrollment.validFrom) ||
      observedAtMs >= Date.parse(deviceEnrollment.validUntil)
    ) {
      return result('would_review', 'device_enrollment_expired');
    }
    const deviceKey = parsePublicKey(enrolledDeviceSpkiDerCandidate);
    if (!deviceKey) return result('would_review', 'device_key_invalid');
    if (sha256(deviceKey.der) !== deviceEnrollment.publicKeySpkiSha256) {
      return result('would_review', 'device_key_mismatch');
    }

    if (assessedAtMs < issuedAtMs || assessedAtMs >= expiresAtMs) {
      return result('would_review', 'assignment_expired');
    }
    if (
      observedAtMs < issuedAtMs ||
      observedAtMs >= expiresAtMs ||
      observedAtMs > assessedAtMs + FUTURE_OBSERVATION_TOLERANCE_MS
    ) {
      return result('would_review', 'observation_time_invalid');
    }
    if (!assignmentObservationBindingsMatch(deviceEnrollment, assignment, observation)) {
      return result('would_review', 'binding_mismatch');
    }
    if (
      assignment.referenceBindingDigest !== observation.referenceBindingDigest ||
      assignment.referenceFingerprint !== observation.referenceFingerprint ||
      assignment.referenceBindingDigest !==
        deriveTelebirrLivePilotReferenceBindingDigest({
          rawReference: assignment.rawReference,
          referenceFingerprint: assignment.referenceFingerprint,
        })
    ) {
      return result('would_review', 'reference_binding_mismatch');
    }
    if (
      deviceEnrollment.receiverRevisionId !== assignment.receiverRevisionId ||
      deviceEnrollment.receiverRevisionId !== observation.receiverRevisionId ||
      deviceEnrollment.receiverProfileId !== assignment.receiverProfileId ||
      deviceEnrollment.receiverProfileId !== observation.receiverProfileId ||
      deviceEnrollment.receiverProfileDigest !== assignment.receiverProfileDigest ||
      deviceEnrollment.receiverProfileDigest !== observation.receiverProfileDigest ||
      deviceEnrollment.receiverConfigurationDigest !== assignment.receiverConfigurationDigest ||
      deviceEnrollment.receiverConfigurationDigest !== observation.receiverConfigurationDigest ||
      assignment.expectedReceiverNameDigest !== observation.expectedReceiverNameDigest ||
      assignment.expectedReceiverNameDigest !==
        digestTelebirrLivePilotReceiverName(assignment.expectedReceiverNameNormalized)
    ) {
      return result('would_review', 'receiver_binding_mismatch');
    }
    if (
      assignment.sourceProfile !== observation.sourceProfile ||
      assignment.sourceProfile !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE
    ) {
      return result('would_review', 'source_profile_mismatch');
    }
    if (
      assignment.receiverNameNormalizerVersion !== observation.receiverNameNormalizerVersion ||
      assignment.adapterVersion !== observation.adapterVersion ||
      assignment.parserVersion !== observation.parserVersion ||
      assignment.factsNormalizerVersion !== observation.factsNormalizerVersion
    ) {
      return result('would_review', 'version_mismatch');
    }
    if (observation.assignmentBodyDigest !== assignmentBodyDigest) {
      return result('would_review', 'assignment_body_digest_mismatch');
    }
    if (
      digestTelebirrLivePilotReceiptFacts(observation.facts) !== observation.normalizedFactsDigest
    ) {
      return result('would_review', 'facts_digest_mismatch');
    }
    const observationBodyDigest = digestTelebirrLivePilotObservationBody(observation);
    if (!observationBodyDigest || observationBodyDigest !== signedObservation.bodyDigest) {
      return result('would_review', 'observation_body_digest_mismatch');
    }
    const observationTranscript = canonicalTelebirrLivePilotObservationSignatureBytes(observation);
    if (
      !observationTranscript ||
      !verifyP1363(deviceKey.key, observationTranscript, signedObservation.signature)
    ) {
      return result('would_review', 'device_signature_invalid');
    }
    const replayIdentity = deriveTelebirrLivePilotReplayIdentity(
      signedAssignment,
      signedObservation,
    );
    if (!replayIdentity) return invalidResult;
    if (input.serverComputedReplayIdentities.includes(replayIdentity)) {
      return result('would_review', 'replay_detected', replayIdentity);
    }

    const facts = observation.facts;
    if (facts.lookupOutcome === 'review_required') {
      return result('would_review', 'receipt_requires_review', replayIdentity);
    }
    if (facts.referenceMatch !== 'matched') {
      return result('would_review', 'reference_mismatch', replayIdentity);
    }
    if (
      facts.receiverMatch !== 'matched' ||
      facts.creditedPartyNameDigest !== assignment.expectedReceiverNameDigest
    ) {
      return result('would_review', 'receiver_mismatch', replayIdentity);
    }
    if (facts.providerFinalStatus !== 'completed') {
      return result('would_review', 'provider_status_not_completed', replayIdentity);
    }
    if (
      facts.amountMinor === null ||
      facts.currencyCode !== 'ETB' ||
      facts.paymentMode !== 'telebirr' ||
      facts.paymentReason !== 'send_money_to_registered_customer' ||
      facts.paymentChannel !== 'api_app' ||
      facts.occurredAt === null ||
      facts.retrievedAt !== observation.observedAt
    ) {
      return result('would_review', 'receipt_semantics_incomplete', replayIdentity);
    }
    return result('would_forward_signed_evidence', 'signed_evidence_verified', replayIdentity);
  } catch {
    return invalidResult;
  }
}
