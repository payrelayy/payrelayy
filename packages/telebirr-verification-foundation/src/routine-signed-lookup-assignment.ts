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
import { normalizeTelebirrCreditedPartyFullName } from './live-private-pilot-protocol.js';
import { TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE } from './synthetic-official-receipt.js';

/** A signed lookup request only. It cannot assert that a payment exists or claim one. */
export const ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_CONTRACT_VERSION = 1 as const;
export const ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE =
  'routine_signed_observation_v1' as const;
export const ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION =
  'telebirr-routine-lookup-assignment-transcript-v1' as const;
export const ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION =
  'telebirr-credited-party-name-normalizer-v1' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const REFERENCE = /^[A-Z0-9]{8,32}$/u;
const P1363 = /^[A-Za-z0-9_-]{86}$/u;
const MAX_SPKI_BYTES = 512;
const MAX_LOOKUP_LEASE_MS = 5 * 60 * 1_000;

const bodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'candidateId',
  'rawReference',
  'referenceFingerprint',
  'referenceKeyVersion',
  'referenceProfileVersion',
  'submittedAt',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'receiverNameNormalizerVersion',
  'expectedReceiverNameNormalized',
  'expectedReceiverNameDigest',
  'deviceId',
  'keyId',
  'challengeId',
  'challengeDigest',
  'sourceProfile',
  'issuedAt',
  'expiresAt',
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
  'signerKeyId',
  'body',
  'signature',
] as const;
const signerKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'signerKeyId',
  'publicKeySpkiSha256',
  'state',
  'validFrom',
  'validUntil',
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
const inputKeys = [
  'assessedAt',
  'trustedSigner',
  'deviceEnrollment',
  'localDevicePublicKeySpkiDer',
  'signedAssignment',
] as const;

type AssignmentBody = { readonly [K in (typeof bodyKeys)[number]]: unknown };
type Scalar = string | number;
type Field = readonly [name: string, value: Scalar];

export interface RoutineTelebirrLookupAssignmentResult {
  readonly advisoryOnly: true;
  readonly serverSignatureVerified: boolean;
  readonly candidateDatabaseBindingPerformed: false;
  readonly databaseWriteAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_accept_signed_assignment';
  readonly reasonCode:
    | 'invalid_request'
    | 'signer_revoked_or_expired'
    | 'signer_key_mismatch'
    | 'device_key_mismatch'
    | 'device_revoked_or_expired'
    | 'device_binding_mismatch'
    | 'lookup_expired'
    | 'body_digest_mismatch'
    | 'signature_invalid'
    | 'signed_assignment_matches_binding';
}

