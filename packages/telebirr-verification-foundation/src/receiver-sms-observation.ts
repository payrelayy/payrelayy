import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
} from './exact-data-record.js';

export const RECEIVER_SMS_PROTOCOL_MODE = 'direct_receiver_sms_v1' as const;
export const RECEIVER_SMS_SOURCE_PROFILE = 'direct_receiver_sms_v1' as const;
const BODY_DOMAIN = 'fetanagent:receiver-sms-observation-body:v1';
const SIGNATURE_DOMAIN = 'fetanagent:receiver-sms-observation-signature:v1';
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const BODY_KEYS = [
  'contractVersion',
  'protocolMode',
  'sourceProfile',
  'providerCode',
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
  'sourceSubscriptionId',
  'sourceMessageDigest',
  'amountMinor',
  'currencyCode',
  'occurredAt',
  'receivedAt',
  'observedAt',
] as const;
const ENVELOPE_KEYS = [
  'contractVersion',
  'protocolMode',
  'bodyDigest',
  'body',
  'signature',
] as const;
const ASSIGNMENT_KEYS = [
  'providerCode',
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
  'sourceSubscriptionId',
  'submittedAt',
  'issuedAt',
  'expiresAt',
] as const;
const ENROLLMENT_KEYS = [
  'deviceId',
  'keyId',
  'publicKeySpkiSha256',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'state',
  'validFrom',
  'validUntil',
] as const;
const INPUT_KEYS = [
  'assessedAt',
  'trustedAssignment',
  'trustedEnrollment',
  'signedObservation',
] as const;

export interface ReceiverSmsVerifiedEvidence {
  readonly providerCode: 'telebirr' | 'cbe_birr';
  readonly candidateId: string;
  readonly challengeId: string;
  readonly referenceFingerprint: string;
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly submittedAt: string;
  readonly amountMinor: number;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly observedAt: string;
  readonly sourceMessageDigest: string;
  readonly observationBodyDigest: string;
}

export type ReceiverSmsObservationAssessment =
  | Readonly<{
      disposition: 'review';
      reasonCode: string;
      phoneSignatureVerified: false;
      bankAuthenticationPerformed: false;
      financialActionAllowed: false;
      evidence: null;
    }>
  | Readonly<{
      disposition: 'signed_sms_matches_assignment' | 'old_sms_requires_owner_approval';
      reasonCode: 'signed_sms_match' | 'old_sms';
      phoneSignatureVerified: true;
      bankAuthenticationPerformed: false;
      financialActionAllowed: false;
      evidence: ReceiverSmsVerifiedEvidence;
    }>;

function review(reasonCode: string): ReceiverSmsObservationAssessment {
  return Object.freeze({
    disposition: 'review',
    reasonCode,
    phoneSignatureVerified: false,
    bankAuthenticationPerformed: false,
    financialActionAllowed: false,
    evidence: null,
  });
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  return isPlainNonProxyRecord(value) && hasExactEnumerableDataKeys(value, keys)
    ? value
    : undefined;
}

function utc(value: unknown): value is string {
  return typeof value === 'string' && parseCanonicalUtcTimestamp(value) === value;
}

function provider(value: unknown): value is 'telebirr' | 'cbe_birr' {
  return value === 'telebirr' || value === 'cbe_birr';
}

