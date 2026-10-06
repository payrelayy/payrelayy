import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
  type UnknownRecord,
} from './exact-data-record.js';

/** Proof of possession only. A trusted server must still consume an Owner-issued challenge. */
export const ROUTINE_TELEBIRR_DEVICE_PAIRING_PROTOCOL_MODE = 'routine_device_pairing_v1' as const;
export const ROUTINE_TELEBIRR_DEVICE_PAIRING_TRANSCRIPT_VERSION =
  'telebirr-routine-device-pairing-transcript-v1' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const P1363 = /^[A-Za-z0-9_-]{86}$/u;
const MAX_CHALLENGE_MS = 12 * 60 * 60_000;
const MAX_REQUEST_MS = 5 * 60_000;

const bindingKeys = [
  'pairingId',
  'pairingNonceDigest',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'expectedReceiverNameDigest',
] as const;
const bodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  ...bindingKeys,
  'deviceId',
  'keyId',
  'devicePublicKeySpki',
  'devicePublicKeySpkiSha256',
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
  'body',
  'signature',
] as const;
const challengeKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  ...bindingKeys,
  'issuedAt',
  'expiresAt',
  'state',
] as const;
const inputKeys = ['assessedAt', 'trustedChallenge', 'signedRequest'] as const;

type Scalar = string | number;
type Body = { readonly [K in (typeof bodyKeys)[number]]: unknown };

export interface RoutineTelebirrDevicePairingAssessment {
  readonly advisoryOnly: true;
  readonly deviceSignatureVerified: boolean;
  readonly challengeConsumptionPerformed: false;
  readonly enrollmentAllowed: false;
  readonly databaseWriteAllowed: false;
  readonly assignmentPollingAllowed: false;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_forward_pairing_proof';
  readonly reasonCode:
    | 'invalid_request'
    | 'challenge_unavailable'
    | 'challenge_expired'
    | 'challenge_binding_mismatch'
    | 'request_expired'
    | 'device_key_invalid'
    | 'body_digest_mismatch'
    | 'signature_invalid'
    | 'device_proof_matches_challenge';
  /** Candidate evidence identity, not a consumed challenge or an enrollment. */
  readonly pairingEvidenceDigest: string | null;
}

function assessment(
  disposition: RoutineTelebirrDevicePairingAssessment['disposition'],
  reasonCode: RoutineTelebirrDevicePairingAssessment['reasonCode'],
  signatureVerified = false,
  evidenceDigest: string | null = null,
): RoutineTelebirrDevicePairingAssessment {
  return Object.freeze({
    advisoryOnly: true,
    deviceSignatureVerified: signatureVerified,
    challengeConsumptionPerformed: false,
    enrollmentAllowed: false,
    databaseWriteAllowed: false,
    assignmentPollingAllowed: false,
    financialActionAllowed: false,
    disposition,
    reasonCode,
    pairingEvidenceDigest: evidenceDigest,
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
    value.contractVersion === 1 &&
    value.providerCode === 'telebirr' &&
    value.protocolMode === ROUTINE_TELEBIRR_DEVICE_PAIRING_PROTOCOL_MODE
  );
}

function binding(value: UnknownRecord): boolean {
  return (
    typeof value.pairingId === 'string' &&
    UUID_V4.test(value.pairingId) &&
    typeof value.pairingNonceDigest === 'string' &&
    DIGEST.test(value.pairingNonceDigest) &&
    typeof value.receiverRevisionId === 'string' &&
    UUID_V4.test(value.receiverRevisionId) &&
    typeof value.receiverVersion === 'number' &&
    Number.isSafeInteger(value.receiverVersion) &&
    value.receiverVersion > 0 &&
    value.receiverVersion <= 2_147_483_647 &&
    typeof value.receiverProfileDigest === 'string' &&
    DIGEST.test(value.receiverProfileDigest) &&
    typeof value.expectedReceiverNameDigest === 'string' &&
    DIGEST.test(value.expectedReceiverNameDigest)
  );
}

function body(value: unknown): Body | undefined {
  const parsed = record(value, bodyKeys);
  return parsed &&
    header(parsed) &&
    binding(parsed) &&
    typeof parsed.deviceId === 'string' &&
    OPAQUE_ID.test(parsed.deviceId) &&
    typeof parsed.keyId === 'string' &&
    OPAQUE_ID.test(parsed.keyId) &&
    typeof parsed.devicePublicKeySpki === 'string' &&
    BASE64URL.test(parsed.devicePublicKeySpki) &&
    typeof parsed.devicePublicKeySpkiSha256 === 'string' &&
    DIGEST.test(parsed.devicePublicKeySpkiSha256) &&
    utc(parsed.issuedAt) &&
    utc(parsed.expiresAt)
    ? (parsed as Body)
    : undefined;
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

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function canonicalRoutineTelebirrDevicePairingBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  try {
    const parsed = body(candidate);
    return parsed
      ? encode(
          'fetanagent:telebirr:routine:device-pairing-body:v1',
          bodyKeys.map((key) => [key, parsed[key] as Scalar]),
        )
      : undefined;
  } catch {
    return undefined;
  }
}

export function digestRoutineTelebirrDevicePairingBody(candidate: unknown): string | undefined {
  const bytes = canonicalRoutineTelebirrDevicePairingBodyBytes(candidate);
  return bytes && digest(bytes);
}

export function canonicalRoutineTelebirrDevicePairingSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const bodyDigest = digestRoutineTelebirrDevicePairingBody(candidate);
  return bodyDigest
    ? encode(ROUTINE_TELEBIRR_DEVICE_PAIRING_TRANSCRIPT_VERSION, [['bodyDigest', bodyDigest]])
    : undefined;
}