function result(
  disposition: RoutineTelebirrLookupAssignmentResult['disposition'],
  reasonCode: RoutineTelebirrLookupAssignmentResult['reasonCode'],
  serverSignatureVerified = false,
): RoutineTelebirrLookupAssignmentResult {
  return Object.freeze({
    advisoryOnly: true,
    serverSignatureVerified,
    candidateDatabaseBindingPerformed: false,
    databaseWriteAllowed: false,
    claimAllowed: false,
    settlementAllowed: false,
    enqueueAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    disposition,
    reasonCode,
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
    value.contractVersion === ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_CONTRACT_VERSION &&
    value.providerCode === 'telebirr' &&
    value.protocolMode === ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE
  );
}

/** Length-prefixed UTF-8 fields, including each scalar's type, for cross-runtime signing. */
function encodeLengthPrefixedValues(values: readonly string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function encodeFields(domain: string, fields: readonly Field[]): Buffer {
  const values = [domain, String(fields.length)];
  for (const [name, value] of fields) {
    values.push(name, `${typeof value}:${value}`);
  }
  return encodeLengthPrefixedValues(values);
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Domain-separated from pilot names; caller must never log the normalized name. */
export function digestRoutineTelebirrReceiverName(value: unknown): string | undefined {
  const normalized = normalizeTelebirrCreditedPartyFullName(value);
  return normalized
    ? digest(
        encodeFields('fetanagent:telebirr:routine:receiver-name:v1', [
          ['normalizerVersion', ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION],
          ['normalizedName', normalized],
        ]),
      )
    : undefined;
}

/** Matches the database's five-field routine receiver-revision digest exactly. */
export function digestRoutineTelebirrReceiverProfile(inputCandidate: unknown): string | undefined {
  try {
    const value = record(inputCandidate, [
      'receiverRevisionId',
      'receiverVersion',
      'receiverReferenceFingerprint',
      'receiverName',
    ]);
    if (
      !value ||
      typeof value.receiverRevisionId !== 'string' ||
      !UUID_V4.test(value.receiverRevisionId) ||
      typeof value.receiverVersion !== 'number' ||
      !Number.isSafeInteger(value.receiverVersion) ||
      value.receiverVersion < 1 ||
      typeof value.receiverReferenceFingerprint !== 'string' ||
      !FINGERPRINT.test(value.receiverReferenceFingerprint)
    ) {
      return undefined;
    }
    const nameDigest = digestRoutineTelebirrReceiverName(value.receiverName);
    return nameDigest
      ? digest(
          encodeLengthPrefixedValues([
            'fetanagent:telebirr:routine:receiver-profile:v1',
            value.receiverRevisionId,
            String(value.receiverVersion),
            value.receiverReferenceFingerprint,
            nameDigest,
          ]),
        )
      : undefined;
  } catch {
    return undefined;
  }
}

function parseBody(value: unknown): AssignmentBody | undefined {
  const body = record(value, bodyKeys);
  if (
    !body ||
    !header(body) ||
    typeof body.candidateId !== 'string' ||
    !UUID_V4.test(body.candidateId) ||
    typeof body.rawReference !== 'string' ||
    !REFERENCE.test(body.rawReference) ||
    typeof body.referenceFingerprint !== 'string' ||
    !FINGERPRINT.test(body.referenceFingerprint) ||
    body.referenceKeyVersion !== 2 ||
    body.referenceProfileVersion !== 2 ||
    !utc(body.submittedAt) ||
    typeof body.receiverRevisionId !== 'string' ||
    !UUID_V4.test(body.receiverRevisionId) ||
    typeof body.receiverVersion !== 'number' ||
    !Number.isSafeInteger(body.receiverVersion) ||
    body.receiverVersion < 1 ||
    typeof body.receiverProfileDigest !== 'string' ||
    !DIGEST.test(body.receiverProfileDigest) ||
    body.receiverNameNormalizerVersion !== ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION ||
    typeof body.expectedReceiverNameNormalized !== 'string' ||
    normalizeTelebirrCreditedPartyFullName(body.expectedReceiverNameNormalized) !==
      body.expectedReceiverNameNormalized ||
    body.expectedReceiverNameDigest !==
      digestRoutineTelebirrReceiverName(body.expectedReceiverNameNormalized) ||
    typeof body.deviceId !== 'string' ||
    !OPAQUE_ID.test(body.deviceId) ||
    typeof body.keyId !== 'string' ||
    !OPAQUE_ID.test(body.keyId) ||
    typeof body.challengeId !== 'string' ||
    !UUID_V4.test(body.challengeId) ||
    typeof body.challengeDigest !== 'string' ||
    !DIGEST.test(body.challengeDigest) ||
    body.sourceProfile !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
    !utc(body.issuedAt) ||
    !utc(body.expiresAt)
  ) {
    return undefined;
  }
  return body as AssignmentBody;
}

/** Deterministic body transcript for a future protected server signer and Android verifier. */
export function canonicalRoutineTelebirrLookupAssignmentBodyBytes(
  value: unknown,
): Buffer | undefined {
  try {
    const body = parseBody(value);
    if (!body) return undefined;
    return encodeFields(
      'fetanagent:telebirr:routine:lookup-assignment-body:v1',
      bodyKeys.map((key) => [key, body[key] as Scalar]),
    );
  } catch {
    return undefined;
  }
}

export function digestRoutineTelebirrLookupAssignmentBody(value: unknown): string | undefined {
  const bytes = canonicalRoutineTelebirrLookupAssignmentBodyBytes(value);
  return bytes && digest(bytes);
}

export function canonicalRoutineTelebirrLookupAssignmentSignatureBytes(
  value: unknown,
): Buffer | undefined {
  const bodyDigest = digestRoutineTelebirrLookupAssignmentBody(value);
  return bodyDigest
    ? encodeFields(ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION, [
        ['bodyDigest', bodyDigest],
      ])
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
 * Checks a server signature and local routine enrollment binding, never the provider or database truth.
 * The signer key and enrollment must come from separate protected trust stores. The server must
 * separately bind the decrypted candidate, raw reference, receiver revision, and one-use challenge
 * to trusted database rows before issuing an assignment. No pilot enrollment can be substituted.
 */
export function verifyRoutineTelebirrSignedLookupAssignment(
  inputCandidate: unknown,
  trustedSignerSpkiDerCandidate: unknown,
): RoutineTelebirrLookupAssignmentResult {
  try {
    const input = record(inputCandidate, inputKeys);
    const signer = input && record(input.trustedSigner, signerKeys);
    const enrollment = input && record(input.deviceEnrollment, enrollmentKeys);
    const envelope = input && record(input.signedAssignment, envelopeKeys);
    const body = envelope && parseBody(envelope.body);
    if (
      !input ||
      !signer ||
      !enrollment ||
      !envelope ||
      !body ||
      !utc(input.assessedAt) ||
      !header(signer) ||
      !header(enrollment) ||
      !header(envelope) ||
      typeof signer.signerKeyId !== 'string' ||
      !OPAQUE_ID.test(signer.signerKeyId) ||
      typeof signer.publicKeySpkiSha256 !== 'string' ||
      !DIGEST.test(signer.publicKeySpkiSha256) ||
      !['active', 'revoked'].includes(signer.state as string) ||
      !utc(signer.validFrom) ||
      !utc(signer.validUntil) ||
      typeof enrollment.deviceId !== 'string' ||
      !OPAQUE_ID.test(enrollment.deviceId) ||
      typeof enrollment.keyId !== 'string' ||
      !OPAQUE_ID.test(enrollment.keyId) ||
      typeof enrollment.publicKeySpkiSha256 !== 'string' ||
      !DIGEST.test(enrollment.publicKeySpkiSha256) ||
      !['active', 'revoked'].includes(enrollment.state as string) ||
      !utc(enrollment.validFrom) ||
      !utc(enrollment.validUntil) ||
      typeof enrollment.receiverRevisionId !== 'string' ||
      !UUID_V4.test(enrollment.receiverRevisionId) ||
      typeof enrollment.receiverVersion !== 'number' ||
      !Number.isSafeInteger(enrollment.receiverVersion) ||
      enrollment.receiverVersion < 1 ||
      typeof enrollment.receiverProfileDigest !== 'string' ||
      !DIGEST.test(enrollment.receiverProfileDigest) ||
      envelope.transcriptVersion !== ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION ||
      envelope.bodyDigestAlgorithm !== 'sha256' ||
      typeof envelope.bodyDigest !== 'string' ||
      !DIGEST.test(envelope.bodyDigest) ||
      envelope.signatureAlgorithm !== 'ecdsa-p256-sha256' ||
      envelope.signatureEncoding !== 'ieee-p1363-base64url' ||
      typeof envelope.signerKeyId !== 'string' ||
      !OPAQUE_ID.test(envelope.signerKeyId) ||
      typeof envelope.signature !== 'string' ||
      !P1363.test(envelope.signature) ||
      Buffer.from(envelope.signature, 'base64url').toString('base64url') !== envelope.signature
    ) {
      return result('would_review', 'invalid_request');
    }

    const assessed = Date.parse(input.assessedAt);
    const issued = Date.parse(body.issuedAt as string);
    const expires = Date.parse(body.expiresAt as string);
    if (
      signer.state !== 'active' ||
      assessed < Date.parse(signer.validFrom) ||
      assessed >= Date.parse(signer.validUntil) ||
      issued < Date.parse(signer.validFrom) ||
      expires > Date.parse(signer.validUntil)
    ) {
      return result('would_review', 'signer_revoked_or_expired');
    }
    const publicKey = parsePublicKey(trustedSignerSpkiDerCandidate);
    if (!publicKey || digest(publicKey.der) !== signer.publicKeySpkiSha256) {
      return result('would_review', 'signer_key_mismatch');
    }
    const localDeviceKey = parsePublicKey(input.localDevicePublicKeySpkiDer);
    if (!localDeviceKey || digest(localDeviceKey.der) !== enrollment.publicKeySpkiSha256) {
      return result('would_review', 'device_key_mismatch');
    }
    if (
      signer.signerKeyId !== envelope.signerKeyId ||
      enrollment.deviceId !== body.deviceId ||
      enrollment.keyId !== body.keyId ||
      enrollment.receiverRevisionId !== body.receiverRevisionId ||
      enrollment.receiverVersion !== body.receiverVersion ||
      enrollment.receiverProfileDigest !== body.receiverProfileDigest
    ) {
      return result('would_review', 'device_binding_mismatch');
    }
    if (
      enrollment.state !== 'active' ||
      assessed < Date.parse(enrollment.validFrom) ||
      assessed >= Date.parse(enrollment.validUntil) ||
      issued < Date.parse(enrollment.validFrom) ||
      expires > Date.parse(enrollment.validUntil)
    ) {
      return result('would_review', 'device_revoked_or_expired');
    }
    if (
      issued < Date.parse(body.submittedAt as string) ||
      expires <= issued ||
      expires - issued > MAX_LOOKUP_LEASE_MS ||
      assessed < issued ||
      assessed >= expires
    ) {
      return result('would_review', 'lookup_expired');
    }
    if (digestRoutineTelebirrLookupAssignmentBody(body) !== envelope.bodyDigest) {
      return result('would_review', 'body_digest_mismatch');
    }
    const transcript = canonicalRoutineTelebirrLookupAssignmentSignatureBytes(body);
    if (
      !transcript ||
      !verifySignature(
        'sha256',
        transcript,
        { key: publicKey.key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(envelope.signature, 'base64url'),
      )
    ) {
      return result('would_review', 'signature_invalid');
    }
    return result('would_accept_signed_assignment', 'signed_assignment_matches_binding', true);
  } catch {
    return result('would_review', 'invalid_request');
  }
}
