import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
} from './exact-data-record.js';

export const RECEIVER_SMS_PROTOCOL_MODE = 'direct_receiver_sms_event_v1' as const;
const BODY_DOMAIN = 'fetanagent:receiver-sms-event-body:v1';
const SIGNATURE_DOMAIN = 'fetanagent:receiver-sms-event-signature:v1';
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const BODY_KEYS = [
  'contractVersion',
  'protocolMode',
  'deviceId',
  'keyId',
  'sourceSubscriptionId',
  'sourceMessageDigest',
  'providerCode',
  'transactionReference',
  'amountMinor',
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
const ENROLLMENT_KEYS = [
  'deviceId',
  'keyId',
  'publicKeySpkiSha256',
  'state',
  'validFrom',
  'validUntil',
] as const;
const INPUT_KEYS = ['assessedAt', 'trustedEnrollment', 'signedEvent'] as const;

export interface ReceiverSmsVerifiedEvent {
  readonly deviceId: string;
  readonly keyId: string;
  readonly sourceSubscriptionId: number;
  readonly receivedAt: string;
  readonly observedAt: string;
  readonly sourceMessageDigest: string;
  readonly eventBodyDigest: string;
}

export interface ReceiverSmsVerifiedPayment {
  readonly providerCode: 'telebirr' | 'cbe_birr';
  readonly transactionReference: string;
  readonly amountMinor: number;
  readonly occurredAt: string;
}

export type ReceiverSmsEventAssessment =
  | Readonly<{
      disposition: 'review';
      reasonCode: string;
      phoneSignatureVerified: false;
      bankAuthenticationPerformed: false;
      financialActionAllowed: false;
      event: null;
    }>
  | Readonly<{
      disposition: 'verified_phone_sms';
      reasonCode: 'signed_inbox_message';
      phoneSignatureVerified: true;
      bankAuthenticationPerformed: false;
      financialActionAllowed: false;
      event: ReceiverSmsVerifiedEvent;
    }>;

function review(reasonCode: string): ReceiverSmsEventAssessment {
  return Object.freeze({
    disposition: 'review',
    reasonCode,
    phoneSignatureVerified: false,
    bankAuthenticationPerformed: false,
    financialActionAllowed: false,
    event: null,
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

function validBody(candidate: unknown): Record<string, unknown> | undefined {
  const body = record(candidate, BODY_KEYS);
  if (
    !body ||
    body.contractVersion !== 1 ||
    body.protocolMode !== RECEIVER_SMS_PROTOCOL_MODE ||
    typeof body.deviceId !== 'string' ||
    !OPAQUE.test(body.deviceId) ||
    typeof body.keyId !== 'string' ||
    !OPAQUE.test(body.keyId) ||
    typeof body.sourceSubscriptionId !== 'number' ||
    !Number.isSafeInteger(body.sourceSubscriptionId) ||
    body.sourceSubscriptionId < -1 ||
    typeof body.sourceMessageDigest !== 'string' ||
    !DIGEST.test(body.sourceMessageDigest) ||
    (body.providerCode !== 'telebirr' && body.providerCode !== 'cbe_birr') ||
    typeof body.transactionReference !== 'string' ||
    !/^[A-Z0-9]{8,32}$/u.test(body.transactionReference) ||
    typeof body.amountMinor !== 'number' ||
    !Number.isSafeInteger(body.amountMinor) ||
    body.amountMinor < 1 ||
    body.amountMinor > 9_999_999_999 ||
    !utc(body.occurredAt) ||
    !utc(body.receivedAt) ||
    !utc(body.observedAt)
  )
    return undefined;
  return body;
}

export function canonicalReceiverSmsEventBodyBytes(candidate: unknown): Buffer | undefined {
  const body = validBody(candidate);
  return body
    ? Buffer.from(JSON.stringify([BODY_DOMAIN, ...BODY_KEYS.map((key) => body[key])]), 'utf8')
    : undefined;
}

export function digestReceiverSmsEventBody(candidate: unknown): string | undefined {
  const body = canonicalReceiverSmsEventBodyBytes(candidate);
  return body ? `sha256:${createHash('sha256').update(body).digest('hex')}` : undefined;
}

export function canonicalReceiverSmsEventSignatureBytes(candidate: unknown): Buffer | undefined {
  const digest = digestReceiverSmsEventBody(candidate);
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

/**
 * Attests that the paired phone reported payment fields from an SMS. It does
 * not authenticate bank authorship. The raw reference reaches only the callback.
 */
export function verifyReceiverSmsEvent(
  candidate: unknown,
  enrolledDeviceSpkiDer: unknown,
  onVerifiedPayment?: (payment: ReceiverSmsVerifiedPayment) => void,
): ReceiverSmsEventAssessment {
  try {
    const input = record(candidate, INPUT_KEYS);
    const enrollment = input && record(ownDataValue(input, 'trustedEnrollment'), ENROLLMENT_KEYS);
    const envelope = input && record(ownDataValue(input, 'signedEvent'), ENVELOPE_KEYS);
    const body = envelope && validBody(ownDataValue(envelope, 'body'));
    const key = p256Key(enrolledDeviceSpkiDer);
    if (
      !input ||
      !enrollment ||
      !envelope ||
      !body ||
      !key ||
      !utc(input.assessedAt) ||
      !utc(enrollment.validFrom) ||
      !utc(enrollment.validUntil) ||
      envelope.contractVersion !== 1 ||
      envelope.protocolMode !== RECEIVER_SMS_PROTOCOL_MODE ||
      typeof envelope.bodyDigest !== 'string' ||
      !DIGEST.test(envelope.bodyDigest) ||
      typeof envelope.signature !== 'string' ||
      !SIGNATURE.test(envelope.signature)
    )
      return review('invalid_request');
    if (
      enrollment.state !== 'active' ||
      key.digest !== enrollment.publicKeySpkiSha256 ||
      body.deviceId !== enrollment.deviceId ||
      body.keyId !== enrollment.keyId ||
      Date.parse(body.observedAt as string) < Date.parse(enrollment.validFrom as string) ||
      Date.parse(body.observedAt as string) >= Date.parse(enrollment.validUntil as string)
    )
      return review('device_unavailable');
    const assessed = Date.parse(input.assessedAt);
    const occurred = Date.parse(body.occurredAt as string);
    const received = Date.parse(body.receivedAt as string);
    const observed = Date.parse(body.observedAt as string);
    if (
      assessed < observed - 5_000 ||
      assessed > observed + 7 * 24 * 60 * 60_000 ||
      received > observed + 5 * 60_000 ||
      received < observed - 30 * 24 * 60 * 60_000 ||
      occurred > received + 5 * 60_000 ||
      occurred < received - 30 * 24 * 60 * 60_000
    )
      return review('time_mismatch');
    const digest = digestReceiverSmsEventBody(body);
    if (!digest || envelope.bodyDigest !== digest) return review('body_digest_mismatch');
    const signatureBytes = Buffer.from(envelope.signature, 'base64url');
    if (
      signatureBytes.length !== 64 ||
      signatureBytes.toString('base64url') !== envelope.signature ||
      !verify(
        'sha256',
        canonicalReceiverSmsEventSignatureBytes(body)!,
        { key: key.key, dsaEncoding: 'ieee-p1363' },
        signatureBytes,
      )
    )
      return review('signature_invalid');
    const event: ReceiverSmsVerifiedEvent = Object.freeze({
      deviceId: body.deviceId as string,
      keyId: body.keyId as string,
      sourceSubscriptionId: body.sourceSubscriptionId as number,
      receivedAt: body.receivedAt as string,
      observedAt: body.observedAt as string,
      sourceMessageDigest: body.sourceMessageDigest as string,
      eventBodyDigest: digest,
    });
    onVerifiedPayment?.(
      Object.freeze({
        providerCode: body.providerCode as ReceiverSmsVerifiedPayment['providerCode'],
        transactionReference: body.transactionReference as string,
        amountMinor: body.amountMinor as number,
        occurredAt: body.occurredAt as string,
      }),
    );
    return Object.freeze({
      disposition: 'verified_phone_sms',
      reasonCode: 'signed_inbox_message',
      phoneSignatureVerified: true,
      bankAuthenticationPerformed: false,
      financialActionAllowed: false,
      event,
    });
  } catch {
    return review('invalid_request');
  }
}