/**
 * Verifies an Android P-256 key's possession against an independently trusted routine challenge.
 * This function cannot issue a challenge, consume one, or insert an enrollment. The future
 * protected server must do those operations atomically after owner authentication and recheck the
 * current receiver revision and all no-money gates. Pilot packages and certificates are not input.
 */
export function assessRoutineTelebirrDevicePairingProof(
  candidate: unknown,
): RoutineTelebirrDevicePairingAssessment {
  try {
    const input = record(candidate, inputKeys);
    const challenge = input && record(input.trustedChallenge, challengeKeys);
    const envelope = input && record(input.signedRequest, envelopeKeys);
    const request = envelope && body(envelope.body);
    if (
      !input ||
      !challenge ||
      !envelope ||
      !request ||
      !utc(input.assessedAt) ||
      !header(challenge) ||
      !binding(challenge) ||
      !utc(challenge.issuedAt) ||
      !utc(challenge.expiresAt) ||
      !['issued', 'consumed', 'revoked'].includes(challenge.state as string) ||
      !header(envelope) ||
      envelope.transcriptVersion !== ROUTINE_TELEBIRR_DEVICE_PAIRING_TRANSCRIPT_VERSION ||
      envelope.bodyDigestAlgorithm !== 'sha256' ||
      typeof envelope.bodyDigest !== 'string' ||
      !DIGEST.test(envelope.bodyDigest) ||
      envelope.signatureAlgorithm !== 'ecdsa-p256-sha256' ||
      envelope.signatureEncoding !== 'ieee-p1363-base64url' ||
      typeof envelope.signature !== 'string' ||
      !P1363.test(envelope.signature) ||
      Buffer.from(envelope.signature, 'base64url').toString('base64url') !== envelope.signature
    ) {
      return assessment('would_review', 'invalid_request');
    }

    const assessed = Date.parse(input.assessedAt);
    const challengeIssued = Date.parse(challenge.issuedAt);
    const challengeExpires = Date.parse(challenge.expiresAt);
    if (challenge.state !== 'issued') return assessment('would_review', 'challenge_unavailable');
    if (
      challengeExpires <= challengeIssued ||
      challengeExpires - challengeIssued > MAX_CHALLENGE_MS ||
      assessed < challengeIssued ||
      assessed >= challengeExpires
    ) {
      return assessment('would_review', 'challenge_expired');
    }
    if (bindingKeys.some((key) => challenge[key] !== request[key])) {
      return assessment('would_review', 'challenge_binding_mismatch');
    }
    const requestIssued = Date.parse(request.issuedAt as string);
    const requestExpires = Date.parse(request.expiresAt as string);
    if (
      requestIssued < challengeIssued ||
      requestExpires <= requestIssued ||
      requestExpires - requestIssued > MAX_REQUEST_MS ||
      requestExpires > challengeExpires ||
      assessed < requestIssued ||
      assessed >= requestExpires
    ) {
      return assessment('would_review', 'request_expired');
    }
    const encodedKey = request.devicePublicKeySpki as string;
    if (encodedKey.length > 684) return assessment('would_review', 'device_key_invalid');
    const keyDer = Buffer.from(encodedKey, 'base64url');
    if (
      keyDer.length < 64 ||
      keyDer.length > 512 ||
      keyDer.toString('base64url') !== encodedKey ||
      digest(keyDer) !== request.devicePublicKeySpkiSha256
    ) {
      return assessment('would_review', 'device_key_invalid');
    }
    const key = createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !key.export({ format: 'der', type: 'spki' }).equals(keyDer)
    ) {
      return assessment('would_review', 'device_key_invalid');
    }
    const bodyDigest = digestRoutineTelebirrDevicePairingBody(request);
    if (bodyDigest !== envelope.bodyDigest) {
      return assessment('would_review', 'body_digest_mismatch');
    }
    const signatureBytes = canonicalRoutineTelebirrDevicePairingSignatureBytes(request);
    if (
      !signatureBytes ||
      !verifySignature(
        'sha256',
        signatureBytes,
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(envelope.signature, 'base64url'),
      )
    ) {
      return assessment('would_review', 'signature_invalid');
    }
    return assessment(
      'would_forward_pairing_proof',
      'device_proof_matches_challenge',
      true,
      bodyDigest,
    );
  } catch {
    return assessment('would_review', 'invalid_request');
  }
}
