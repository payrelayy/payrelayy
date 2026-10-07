import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
  type UnknownRecord,
} from './exact-data-record.js';

/** A phone-signed request to look for no-money work, not permission to issue a lookup. */
export const ROUTINE_NO_MONEY_POLL_MODE = 'routine_no_money_poll_v1' as const;
export const ROUTINE_NO_MONEY_POLL_TRANSCRIPT =
  'telebirr-routine-no-money-poll-transcript-v1' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MAX_REQUEST_MS = 60_000;
const BODY_KEYS = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'enrollmentId',
  'deviceId',
  'keyId',
  'receiverRevisionId',
  'receiverProfileDigest',
  'requestId',
  'issuedAt',
  'expiresAt',
  'evidenceOnly',
  'financialActionAllowed',
] as const;
const ENVELOPE_KEYS = [
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
const ENROLLMENT_KEYS = [
  'enrollmentId',
  'deviceId',
  'keyId',
  'publicKeySpkiSha256',
  'state',
  'validFrom',
  'validUntil',
  'receiverRevisionId',
  'receiverProfileDigest',
] as const;

export interface RoutineNoMoneyPollAssessment {
  readonly advisoryOnly: true;
  readonly deviceSignatureVerified: boolean;
  readonly databaseBindingPerformed: false;
  readonly pollAuthorized: false;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_consider_no_money_poll';
  readonly reasonCode:
    | 'invalid_request'
    | 'device_unavailable'
    | 'binding_mismatch'
    | 'request_expired'
    | 'signature_invalid'
    | 'signed_request_matches_enrollment';
  /** Advisory only. The caller must atomically enforce one-use request IDs. */
  readonly replayIdentity: string | null;
}

function result(
  disposition: RoutineNoMoneyPollAssessment['disposition'],
  reasonCode: RoutineNoMoneyPollAssessment['reasonCode'],
  deviceSignatureVerified = false,
  replayIdentity: string | null = null,
): RoutineNoMoneyPollAssessment {
  return Object.freeze({
    advisoryOnly: true,
    deviceSignatureVerified,
    databaseBindingPerformed: false,
    pollAuthorized: false,
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

function encode(
  domain: string,
  fields: readonly (readonly [string, string | number | boolean])[],
): Buffer {
  const values = [domain, String(fields.length)];
  for (const [name, value] of fields) values.push(name, `${typeof value}:${value}`);
  const chunks: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function body(candidate: unknown): UnknownRecord | undefined {
  const value = record(candidate, BODY_KEYS);
  if (
    !value ||
    value.contractVersion !== 1 ||
    value.providerCode !== 'telebirr' ||
    value.protocolMode !== ROUTINE_NO_MONEY_POLL_MODE ||
    typeof value.enrollmentId !== 'string' ||
    !UUID_V4.test(value.enrollmentId) ||
    typeof value.deviceId !== 'string' ||
    !OPAQUE_ID.test(value.deviceId) ||
    typeof value.keyId !== 'string' ||
    !OPAQUE_ID.test(value.keyId) ||
    typeof value.receiverRevisionId !== 'string' ||
    !UUID_V4.test(value.receiverRevisionId) ||
    typeof value.receiverProfileDigest !== 'string' ||
    !DIGEST.test(value.receiverProfileDigest) ||
    typeof value.requestId !== 'string' ||
    !UUID_V4.test(value.requestId) ||
    !utc(value.issuedAt) ||
    !utc(value.expiresAt) ||
    value.evidenceOnly !== true ||
    value.financialActionAllowed !== false
  )
    return undefined;
  return value;
}

export function canonicalRoutineNoMoneyPollBodyBytes(candidate: unknown): Buffer | undefined {
  try {
    const value = body(candidate);
    return (
      value &&
      encode(
        'fetanagent:telebirr:routine:no-money-poll-body:v1',
        BODY_KEYS.map((key) => [key, value[key] as string | number | boolean]),
      )
    );
  } catch {
    return undefined;
  }
}

export function digestRoutineNoMoneyPollBody(candidate: unknown): string | undefined {
  const bytes = canonicalRoutineNoMoneyPollBodyBytes(candidate);
  return bytes && digest(bytes);
}

export function canonicalRoutineNoMoneyPollSignatureBytes(candidate: unknown): Buffer | undefined {
  const bodyDigest = digestRoutineNoMoneyPollBody(candidate);
  return bodyDigest
    ? encode(ROUTINE_NO_MONEY_POLL_TRANSCRIPT, [['bodyDigest', bodyDigest]])
    : undefined;
}

/** The enrollment, key, replay ledger, and no-money switch must be loaded independently. */
export function verifyRoutineNoMoneyPollRequest(
  requestCandidate: unknown,
  enrollmentCandidate: unknown,
  enrolledDeviceSpkiDer: unknown,
  assessedAt: unknown,
): RoutineNoMoneyPollAssessment {
  try {
    const request = record(requestCandidate, ENVELOPE_KEYS);
    const requestBody = request && body(request.body);
    const enrollment = record(enrollmentCandidate, ENROLLMENT_KEYS);
    if (
      !request ||
      !requestBody ||
      !enrollment ||
      !utc(assessedAt) ||
      request.contractVersion !== 1 ||
      request.providerCode !== 'telebirr' ||
      request.protocolMode !== ROUTINE_NO_MONEY_POLL_MODE ||
      request.transcriptVersion !== ROUTINE_NO_MONEY_POLL_TRANSCRIPT ||
      request.bodyDigestAlgorithm !== 'sha256' ||
      typeof request.bodyDigest !== 'string' ||
      !DIGEST.test(request.bodyDigest) ||
      request.signatureAlgorithm !== 'ecdsa-p256-sha256' ||
      request.signatureEncoding !== 'ieee-p1363-base64url' ||
      typeof request.signature !== 'string' ||
      !SIGNATURE.test(request.signature) ||
      Buffer.from(request.signature, 'base64url').toString('base64url') !== request.signature ||
      typeof enrollment.enrollmentId !== 'string' ||
      !UUID_V4.test(enrollment.enrollmentId) ||
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
      typeof enrollment.receiverProfileDigest !== 'string' ||
      !DIGEST.test(enrollment.receiverProfileDigest)
    )
      return result('would_review', 'invalid_request');

    if (
      enrollment.state !== 'active' ||
      assessedAt < enrollment.validFrom ||
      assessedAt >= enrollment.validUntil ||
      (requestBody.issuedAt as string) < enrollment.validFrom ||
      (requestBody.expiresAt as string) > enrollment.validUntil
    )
      return result('would_review', 'device_unavailable');
    if (
      requestBody.enrollmentId !== enrollment.enrollmentId ||
      requestBody.deviceId !== enrollment.deviceId ||
      requestBody.keyId !== enrollment.keyId ||
      requestBody.receiverRevisionId !== enrollment.receiverRevisionId ||
      requestBody.receiverProfileDigest !== enrollment.receiverProfileDigest
    )
      return result('would_review', 'binding_mismatch');
    const issued = Date.parse(requestBody.issuedAt as string);
    const expires = Date.parse(requestBody.expiresAt as string);
    const assessed = Date.parse(assessedAt);
    if (
      expires <= issued ||
      expires - issued > MAX_REQUEST_MS ||
      assessed < issued ||
      assessed >= expires
    ) {
      return result('would_review', 'request_expired');
    }
    if (
      !(enrolledDeviceSpkiDer instanceof Uint8Array) ||
      isProxy(enrolledDeviceSpkiDer) ||
      enrolledDeviceSpkiDer.byteLength < 64 ||
      enrolledDeviceSpkiDer.byteLength > 512
    )
      return result('would_review', 'device_unavailable');
    const der = Buffer.from(enrolledDeviceSpkiDer);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !Buffer.from(key.export({ format: 'der', type: 'spki' })).equals(der) ||
      digest(der) !== enrollment.publicKeySpkiSha256
    )
      return result('would_review', 'device_unavailable');
    if (digestRoutineNoMoneyPollBody(requestBody) !== request.bodyDigest) {
      return result('would_review', 'signature_invalid');
    }
    const transcript = canonicalRoutineNoMoneyPollSignatureBytes(requestBody);
    if (
      !transcript ||
      !verifySignature(
        'sha256',
        transcript,
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(request.signature, 'base64url'),
      )
    )
      return result('would_review', 'signature_invalid');

    const replayIdentity = digest(
      encode('fetanagent:telebirr:routine:no-money-poll-replay:v1', [
        ['enrollmentId', enrollment.enrollmentId as string],
        ['requestId', requestBody.requestId as string],
      ]),
    );
    return result(
      'would_consider_no_money_poll',
      'signed_request_matches_enrollment',
      true,
      replayIdentity,
    );
  } catch {
    return result('would_review', 'invalid_request');
  }
}