function validBody(candidate: unknown): Record<string, unknown> | undefined {
  const body = record(candidate, BODY_KEYS);
  if (
    !body ||
    body.contractVersion !== 1 ||
    body.protocolMode !== RECEIVER_SMS_PROTOCOL_MODE ||
    body.sourceProfile !== RECEIVER_SMS_SOURCE_PROFILE ||
    !provider(body.providerCode) ||
    typeof body.candidateId !== 'string' ||
    !UUID.test(body.candidateId) ||
    typeof body.referenceFingerprint !== 'string' ||
    !FINGERPRINT.test(body.referenceFingerprint) ||
    typeof body.receiverRevisionId !== 'string' ||
    !UUID.test(body.receiverRevisionId) ||
    typeof body.receiverVersion !== 'number' ||
    !Number.isSafeInteger(body.receiverVersion) ||
    body.receiverVersion < 1 ||
    typeof body.receiverProfileDigest !== 'string' ||
    !DIGEST.test(body.receiverProfileDigest) ||
    typeof body.expectedReceiverNameDigest !== 'string' ||
    !DIGEST.test(body.expectedReceiverNameDigest) ||
    typeof body.deviceId !== 'string' ||
    !OPAQUE.test(body.deviceId) ||
    typeof body.keyId !== 'string' ||
    !OPAQUE.test(body.keyId) ||
    typeof body.challengeId !== 'string' ||
    !UUID.test(body.challengeId) ||
    typeof body.challengeDigest !== 'string' ||
    !DIGEST.test(body.challengeDigest) ||
    typeof body.sourceSubscriptionId !== 'number' ||
    !Number.isSafeInteger(body.sourceSubscriptionId) ||
    body.sourceSubscriptionId < 0 ||
    typeof body.sourceMessageDigest !== 'string' ||
    !DIGEST.test(body.sourceMessageDigest) ||
    typeof body.amountMinor !== 'number' ||
    !Number.isSafeInteger(body.amountMinor) ||
    body.amountMinor < 1 ||
    body.amountMinor > 9_007_199_254_740_991 ||
    body.currencyCode !== 'ETB' ||
    !utc(body.occurredAt) ||
    !utc(body.receivedAt) ||
    !utc(body.observedAt)
  )
    return undefined;
  return body;
}

export function canonicalReceiverSmsObservationBodyBytes(candidate: unknown): Buffer | undefined {
  const body = validBody(candidate);
  return body
    ? Buffer.from(JSON.stringify([BODY_DOMAIN, ...BODY_KEYS.map((key) => body[key])]), 'utf8')
    : undefined;
}

export function digestReceiverSmsObservationBody(candidate: unknown): string | undefined {
  const body = canonicalReceiverSmsObservationBodyBytes(candidate);
  return body ? `sha256:${createHash('sha256').update(body).digest('hex')}` : undefined;
}

export function canonicalReceiverSmsObservationSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const digest = digestReceiverSmsObservationBody(candidate);
  return digest ? Buffer.from(JSON.stringify([SIGNATURE_DOMAIN, digest]), 'utf8') : undefined;
}

function p256Key(candidate: unknown): { key: KeyObject; digest: string } | undefined {
  try {
    if (
      !(candidate instanceof Uint8Array) ||
      candidate.byteLength < 64 ||
      candidate.byteLength > 512
    )
      return undefined;
    const der = Buffer.from(candidate);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      return undefined;
    return { key, digest: `sha256:${createHash('sha256').update(der).digest('hex')}` };
  } catch {
    return undefined;
  }
}

