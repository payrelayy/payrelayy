import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
  type UnknownRecord,
} from './exact-data-record.js';
import { assessRoutineTelebirrObservedReceiptFacts } from './routine-receipt-assessment.js';
import { TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE } from './synthetic-official-receipt.js';

/** Version 1 is device-signature-only review evidence; neither version grants money authority. */
export const ROUTINE_TELEBIRR_OBSERVATION_CONTRACT_VERSION = 1 as const;
export const ROUTINE_TELEBIRR_OBSERVATION_PROTOCOL_MODE = 'routine_signed_observation_v1' as const;
export const ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION =
  'telebirr-routine-observation-transcript-v1' as const;
export const ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_CONTRACT_VERSION = 2 as const;
export const ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_PROTOCOL_MODE =
  'routine_signed_observation_v2' as const;
export const ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_TRANSCRIPT_VERSION =
  'telebirr-routine-observation-transcript-v2' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const P1363 = /^[A-Za-z0-9_-]{86}$/u;
const MAX_SPKI_BYTES = 512;
const MAX_LOOKUP_LEASE_MS = 5 * 60 * 1_000;

const lookupKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'candidateId',
  'referenceFingerprint',
  'referenceKeyVersion',
  'referenceProfileVersion',
  'submittedAt',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'expectedReceiverNameDigest',
  'deviceId',
  'keyId',
  'challengeId',
  'challengeDigest',
  'issuedAt',
  'expiresAt',
] as const;
const enrollmentKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'deviceId',
  'keyId',
  'publicKeySpkiSha256',
  'state',
  'validFrom',
  'validUntil',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
] as const;
const factsKeys = [
  'amountMinor',
  'canonicalReferencePresent',
  'creditedPartyNameDigest',
  'currencyCode',
  'evidenceSource',
  'occurredAt',
  'paymentChannel',
  'paymentMode',
  'paymentReason',
  'providerFinalStatus',
  'providerIdentity',
  'receiverMatch',
  'referenceMatch',
  'retrievedAt',
  'sourceProfile',
] as const;
const originFactsKeys = [...factsKeys, 'sourceOriginAttestation'] as const;
const bodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'candidateId',
  'referenceFingerprint',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'expectedReceiverNameDigest',
  'deviceId',
  'keyId',
  'challengeId',
  'challengeDigest',
  'sourceDocumentDigest',
  'normalizedFactsDigest',
  'observedAt',
  'facts',
] as const;
const envelopeKeys = [
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
const inputKeys = ['assessedAt', 'trustedLookup', 'deviceEnrollment', 'signedObservation'] as const;

type Facts = { readonly [K in (typeof factsKeys)[number]]: unknown };
type Body = { readonly [K in (typeof bodyKeys)[number]]: unknown };

export interface RoutineTelebirrSignedObservationResult {
  readonly advisoryOnly: true;
  readonly deviceSignatureVerified: boolean;
  /** The reviewed phone contract attests the fixed official TLS transport; not a server fetch. */
  readonly phoneOfficialOriginAttested: boolean;
  readonly sourceAuthenticationPerformed: false;
  readonly databaseWriteAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_forward_signed_observation';
  readonly reasonCode:
    | 'invalid_request'
    | 'device_revoked_or_expired'
    | 'device_key_mismatch'
    | 'binding_mismatch'
    | 'lookup_expired'
    | 'observation_time_invalid'
    | 'facts_digest_mismatch'
    | 'body_digest_mismatch'
    | 'signature_invalid'
    | 'receipt_policy_review'
    | 'signed_observation_matches_policy';
  /** Advisory identity. Only a database uniqueness constraint can enforce one-use semantics. */
  readonly replayIdentity: string | null;
}

function result(
  disposition: RoutineTelebirrSignedObservationResult['disposition'],
  reasonCode: RoutineTelebirrSignedObservationResult['reasonCode'],
  deviceSignatureVerified = false,
  replayIdentity: string | null = null,
  phoneOfficialOriginAttested = false,
): RoutineTelebirrSignedObservationResult {
  return Object.freeze({
    advisoryOnly: true,
    deviceSignatureVerified,
    phoneOfficialOriginAttested,
    sourceAuthenticationPerformed: false,
    databaseWriteAllowed: false,
    claimAllowed: false,
    settlementAllowed: false,
    enqueueAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    disposition,
    reasonCode,
    replayIdentity,
  });
}

function record(value: unknown, keys: readonly string[]): UnknownRecord | undefined {
  if (!isPlainNonProxyRecord(value) || !hasExactEnumerableDataKeys(value, keys)) return undefined;
  return Object.fromEntries(keys.map((key) => [key, ownDataValue(value, key)]));
}

function utc(value: unknown): value is string {
  return typeof value === 'string' && parseCanonicalUtcTimestamp(value) === value;
}

function header(value: UnknownRecord): boolean {
  return (
    value.contractVersion === ROUTINE_TELEBIRR_OBSERVATION_CONTRACT_VERSION &&
    value.providerCode === 'telebirr' &&
    value.protocolMode === ROUTINE_TELEBIRR_OBSERVATION_PROTOCOL_MODE
  );
}

function observationHeader(value: UnknownRecord): boolean {
  return (
    value.providerCode === 'telebirr' &&
    ((value.contractVersion === ROUTINE_TELEBIRR_OBSERVATION_CONTRACT_VERSION &&
      value.protocolMode === ROUTINE_TELEBIRR_OBSERVATION_PROTOCOL_MODE) ||
      (value.contractVersion === ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_CONTRACT_VERSION &&
        value.protocolMode === ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_PROTOCOL_MODE))
  );
}

function originVersion(value: UnknownRecord): boolean {
  return value.contractVersion === ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_CONTRACT_VERSION;
}

function digest(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function encode(domain: string, values: readonly unknown[]): Buffer {
  return Buffer.from(JSON.stringify([domain, ...values]), 'utf8');
}

function values(value: UnknownRecord, keys: readonly string[]): unknown[] {
  return keys.map((key) => value[key]);
}

function parseFacts(value: unknown, origin: boolean): Facts | undefined {
  const facts = record(value, origin ? originFactsKeys : factsKeys);
  if (
    !facts ||
    typeof facts.amountMinor !== 'number' ||
    !Number.isSafeInteger(facts.amountMinor) ||
    facts.amountMinor < 0 ||
    typeof facts.canonicalReferencePresent !== 'boolean' ||
    typeof facts.creditedPartyNameDigest !== 'string' ||
    !DIGEST.test(facts.creditedPartyNameDigest) ||
    !utc(facts.occurredAt) ||
    !utc(facts.retrievedAt) ||
    typeof facts.currencyCode !== 'string' ||
    !['ETB', 'unknown'].includes(facts.currencyCode) ||
    typeof facts.evidenceSource !== 'string' ||
    !['provider_receipt_lookup', 'unknown'].includes(facts.evidenceSource) ||
    typeof facts.paymentMode !== 'string' ||
    !['telebirr', 'other', 'unknown'].includes(facts.paymentMode) ||
    typeof facts.paymentReason !== 'string' ||
    !['send_money_to_registered_customer', 'other', 'unknown'].includes(facts.paymentReason) ||
    typeof facts.paymentChannel !== 'string' ||
    !['api_app', 'other', 'unknown'].includes(facts.paymentChannel) ||
    typeof facts.providerFinalStatus !== 'string' ||
    !['completed', 'pending', 'failed', 'reversed', 'unknown'].includes(
      facts.providerFinalStatus,
    ) ||
    typeof facts.providerIdentity !== 'string' ||
    !['matched', 'mismatched', 'unknown'].includes(facts.providerIdentity) ||
    typeof facts.receiverMatch !== 'string' ||
    !['matched', 'mismatched', 'unknown'].includes(facts.receiverMatch) ||
    typeof facts.referenceMatch !== 'string' ||
    !['matched', 'mismatched', 'unknown'].includes(facts.referenceMatch) ||
    facts.sourceProfile !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
    (origin && facts.sourceOriginAttestation !== 'official_tls_origin')
  )
    return undefined;
  return facts as Facts;
}

function parseBody(value: unknown): Body | undefined {
  const body = record(value, bodyKeys);
  if (
    !body ||
    !observationHeader(body) ||
    typeof body.candidateId !== 'string' ||
    !UUID_V4.test(body.candidateId) ||
    typeof body.referenceFingerprint !== 'string' ||
    !FINGERPRINT.test(body.referenceFingerprint) ||
    typeof body.receiverRevisionId !== 'string' ||
    !UUID_V4.test(body.receiverRevisionId) ||
    typeof body.receiverVersion !== 'number' ||
    !Number.isSafeInteger(body.receiverVersion) ||
    body.receiverVersion < 1 ||
    typeof body.receiverProfileDigest !== 'string' ||
    !DIGEST.test(body.receiverProfileDigest) ||
    typeof body.expectedReceiverNameDigest !== 'string' ||
    !DIGEST.test(body.expectedReceiverNameDigest) ||
    typeof body.deviceId !== 'string' ||
    !OPAQUE_ID.test(body.deviceId) ||
    typeof body.keyId !== 'string' ||
    !OPAQUE_ID.test(body.keyId) ||
    typeof body.challengeId !== 'string' ||
    !UUID_V4.test(body.challengeId) ||
    typeof body.challengeDigest !== 'string' ||
    !DIGEST.test(body.challengeDigest) ||
    typeof body.sourceDocumentDigest !== 'string' ||
    !DIGEST.test(body.sourceDocumentDigest) ||
    typeof body.normalizedFactsDigest !== 'string' ||
    !DIGEST.test(body.normalizedFactsDigest) ||
    !utc(body.observedAt) ||
    !parseFacts(body.facts, originVersion(body))
  )
    return undefined;
  return body as Body;
}

/** Deterministic ASCII-field transcript for the paired-device signer. */
export function canonicalRoutineTelebirrObservationBodyBytes(value: unknown): Buffer | undefined {
  try {
    const body = parseBody(value);
    if (!body) return undefined;
    return encode(
      originVersion(body)
        ? 'telebirr-routine-observation-body-v2'
        : 'telebirr-routine-observation-body-v1',
      [
        ...values(body, bodyKeys.slice(0, -1)),
        values(body.facts as UnknownRecord, originVersion(body) ? originFactsKeys : factsKeys),
      ],
    );
  } catch {
    return undefined;
  }
}

export function digestRoutineTelebirrObservationBody(value: unknown): string | undefined {
  const bytes = canonicalRoutineTelebirrObservationBodyBytes(value);
  return bytes && digest(bytes);
}

export function digestRoutineTelebirrObservationFacts(value: unknown): string | undefined {
  try {
    const origin =
      isPlainNonProxyRecord(value) && hasExactEnumerableDataKeys(value, originFactsKeys);
    const facts = parseFacts(value, origin);
    return (
      facts &&
      digest(
        encode(
          origin
            ? 'telebirr-routine-observation-facts-v2'
            : 'telebirr-routine-observation-facts-v1',
          values(facts, origin ? originFactsKeys : factsKeys),
        ),
      )
    );
  } catch {
    return undefined;
  }
}

export function canonicalRoutineTelebirrObservationSignatureBytes(
  value: unknown,
): Buffer | undefined {
  const bodyDigest = digestRoutineTelebirrObservationBody(value);
  return bodyDigest
    ? encode(
        isPlainNonProxyRecord(value) && ownDataValue(value, 'contractVersion') === 2
          ? ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_TRANSCRIPT_VERSION
          : ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION,
        [bodyDigest],
      )
    : undefined;
}

function parsePublicKey(candidate: unknown): { key: KeyObject; der: Buffer } | undefined {
  if (
    !(candidate instanceof Uint8Array) ||
    candidate.byteLength > MAX_SPKI_BYTES ||
    candidate.byteLength < 64
  ) {
    return undefined;
  }
  const der = Buffer.from(candidate);
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    return undefined;
  }
  return { key, der };
}

/**
 * Verifies a paired-device signature against independent server lookup/enrollment snapshots.
 * The caller must load those snapshots from trusted storage, use the server clock for assessedAt,
 * and atomically enforce replay/claim uniqueness. A valid signature authenticates the device,
 * not TeleBirr or the receipt source.
 */
export function verifyRoutineTelebirrSignedObservation(
  inputCandidate: unknown,
  enrolledDeviceSpkiDerCandidate: unknown,
): RoutineTelebirrSignedObservationResult {
  try {
    const input = record(inputCandidate, inputKeys);
    const lookup = input && record(input.trustedLookup, lookupKeys);
    const enrollment = input && record(input.deviceEnrollment, enrollmentKeys);
    const envelope = input && record(input.signedObservation, envelopeKeys);
    const body = envelope && parseBody(envelope.body);
    if (
      !input ||
      !lookup ||
      !enrollment ||
      !envelope ||
      !body ||
      !utc(input.assessedAt) ||
      !header(lookup) ||
      !header(enrollment) ||
      !observationHeader(envelope) ||
      envelope.contractVersion !== body.contractVersion ||
      envelope.protocolMode !== body.protocolMode ||
      typeof lookup.candidateId !== 'string' ||
      !UUID_V4.test(lookup.candidateId) ||
      typeof lookup.referenceFingerprint !== 'string' ||
      !FINGERPRINT.test(lookup.referenceFingerprint) ||
      lookup.referenceKeyVersion !== 2 ||
      lookup.referenceProfileVersion !== 2 ||
      !utc(lookup.submittedAt) ||
      typeof lookup.receiverRevisionId !== 'string' ||
      !UUID_V4.test(lookup.receiverRevisionId) ||
      typeof lookup.receiverVersion !== 'number' ||
      !Number.isSafeInteger(lookup.receiverVersion) ||
      lookup.receiverVersion < 1 ||
      typeof lookup.receiverProfileDigest !== 'string' ||
      !DIGEST.test(lookup.receiverProfileDigest) ||
      typeof lookup.expectedReceiverNameDigest !== 'string' ||
      !DIGEST.test(lookup.expectedReceiverNameDigest) ||
      typeof lookup.deviceId !== 'string' ||
      !OPAQUE_ID.test(lookup.deviceId) ||
      typeof lookup.keyId !== 'string' ||
      !OPAQUE_ID.test(lookup.keyId) ||
      typeof lookup.challengeId !== 'string' ||
      !UUID_V4.test(lookup.challengeId) ||
      typeof lookup.challengeDigest !== 'string' ||
      !DIGEST.test(lookup.challengeDigest) ||
      !utc(lookup.issuedAt) ||
      !utc(lookup.expiresAt) ||
      typeof enrollment.deviceId !== 'string' ||
      !OPAQUE_ID.test(enrollment.deviceId) ||
      typeof enrollment.keyId !== 'string' ||
      !OPAQUE_ID.test(enrollment.keyId) ||
      typeof enrollment.publicKeySpkiSha256 !== 'string' ||
      !DIGEST.test(enrollment.publicKeySpkiSha256) ||
      typeof enrollment.state !== 'string' ||
      !['active', 'revoked'].includes(enrollment.state) ||
      !utc(enrollment.validFrom) ||
      !utc(enrollment.validUntil) ||
      typeof enrollment.receiverRevisionId !== 'string' ||
      !UUID_V4.test(enrollment.receiverRevisionId) ||
      typeof enrollment.receiverVersion !== 'number' ||
      !Number.isSafeInteger(enrollment.receiverVersion) ||
      enrollment.receiverVersion < 1 ||
      typeof enrollment.receiverProfileDigest !== 'string' ||
      !DIGEST.test(enrollment.receiverProfileDigest) ||
      envelope.transcriptVersion !==
        (originVersion(body)
          ? ROUTINE_TELEBIRR_ORIGIN_OBSERVATION_TRANSCRIPT_VERSION
          : ROUTINE_TELEBIRR_OBSERVATION_TRANSCRIPT_VERSION) ||
      envelope.bodyDigestAlgorithm !== 'sha256' ||
      typeof envelope.bodyDigest !== 'string' ||
      !DIGEST.test(envelope.bodyDigest) ||
      envelope.signatureAlgorithm !== 'ecdsa-p256-sha256' ||
      envelope.signatureEncoding !== 'ieee-p1363-base64url' ||
      typeof envelope.signature !== 'string' ||
      !P1363.test(envelope.signature) ||
      Buffer.from(envelope.signature, 'base64url').toString('base64url') !== envelope.signature
    )
      return result('would_review', 'invalid_request');

    const assessed = Date.parse(input.assessedAt);
    const issued = Date.parse(lookup.issuedAt);
    const expires = Date.parse(lookup.expiresAt);
    const observed = Date.parse(body.observedAt as string);
    if (
      enrollment.state !== 'active' ||
      assessed < Date.parse(enrollment.validFrom) ||
      assessed >= Date.parse(enrollment.validUntil) ||
      issued < Date.parse(enrollment.validFrom) ||
      expires > Date.parse(enrollment.validUntil) ||
      observed < Date.parse(enrollment.validFrom) ||
      observed >= Date.parse(enrollment.validUntil)
    )
      return result('would_review', 'device_revoked_or_expired');

    const publicKey = parsePublicKey(enrolledDeviceSpkiDerCandidate);
    if (!publicKey || digest(publicKey.der) !== enrollment.publicKeySpkiSha256) {
      return result('would_review', 'device_key_mismatch');
    }
    if (
      lookup.candidateId !== body.candidateId ||
      lookup.referenceFingerprint !== body.referenceFingerprint ||
      lookup.receiverRevisionId !== body.receiverRevisionId ||
      lookup.receiverVersion !== body.receiverVersion ||
      lookup.receiverProfileDigest !== body.receiverProfileDigest ||
      lookup.expectedReceiverNameDigest !== body.expectedReceiverNameDigest ||
      lookup.deviceId !== body.deviceId ||
      lookup.keyId !== body.keyId ||
      lookup.challengeId !== body.challengeId ||
      lookup.challengeDigest !== body.challengeDigest ||
      enrollment.deviceId !== body.deviceId ||
      enrollment.keyId !== body.keyId ||
      enrollment.receiverRevisionId !== body.receiverRevisionId ||
      enrollment.receiverVersion !== body.receiverVersion ||
      enrollment.receiverProfileDigest !== body.receiverProfileDigest
    )
      return result('would_review', 'binding_mismatch');

    if (
      issued < Date.parse(lookup.submittedAt) ||
      expires <= issued ||
      expires - issued > MAX_LOOKUP_LEASE_MS ||
      assessed < issued ||
      assessed >= expires
    )
      return result('would_review', 'lookup_expired');
    if (observed < issued || observed >= expires || observed > assessed) {
      return result('would_review', 'observation_time_invalid');
    }
    if (digestRoutineTelebirrObservationFacts(body.facts) !== body.normalizedFactsDigest) {
      return result('would_review', 'facts_digest_mismatch');
    }
    const bodyDigest = digestRoutineTelebirrObservationBody(body);
    if (bodyDigest !== envelope.bodyDigest) return result('would_review', 'body_digest_mismatch');
    const transcript = canonicalRoutineTelebirrObservationSignatureBytes(body);
    if (
      !transcript ||
      !verifySignature(
        'sha256',
        transcript,
        {
          key: publicKey.key,
          dsaEncoding: 'ieee-p1363',
        },
        Buffer.from(envelope.signature, 'base64url'),
      )
    ) {
      return result('would_review', 'signature_invalid');
    }

    const replayIdentity = digest(
      encode('telebirr-routine-observation-replay-v1', [
        lookup.candidateId,
        lookup.challengeId,
        bodyDigest,
      ]),
    );
    const facts = body.facts as Facts;
    const assessment = assessRoutineTelebirrObservedReceiptFacts({
      assessedAt: input.assessedAt,
      candidate: {
        providerCode: 'telebirr',
        referenceFingerprint: lookup.referenceFingerprint,
        referenceKeyVersion: lookup.referenceKeyVersion,
        referenceProfileVersion: lookup.referenceProfileVersion,
        submittedAt: lookup.submittedAt,
      },
      expectedReceiverNameDigest: lookup.expectedReceiverNameDigest,
      expectedReceiverProfileDigest: lookup.receiverProfileDigest,
      expectedReceiverRevisionId: lookup.receiverRevisionId,
      observation: {
        ...Object.fromEntries(factsKeys.map((key) => [key, facts[key]])),
        providerCode: 'telebirr',
        receiverProfileDigest: body.receiverProfileDigest,
        receiverRevisionId: body.receiverRevisionId,
        referenceFingerprint: body.referenceFingerprint,
        observedAt: body.observedAt,
      },
    });
    if (assessment.disposition !== 'would_match_observed_facts') {
      return result(
        'would_review',
        'receipt_policy_review',
        true,
        replayIdentity,
        originVersion(body),
      );
    }
    return result(
      'would_forward_signed_observation',
      'signed_observation_matches_policy',
      true,
      replayIdentity,
      originVersion(body),
    );
  } catch {
    return result('would_review', 'invalid_request');
  }
}
