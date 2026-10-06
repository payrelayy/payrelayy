import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
  type UnknownRecord,
} from './exact-data-record.js';

/** A receipt of an existing no-money enrollment, never a polling or payment grant. */
export const ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_MODE = 'routine_enrollment_receipt_v1' as const;
export const ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_TRANSCRIPT =
  'telebirr-routine-enrollment-receipt-transcript-v1' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const P1363 = /^[A-Za-z0-9_-]{86}$/u;
const MAX_ENROLLMENT_MS = 30 * 86_400_000;
const bodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'enrollmentId',
  'pairingEvidenceDigest',
  'deviceId',
  'keyId',
  'devicePublicKeySpkiSha256',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'expectedReceiverNameDigest',
  'validFrom',
  'validUntil',
  'issuedAt',
  'assignmentPollingAllowed',
  'financialActionAllowed',
  'moneyMovementAllowed',
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
const bindingKeys = [
  'pairingEvidenceDigest',
  'deviceId',
  'keyId',
  'devicePublicKeySpkiSha256',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'expectedReceiverNameDigest',
] as const;
const signerKeys = [
  'signerKeyId',
  'publicKeySpki',
  'publicKeySpkiSha256',
  'validFrom',
  'validUntil',
  'state',
] as const;

type Scalar = string | number | boolean;
export type RoutineTelebirrEnrollmentReceiptBody = {
  readonly [K in (typeof bodyKeys)[number]]: Scalar;
};
export type SignedRoutineTelebirrEnrollmentReceipt = {
  readonly [K in (typeof envelopeKeys)[number]]: unknown;
} & { readonly body: RoutineTelebirrEnrollmentReceiptBody };

function record(value: unknown, keys: readonly string[]): UnknownRecord | undefined {
  if (!isPlainNonProxyRecord(value) || !hasExactEnumerableDataKeys(value, keys)) return undefined;
  return Object.fromEntries(keys.map((key) => [key, ownDataValue(value, key)]));
}