/** A phone signature is an assertion by the paired device, not proof of SMS bank authorship. */
export function verifyReceiverSmsObservation(
  candidate: unknown,
  enrolledDeviceSpkiDer: unknown,
): ReceiverSmsObservationAssessment {
  try {
    const input = record(candidate, INPUT_KEYS);
    const assignment = input && record(ownDataValue(input, 'trustedAssignment'), ASSIGNMENT_KEYS);
    const enrollment = input && record(ownDataValue(input, 'trustedEnrollment'), ENROLLMENT_KEYS);
    const envelope = input && record(ownDataValue(input, 'signedObservation'), ENVELOPE_KEYS);
    const body = envelope && validBody(envelope.body);
    const key = p256Key(enrolledDeviceSpkiDer);
    if (
      !input ||
      !assignment ||
      !enrollment ||
      !envelope ||
      !body ||
      !key ||
      !utc(input.assessedAt) ||
      envelope.contractVersion !== 1 ||
      envelope.protocolMode !== RECEIVER_SMS_PROTOCOL_MODE ||
      typeof envelope.bodyDigest !== 'string' ||
      !DIGEST.test(envelope.bodyDigest) ||
      typeof envelope.signature !== 'string' ||
      !SIGNATURE.test(envelope.signature) ||
      !provider(assignment.providerCode) ||
      !utc(assignment.submittedAt) ||
      !utc(assignment.issuedAt) ||
      !utc(assignment.expiresAt) ||
      !utc(enrollment.validFrom) ||
      !utc(enrollment.validUntil)
    )
      return review('invalid_request');
    if (
      enrollment.state !== 'active' ||
      key.digest !== enrollment.publicKeySpkiSha256 ||
      input.assessedAt < enrollment.validFrom ||
      input.assessedAt >= enrollment.validUntil
    )
      return review('device_unavailable');
    for (const field of [
      'providerCode',
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
      'sourceSubscriptionId',
    ] as const) {
      if (body[field] !== assignment[field]) return review('assignment_mismatch');
    }
    for (const field of [
      'deviceId',
      'keyId',
      'receiverRevisionId',
      'receiverVersion',
      'receiverProfileDigest',
    ] as const) {
      if (body[field] !== enrollment[field]) return review('enrollment_mismatch');
    }
    const assessed = Date.parse(input.assessedAt);
    const submitted = Date.parse(assignment.submittedAt);
    const issued = Date.parse(assignment.issuedAt);
    const expires = Date.parse(assignment.expiresAt);
    const occurred = Date.parse(body.occurredAt as string);
    const received = Date.parse(body.receivedAt as string);
    const observed = Date.parse(body.observedAt as string);
    if (
      issued > observed ||
      observed >= expires ||
      expires - issued > 5 * 60_000 ||
      assessed < observed - 5_000 ||
      assessed > observed + 15 * 60_000 ||
      occurred > received + 5 * 60_000 ||
      received > observed + 5 * 60_000 ||
      occurred > submitted + 5 * 60_000
    )
      return review('time_mismatch');
    const digest = digestReceiverSmsObservationBody(body);
    if (!digest || envelope.bodyDigest !== digest) return review('body_digest_mismatch');
    const signatureBytes = Buffer.from(envelope.signature, 'base64url');
    if (
      signatureBytes.length !== 64 ||
      signatureBytes.toString('base64url') !== envelope.signature ||
      !verify(
        'sha256',
        canonicalReceiverSmsObservationSignatureBytes(body)!,
        { key: key.key, dsaEncoding: 'ieee-p1363' },
        signatureBytes,
      )
    )
      return review('signature_invalid');
    const evidence: ReceiverSmsVerifiedEvidence = Object.freeze({
      providerCode: body.providerCode as 'telebirr' | 'cbe_birr',
      candidateId: body.candidateId as string,
      challengeId: body.challengeId as string,
      referenceFingerprint: body.referenceFingerprint as string,
      receiverRevisionId: body.receiverRevisionId as string,
      receiverVersion: body.receiverVersion as number,
      submittedAt: assignment.submittedAt as string,
      amountMinor: body.amountMinor as number,
      occurredAt: body.occurredAt as string,
      receivedAt: body.receivedAt as string,
      observedAt: body.observedAt as string,
      sourceMessageDigest: body.sourceMessageDigest as string,
      observationBodyDigest: digest,
    });
    return Object.freeze({
      disposition:
        occurred < submitted - 60 * 60_000
          ? 'old_sms_requires_owner_approval'
          : 'signed_sms_matches_assignment',
      reasonCode: occurred < submitted - 60 * 60_000 ? 'old_sms' : 'signed_sms_match',
      phoneSignatureVerified: true,
      bankAuthenticationPerformed: false,
      financialActionAllowed: false,
      evidence,
    });
  } catch {
    return review('invalid_request');
  }
}
