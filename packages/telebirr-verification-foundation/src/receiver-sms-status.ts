import { createHash, createPublicKey, verify } from 'node:crypto';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  parseCanonicalUtcTimestamp,
} from './exact-data-record.js';

export const RECEIVER_SMS_STATUS_PROTOCOL_MODE = 'receiver_sms_status_v1' as const;
const BODY_DOMAIN = 'fetanagent:receiver-sms-status-body:v1';
const SIGNATURE_DOMAIN = 'fetanagent:receiver-sms-status-signature:v1';
const BODY_KEYS = [
  'contractVersion',
  'protocolMode',
  'deviceId',
  'keyId',
  'state',
  'observedAt',
] as const;
const BODY_KEYS_WITH_QUEUE = [...BODY_KEYS, 'queuedSmsCount'] as const;
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
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;

export interface ReceiverSmsVerifiedStatus {
  readonly deviceId: string;
  readonly keyId: string;
  readonly state: 'ready' | 'attention';
  readonly observedAt: string;
  readonly bodyDigest: string;
  readonly queuedSmsCount?: number;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  return isPlainNonProxyRecord(value) && hasExactEnumerableDataKeys(value, keys)
    ? value
    : undefined;
}

function utc(value: unknown): value is string {
  return typeof value === 'string' && parseCanonicalUtcTimestamp(value) === value;
}

export function digestReceiverSmsStatusBody(candidate: unknown): string | undefined {
  const extended = record(candidate, BODY_KEYS_WITH_QUEUE);
  const body = extended ?? record(candidate, BODY_KEYS);
  if (
    !body ||
    body.contractVersion !== 1 ||
    body.protocolMode !== RECEIVER_SMS_STATUS_PROTOCOL_MODE ||
    typeof body.deviceId !== 'string' ||
    !OPAQUE.test(body.deviceId) ||
    typeof body.keyId !== 'string' ||
    !OPAQUE.test(body.keyId) ||
    (body.state !== 'ready' && body.state !== 'attention') ||
    !utc(body.observedAt) ||
    (extended !== undefined &&
      (!Number.isSafeInteger(body.queuedSmsCount) ||
        (body.queuedSmsCount as number) < 0 ||
        (body.queuedSmsCount as number) > 100_000))
  )
    return undefined;
  const keys = extended ? BODY_KEYS_WITH_QUEUE : BODY_KEYS;
  const transcript = JSON.stringify([BODY_DOMAIN, ...keys.map((key) => body[key])]);
  return `sha256:${createHash('sha256').update(transcript, 'utf8').digest('hex')}`;
}

/** A fresh report attests only to the paired phone's SMS verifier, never to a payment. */
export function verifyReceiverSmsStatus(
  signedStatus: unknown,
  enrolledDeviceSpkiDer: unknown,
  trustedEnrollment: unknown,
  assessedAt: string,
): ReceiverSmsVerifiedStatus | undefined {
  try {
    const envelope = record(signedStatus, ENVELOPE_KEYS);
    const body =
      envelope && (record(envelope.body, BODY_KEYS_WITH_QUEUE) ?? record(envelope.body, BODY_KEYS));
    const enrollment = record(trustedEnrollment, ENROLLMENT_KEYS);
    const digest = body && digestReceiverSmsStatusBody(body);
    if (
      !envelope ||
      !body ||
      !enrollment ||
      !digest ||
      !utc(assessedAt) ||
      !utc(enrollment.validFrom) ||
      !utc(enrollment.validUntil) ||
      envelope.contractVersion !== 1 ||
      envelope.protocolMode !== RECEIVER_SMS_STATUS_PROTOCOL_MODE ||
      envelope.bodyDigest !== digest ||
      typeof envelope.signature !== 'string' ||
      !SIGNATURE.test(envelope.signature) ||
      enrollment.state !== 'active' ||
      body.deviceId !== enrollment.deviceId ||
      body.keyId !== enrollment.keyId ||
      typeof enrollment.publicKeySpkiSha256 !== 'string' ||
      !DIGEST.test(enrollment.publicKeySpkiSha256)
    )
      return undefined;
    const keyBytes = Buffer.from(enrolledDeviceSpkiDer as Uint8Array);
    if (
      keyBytes.byteLength < 64 ||
      keyBytes.byteLength > 512 ||
      `sha256:${createHash('sha256').update(keyBytes).digest('hex')}` !==
        enrollment.publicKeySpkiSha256
    )
      return undefined;
    const key = createPublicKey({ key: keyBytes, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      return undefined;
    const observed = Date.parse(body.observedAt as string);
    if (
      observed < Date.parse(enrollment.validFrom) ||
      observed >= Date.parse(enrollment.validUntil) ||
      Math.abs(Date.parse(assessedAt) - observed) > 60_000
    )
      return undefined;
    const signature = Buffer.from(envelope.signature, 'base64url');
    if (
      signature.byteLength !== 64 ||
      signature.toString('base64url') !== envelope.signature ||
      !verify(
        'sha256',
        Buffer.from(JSON.stringify([SIGNATURE_DOMAIN, digest]), 'utf8'),
        { key, dsaEncoding: 'ieee-p1363' },
        signature,
      )
    )
      return undefined;
    return Object.freeze({
      deviceId: body.deviceId as string,
      keyId: body.keyId as string,
      state: body.state as 'ready' | 'attention',
      observedAt: body.observedAt as string,
      bodyDigest: digest,
      ...(typeof body.queuedSmsCount === 'number' ? { queuedSmsCount: body.queuedSmsCount } : {}),
    });
  } catch {
    return undefined;
  }
}