function utc(value: unknown): value is string {
  return typeof value === 'string' && parseCanonicalUtcTimestamp(value) === value;
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function encode(domain: string, fields: readonly (readonly [string, Scalar])[]): Buffer {
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

export function decodeRoutineTelebirrEnrollmentReceiptBody(
  candidate: unknown,
): RoutineTelebirrEnrollmentReceiptBody | undefined {
  try {
    const value = record(candidate, bodyKeys);
    if (
      !value ||
      value.contractVersion !== 1 ||
      value.providerCode !== 'telebirr' ||
      value.protocolMode !== ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_MODE ||
      typeof value.enrollmentId !== 'string' ||
      !UUID_V4.test(value.enrollmentId) ||
      typeof value.pairingEvidenceDigest !== 'string' ||
      !DIGEST.test(value.pairingEvidenceDigest) ||
      typeof value.deviceId !== 'string' ||
      !OPAQUE_ID.test(value.deviceId) ||
      typeof value.keyId !== 'string' ||
      !OPAQUE_ID.test(value.keyId) ||
      typeof value.devicePublicKeySpkiSha256 !== 'string' ||
      !DIGEST.test(value.devicePublicKeySpkiSha256) ||
      typeof value.receiverRevisionId !== 'string' ||
      !UUID_V4.test(value.receiverRevisionId) ||
      typeof value.receiverVersion !== 'number' ||
      !Number.isSafeInteger(value.receiverVersion) ||
      value.receiverVersion < 1 ||
      value.receiverVersion > 2_147_483_647 ||
      typeof value.receiverProfileDigest !== 'string' ||
      !DIGEST.test(value.receiverProfileDigest) ||
      typeof value.expectedReceiverNameDigest !== 'string' ||
      !DIGEST.test(value.expectedReceiverNameDigest) ||
      !utc(value.validFrom) ||
      !utc(value.validUntil) ||
      !utc(value.issuedAt) ||
      value.assignmentPollingAllowed !== false ||
      value.financialActionAllowed !== false ||
      value.moneyMovementAllowed !== false
    )
      return undefined;
    const from = Date.parse(value.validFrom);
    const until = Date.parse(value.validUntil);
    const issued = Date.parse(value.issuedAt);
    if (until <= from || until - from > MAX_ENROLLMENT_MS || issued < from || issued >= until) {
      return undefined;
    }
    return value as RoutineTelebirrEnrollmentReceiptBody;
  } catch {
    return undefined;
  }
}

export function canonicalRoutineTelebirrEnrollmentReceiptBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeRoutineTelebirrEnrollmentReceiptBody(candidate);
  return body
    ? encode(
        'fetanagent:telebirr:routine:enrollment-receipt-body:v1',
        bodyKeys.map((key) => [key, body[key]]),
      )
    : undefined;
}

export function digestRoutineTelebirrEnrollmentReceiptBody(candidate: unknown): string | undefined {
  const bytes = canonicalRoutineTelebirrEnrollmentReceiptBodyBytes(candidate);
  return bytes && digest(bytes);
}

export function canonicalRoutineTelebirrEnrollmentReceiptSignatureBytes(
  candidate: unknown,
  signerKeyId: string,
): Buffer | undefined {
  if (typeof signerKeyId !== 'string' || !OPAQUE_ID.test(signerKeyId)) return undefined;
  const bodyDigest = digestRoutineTelebirrEnrollmentReceiptBody(candidate);
  return bodyDigest
    ? encode(ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_TRANSCRIPT, [
        ['signerKeyId', signerKeyId],
        ['bodyDigest', bodyDigest],
      ])
    : undefined;
}

export function decodeSignedRoutineTelebirrEnrollmentReceipt(
  candidate: unknown,
): SignedRoutineTelebirrEnrollmentReceipt | undefined {
  try {
    const envelope = record(candidate, envelopeKeys);
    const body = envelope && decodeRoutineTelebirrEnrollmentReceiptBody(envelope.body);
    if (
      !envelope ||
      !body ||
      envelope.contractVersion !== 1 ||
      envelope.providerCode !== 'telebirr' ||
      envelope.protocolMode !== ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_MODE ||
      envelope.transcriptVersion !== ROUTINE_TELEBIRR_ENROLLMENT_RECEIPT_TRANSCRIPT ||
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
    )
      return undefined;
    return { ...envelope, body } as SignedRoutineTelebirrEnrollmentReceipt;
  } catch {
    return undefined;
  }
}

/** The signer record must come from an independent trusted source, never this receipt. */
export function verifySignedRoutineTelebirrEnrollmentReceipt(
  candidate: unknown,
  trustedSignerCandidate: unknown,
  expectedBindingCandidate: unknown,
  assessedAt: unknown,
): boolean {
  try {
    const receipt = decodeSignedRoutineTelebirrEnrollmentReceipt(candidate);
    const signer = record(trustedSignerCandidate, signerKeys);
    const binding = record(expectedBindingCandidate, bindingKeys);
    if (
      !receipt ||
      !signer ||
      !binding ||
      !utc(assessedAt) ||
      signer.state !== 'active' ||
      signer.signerKeyId !== receipt.signerKeyId ||
      typeof signer.publicKeySpki !== 'string' ||
      !/^[A-Za-z0-9_-]+$/u.test(signer.publicKeySpki) ||
      signer.publicKeySpki.length > 684 ||
      typeof signer.publicKeySpkiSha256 !== 'string' ||
      !DIGEST.test(signer.publicKeySpkiSha256) ||
      !utc(signer.validFrom) ||
      !utc(signer.validUntil) ||
      typeof binding.pairingEvidenceDigest !== 'string' ||
      !DIGEST.test(binding.pairingEvidenceDigest) ||
      typeof binding.deviceId !== 'string' ||
      !OPAQUE_ID.test(binding.deviceId) ||
      typeof binding.keyId !== 'string' ||
      !OPAQUE_ID.test(binding.keyId) ||
      typeof binding.devicePublicKeySpkiSha256 !== 'string' ||
      !DIGEST.test(binding.devicePublicKeySpkiSha256) ||
      typeof binding.receiverRevisionId !== 'string' ||
      !UUID_V4.test(binding.receiverRevisionId) ||
      typeof binding.receiverVersion !== 'number' ||
      !Number.isSafeInteger(binding.receiverVersion) ||
      binding.receiverVersion < 1 ||
      binding.receiverVersion > 2_147_483_647 ||
      typeof binding.receiverProfileDigest !== 'string' ||
      !DIGEST.test(binding.receiverProfileDigest) ||
      typeof binding.expectedReceiverNameDigest !== 'string' ||
      !DIGEST.test(binding.expectedReceiverNameDigest) ||
      bindingKeys.some((key) => binding[key] !== receipt.body[key]) ||
      assessedAt < receipt.body.validFrom ||
      assessedAt >= receipt.body.validUntil ||
      assessedAt < signer.validFrom ||
      assessedAt >= signer.validUntil ||
      receipt.body.issuedAt < signer.validFrom ||
      receipt.body.issuedAt >= signer.validUntil ||
      receipt.bodyDigest !== digestRoutineTelebirrEnrollmentReceiptBody(receipt.body)
    )
      return false;
    const keyDer = Buffer.from(signer.publicKeySpki, 'base64url');
    if (
      keyDer.length < 64 ||
      keyDer.length > 512 ||
      keyDer.toString('base64url') !== signer.publicKeySpki ||
      digest(keyDer) !== signer.publicKeySpkiSha256
    )
      return false;
    const key = createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !key.export({ format: 'der', type: 'spki' }).equals(keyDer)
    )
      return false;
    const message = canonicalRoutineTelebirrEnrollmentReceiptSignatureBytes(
      receipt.body,
      receipt.signerKeyId as string,
    );
    return (
      !!message &&
      verifySignature(
        'sha256',
        message,
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(receipt.signature as string, 'base64url'),
      )
    );
  } catch {
    return false;
  }
}
