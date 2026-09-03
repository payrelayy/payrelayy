import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
} from './exact-data-record.js';
import {
  decodeTelebirrLivePilotSignedAssignment,
  decodeTelebirrLivePilotSignedObservation,
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotObservationBody,
  type TelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedObservation,
} from './live-private-pilot-protocol.js';

/**
 * Authenticated, evidence-only Android bridge contracts.
 *
 * These contracts allow an enrolled Android device to poll one signed assignment, report redacted
 * health, and upload a signed observation. They cannot represent a database command, claim,
 * settlement, execution request, financial action, or money movement.
 */
export const TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE = 'telebirr' as const;
export const TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE = 'device_bridge_no_money_v1' as const;
export const TELEBIRR_DEVICE_BRIDGE_DEVICE_PLATFORM = 'android' as const;
export const TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256' as const;
export const TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING = 'ieee-p1363-base64url' as const;
export const TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM = 'sha256' as const;
export const TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION =
  'telebirr-device-bridge-pairing-transcript-v1' as const;
export const TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION =
  'telebirr-device-bridge-certificate-transcript-v1' as const;
export const TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION =
  'telebirr-device-bridge-request-transcript-v1' as const;
export const TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION =
  'telebirr-device-bridge-acknowledgement-transcript-v1' as const;

export const TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH = '/v1/telebirr/device/enrollments:pair' as const;
export const TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH =
  '/v1/telebirr/device/assignments:poll' as const;
export const TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH = '/v1/telebirr/device/heartbeat' as const;
export const TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH =
  '/v1/telebirr/device/observations:upload' as const;
export const TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE =
  'application/vnd.fetanagent.telebirr-device-bridge+json' as const;

const MAX_PAIRING_LIFETIME_MS = 10 * 60 * 1_000;
const MAX_REQUEST_LIFETIME_MS = 2 * 60 * 1_000;
const MAX_ACKNOWLEDGEMENT_LIFETIME_MS = 2 * 60 * 1_000;
const MAX_SPKI_BYTES = 512;
const MAX_REPLAY_IDENTITIES = 4_096;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const P1363_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const STATUS_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;

export type TelebirrDeviceBridgeCommand = 'assignment_poll' | 'heartbeat' | 'observation_upload';

export type TelebirrDeviceBridgeRuntimeState =
  'enrollment_required' | 'ready' | 'busy' | 'upload_pending' | 'attention';

export type TelebirrDeviceBridgeAcknowledgementOutcome =
  'assignment' | 'no_assignment' | 'acknowledged' | 'retry' | 'rejected';

export type TelebirrDeviceBridgeReasonCode =
  | 'assignment_unavailable'
  | 'binding_mismatch'
  | 'device_revoked'
  | 'observation_rejected'
  | 'payload_invalid'
  | 'pilot_stopped'
  | 'request_expired'
  | 'request_replayed'
  | 'temporary_unavailable';

/** Authority literals are repeated in every authenticated body to prevent capability confusion. */
export interface TelebirrDeviceBridgeNoMoneySafety {
  readonly evidenceOnly: true;
  readonly databaseAccessAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly moneyMovementAllowed: false;
  readonly rawReceiptUploadAllowed: false;
  readonly sensitiveLoggingAllowed: false;
}

export interface TelebirrDeviceBridgePairingBody extends TelebirrDeviceBridgeNoMoneySafety {
  readonly contractVersion: typeof TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE;
  readonly pairingId: string;
  readonly pairingNonceDigest: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly devicePublicKeySpki: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly signatureAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM;
  readonly devicePlatform: typeof TELEBIRR_DEVICE_BRIDGE_DEVICE_PLATFORM;
  readonly appVersion: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly oneUse: true;
}

export interface SignedTelebirrDeviceBridgePairingRequest {
  readonly contractVersion: typeof TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE;
  readonly transcriptVersion: typeof TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING;
  readonly keyId: string;
  readonly body: TelebirrDeviceBridgePairingBody;
  readonly signature: string;
}

export interface TelebirrDeviceBridgeEnrollmentCertificateBody extends TelebirrDeviceBridgeNoMoneySafety {
  readonly contractVersion: typeof TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE;
  readonly enrollmentId: string;
  readonly pairingId: string;
  readonly pairingRequestBodyDigest: string;
  readonly pairingNonceDigest: string;
  readonly pairingConsumed: true;
  readonly deviceId: string;
  readonly keyId: string;
  readonly devicePublicKeySpki: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly signatureAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM;
  readonly devicePlatform: typeof TELEBIRR_DEVICE_BRIDGE_DEVICE_PLATFORM;
  readonly minimumAppVersion: string;
  readonly pilotRevisionId: string;
  readonly receiverRevisionId: string;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly receiverConfigurationDigest: string;
  readonly assignmentSignerKeyId: string;
  readonly assignmentSignerPublicKeySpkiSha256: string;
  readonly state: 'active' | 'revoked';
  readonly issuedAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface SignedTelebirrDeviceBridgeEnrollmentCertificate {
  readonly contractVersion: typeof TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE;
  readonly transcriptVersion: typeof TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: TelebirrDeviceBridgeEnrollmentCertificateBody;
  readonly signature: string;
}

export interface TelebirrDeviceBridgeRequestBody extends TelebirrDeviceBridgeNoMoneySafety {
  readonly contractVersion: typeof TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE;
  readonly requestId: string;
  readonly enrollmentId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly command: TelebirrDeviceBridgeCommand;
  readonly method: 'POST';
  readonly canonicalPath:
    | typeof TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH
    | typeof TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH
    | typeof TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH;
  readonly payloadDigest: string;
  readonly nonceDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SignedTelebirrDeviceBridgeRequest {
  readonly contractVersion: typeof TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE;
  readonly transcriptVersion: typeof TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING;
  readonly keyId: string;
  readonly body: TelebirrDeviceBridgeRequestBody;
  readonly signature: string;
}

export interface TelebirrDeviceBridgeAssignmentPollPayload {
  readonly requestedLeaseSeconds: number;
}

export interface TelebirrDeviceBridgeHeartbeatPayload {
  readonly runtimeState: TelebirrDeviceBridgeRuntimeState;
  readonly statusCode: string;
  readonly appVersion: string;
}

export interface TelebirrDeviceBridgeObservationUploadPayload {
  readonly signedAssignment: TelebirrLivePilotSignedAssignment;
  readonly signedObservation: TelebirrLivePilotSignedObservation;
}

export type TelebirrDeviceBridgePayload =
  | TelebirrDeviceBridgeAssignmentPollPayload
  | TelebirrDeviceBridgeHeartbeatPayload
  | TelebirrDeviceBridgeObservationUploadPayload;

export interface TelebirrDeviceBridgeCommandFrame {
  readonly request: SignedTelebirrDeviceBridgeRequest;
  readonly payload: TelebirrDeviceBridgePayload;
}

export interface TelebirrDeviceBridgeAcknowledgementBody extends TelebirrDeviceBridgeNoMoneySafety {
  readonly contractVersion: typeof TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE;
  readonly acknowledgementId: string;
  readonly requestId: string;
  readonly enrollmentId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly command: TelebirrDeviceBridgeCommand;
  readonly requestBodyDigest: string;
  readonly requestPayloadDigest: string;
  readonly outcome: TelebirrDeviceBridgeAcknowledgementOutcome;
  readonly assignmentBodyDigest: string | null;
  readonly observationBodyDigest: string | null;
  readonly reasonCode: TelebirrDeviceBridgeReasonCode | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SignedTelebirrDeviceBridgeAcknowledgement {
  readonly contractVersion: typeof TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE;
  readonly protocolMode: typeof TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE;
  readonly transcriptVersion: typeof TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: TelebirrDeviceBridgeAcknowledgementBody;
  readonly signature: string;
}

type Scalar = string | number | boolean | null;
type CanonicalField = readonly [string, Scalar];

const safety = Object.freeze({
  evidenceOnly: true,
  databaseAccessAllowed: false,
  claimAllowed: false,
  settlementAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  rawReceiptUploadAllowed: false,
  sensitiveLoggingAllowed: false,
} as const satisfies TelebirrDeviceBridgeNoMoneySafety);

const safetyKeys = Object.freeze(Object.keys(safety)) as readonly (keyof typeof safety)[];
const pairingBodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'pairingId',
  'pairingNonceDigest',
  'deviceId',
  'keyId',
  'devicePublicKeySpki',
  'devicePublicKeySpkiSha256',
  'signatureAlgorithm',
  'devicePlatform',
  'appVersion',
  'issuedAt',
  'expiresAt',
  'oneUse',
  ...safetyKeys,
] as const;
const enrollmentBodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'enrollmentId',
  'pairingId',
  'pairingRequestBodyDigest',
  'pairingNonceDigest',
  'pairingConsumed',
  'deviceId',
  'keyId',
  'devicePublicKeySpki',
  'devicePublicKeySpkiSha256',
  'signatureAlgorithm',
  'devicePlatform',
  'minimumAppVersion',
  'pilotRevisionId',
  'receiverRevisionId',
  'receiverProfileId',
  'receiverProfileDigest',
  'receiverConfigurationDigest',
  'assignmentSignerKeyId',
  'assignmentSignerPublicKeySpkiSha256',
  'state',
  'issuedAt',
  'validFrom',
  'validUntil',
  ...safetyKeys,
] as const;
const requestBodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'requestId',
  'enrollmentId',
  'deviceId',
  'keyId',
  'command',
  'method',
  'canonicalPath',
  'payloadDigest',
  'nonceDigest',
  'issuedAt',
  'expiresAt',
  ...safetyKeys,
] as const;
const acknowledgementBodyKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'acknowledgementId',
  'requestId',
  'enrollmentId',
  'deviceId',
  'keyId',
  'command',
  'requestBodyDigest',
  'requestPayloadDigest',
  'outcome',
  'assignmentBodyDigest',
  'observationBodyDigest',
  'reasonCode',
  'issuedAt',
  'expiresAt',
  ...safetyKeys,
] as const;
const deviceSignedEnvelopeKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'transcriptVersion',
  'bodyDigestAlgorithm',
  'bodyDigest',
  'signatureAlgorithm',
  'signatureEncoding',
  'keyId',
  'body',
  'signature',
] as const;
const serverSignedEnvelopeKeys = [
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
const assignmentPollPayloadKeys = ['requestedLeaseSeconds'] as const;
const heartbeatPayloadKeys = ['runtimeState', 'statusCode', 'appVersion'] as const;
const observationUploadPayloadKeys = ['signedAssignment', 'signedObservation'] as const;
const commandFrameKeys = ['request', 'payload'] as const;

function hasHeader(candidate: Record<string, unknown>): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') === TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE &&
    ownDataValue(candidate, 'protocolMode') === TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE
  );
}

function hasSafety(candidate: Record<string, unknown>): boolean {
  return safetyKeys.every((key) => ownDataValue(candidate, key) === safety[key]);
}

function opaque(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value) ? value : undefined;
}

function version(value: unknown): string | undefined {
  return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : undefined;
}

function digest(value: unknown): string | undefined {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? value : undefined;
}

function signature(value: unknown): string | undefined {
  return typeof value === 'string' && P1363_BASE64URL_PATTERN.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  const parsed = parseCanonicalUtcTimestamp(value);
  return typeof parsed === 'string' ? parsed : undefined;
}

function validLifetime(issuedAt: string, expiresAt: string, maximumMs: number): boolean {
  const start = Date.parse(issuedAt);
  const end = Date.parse(expiresAt);
  return end > start && end - start <= maximumMs;
}

function parseP256Spki(value: unknown):
  | {
      readonly encoded: string;
      readonly bytes: Buffer;
      readonly key: KeyObject;
      readonly digest: string;
    }
  | undefined {
  try {
    if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) return undefined;
    const bytes = Buffer.from(value, 'base64url');
    if (
      bytes.length < 1 ||
      bytes.length > MAX_SPKI_BYTES ||
      bytes.toString('base64url') !== value
    ) {
      return undefined;
    }
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    const exported = key.export({ format: 'der', type: 'spki' });
    if (
      key.type !== 'public' ||
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !Buffer.isBuffer(exported) ||
      !exported.equals(bytes)
    ) {
      return undefined;
    }
    return Object.freeze({ encoded: value, bytes, key, digest: sha256(bytes) });
  } catch {
    return undefined;
  }
}

function parseExternalP256Spki(value: unknown): KeyObject | undefined {
  try {
    if (!(value instanceof Uint8Array) || isProxy(value)) return undefined;
    const bytes = Buffer.from(value);
    if (bytes.length < 1 || bytes.length > MAX_SPKI_BYTES) return undefined;
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    const exported = key.export({ format: 'der', type: 'spki' });
    return key.type === 'public' &&
      key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
      Buffer.isBuffer(exported) &&
      exported.equals(bytes)
      ? key
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

function encodeFields(domain: string, fields: readonly CanonicalField[]): Buffer {
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

function safetyFields(value: TelebirrDeviceBridgeNoMoneySafety): readonly CanonicalField[] {
  return safetyKeys.map((key) => [key, value[key]] as const);
}

function verifyP1363(
  transcript: Uint8Array | undefined,
  encodedSignature: string,
  key: KeyObject | undefined,
): boolean {
  try {
    return Boolean(
      transcript &&
      key &&
      verifySignature(
        'sha256',
        transcript,
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(encodedSignature, 'base64url'),
      ),
    );
  } catch {
    return false;
  }
}

function pathForCommand(
  command: TelebirrDeviceBridgeCommand,
): TelebirrDeviceBridgeRequestBody['canonicalPath'] {
  switch (command) {
    case 'assignment_poll':
      return TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH;
    case 'heartbeat':
      return TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH;
    case 'observation_upload':
      return TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH;
  }
}

function parseCommand(value: unknown): TelebirrDeviceBridgeCommand | undefined {
  return value === 'assignment_poll' || value === 'heartbeat' || value === 'observation_upload'
    ? value
    : undefined;
}

function parseReasonCode(value: unknown): TelebirrDeviceBridgeReasonCode | undefined {
  return value === 'assignment_unavailable' ||
    value === 'binding_mismatch' ||
    value === 'device_revoked' ||
    value === 'observation_rejected' ||
    value === 'payload_invalid' ||
    value === 'pilot_stopped' ||
    value === 'request_expired' ||
    value === 'request_replayed' ||
    value === 'temporary_unavailable'
    ? value
    : undefined;
}

export function decodeTelebirrDeviceBridgePairingBody(
  candidate: unknown,
): TelebirrDeviceBridgePairingBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, pairingBodyKeys) ||
      !hasHeader(candidate) ||
      !hasSafety(candidate)
    ) {
      return undefined;
    }
    const pairingId = opaque(ownDataValue(candidate, 'pairingId'));
    const pairingNonceDigest = digest(ownDataValue(candidate, 'pairingNonceDigest'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const publicKey = parseP256Spki(ownDataValue(candidate, 'devicePublicKeySpki'));
    const publicKeyDigest = digest(ownDataValue(candidate, 'devicePublicKeySpkiSha256'));
    const appVersion = version(ownDataValue(candidate, 'appVersion'));
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const expiresAt = timestamp(ownDataValue(candidate, 'expiresAt'));
    if (
      !pairingId ||
      !pairingNonceDigest ||
      !deviceId ||
      !keyId ||
      !publicKey ||
      publicKey.digest !== publicKeyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'devicePlatform') !== TELEBIRR_DEVICE_BRIDGE_DEVICE_PLATFORM ||
      !appVersion ||
      !issuedAt ||
      !expiresAt ||
      !validLifetime(issuedAt, expiresAt, MAX_PAIRING_LIFETIME_MS) ||
      ownDataValue(candidate, 'oneUse') !== true
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
      providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
      protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
      pairingId,
      pairingNonceDigest,
      deviceId,
      keyId,
      devicePublicKeySpki: publicKey.encoded,
      devicePublicKeySpkiSha256: publicKey.digest,
      signatureAlgorithm: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
      devicePlatform: TELEBIRR_DEVICE_BRIDGE_DEVICE_PLATFORM,
      appVersion,
      issuedAt,
      expiresAt,
      oneUse: true,
      ...safety,
    });
  } catch {
    return undefined;
  }
}

function pairingBodyFields(body: TelebirrDeviceBridgePairingBody): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['providerCode', body.providerCode],
    ['protocolMode', body.protocolMode],
    ['pairingId', body.pairingId],
    ['pairingNonceDigest', body.pairingNonceDigest],
    ['deviceId', body.deviceId],
    ['keyId', body.keyId],
    ['devicePublicKeySpki', body.devicePublicKeySpki],
    ['devicePublicKeySpkiSha256', body.devicePublicKeySpkiSha256],
    ['signatureAlgorithm', body.signatureAlgorithm],
    ['devicePlatform', body.devicePlatform],
    ['appVersion', body.appVersion],
    ['issuedAt', body.issuedAt],
    ['expiresAt', body.expiresAt],
    ['oneUse', body.oneUse],
    ...safetyFields(body),
  ];
}

export function canonicalTelebirrDeviceBridgePairingBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrDeviceBridgePairingBody(candidate);
  return body
    ? encodeFields('fetanagent:telebirr:device-bridge:pairing-body:v1', pairingBodyFields(body))
    : undefined;
}

export function digestTelebirrDeviceBridgePairingBody(candidate: unknown): string | undefined {
  const bytes = canonicalTelebirrDeviceBridgePairingBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalTelebirrDeviceBridgePairingSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrDeviceBridgePairingBody(candidate);
  const bodyDigest = body && digestTelebirrDeviceBridgePairingBody(body);
  return body && bodyDigest
    ? encodeFields('fetanagent:telebirr:device-bridge:pairing-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['providerCode', body.providerCode],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM],
        ['signatureEncoding', TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING],
        ['keyId', body.keyId],
      ])
    : undefined;
}

export function decodeSignedTelebirrDeviceBridgePairingRequest(
  candidate: unknown,
): SignedTelebirrDeviceBridgePairingRequest | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, deviceSignedEnvelopeKeys) ||
      !hasHeader(candidate)
    ) {
      return undefined;
    }
    const body = decodeTelebirrDeviceBridgePairingBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const encodedSignature = signature(ownDataValue(candidate, 'signature'));
    if (
      ownDataValue(candidate, 'transcriptVersion') !==
        TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !== TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !== TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING ||
      !body ||
      !bodyDigest ||
      !keyId ||
      keyId !== body.keyId ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
      providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
      protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
      transcriptVersion: TELEBIRR_DEVICE_BRIDGE_PAIRING_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
      signatureEncoding: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING,
      keyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

export function verifySignedTelebirrDeviceBridgePairingRequest(candidate: unknown): boolean {
  const request = decodeSignedTelebirrDeviceBridgePairingRequest(candidate);
  const computedDigest = request && digestTelebirrDeviceBridgePairingBody(request.body);
  const key = request && parseP256Spki(request.body.devicePublicKeySpki)?.key;
  return Boolean(
    request &&
    computedDigest === request.bodyDigest &&
    verifyP1363(
      canonicalTelebirrDeviceBridgePairingSignatureBytes(request.body),
      request.signature,
      key,
    ),
  );
}

export function decodeTelebirrDeviceBridgeEnrollmentCertificateBody(
  candidate: unknown,
): TelebirrDeviceBridgeEnrollmentCertificateBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, enrollmentBodyKeys) ||
      !hasHeader(candidate) ||
      !hasSafety(candidate)
    ) {
      return undefined;
    }
    const enrollmentId = opaque(ownDataValue(candidate, 'enrollmentId'));
    const pairingId = opaque(ownDataValue(candidate, 'pairingId'));
    const pairingRequestBodyDigest = digest(ownDataValue(candidate, 'pairingRequestBodyDigest'));
    const pairingNonceDigest = digest(ownDataValue(candidate, 'pairingNonceDigest'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const publicKey = parseP256Spki(ownDataValue(candidate, 'devicePublicKeySpki'));
    const publicKeyDigest = digest(ownDataValue(candidate, 'devicePublicKeySpkiSha256'));
    const minimumAppVersion = version(ownDataValue(candidate, 'minimumAppVersion'));
    const pilotRevisionId = opaque(ownDataValue(candidate, 'pilotRevisionId'));
    const receiverRevisionId = opaque(ownDataValue(candidate, 'receiverRevisionId'));
    const receiverProfileId = opaque(ownDataValue(candidate, 'receiverProfileId'));
    const receiverProfileDigest = digest(ownDataValue(candidate, 'receiverProfileDigest'));
    const receiverConfigurationDigest = digest(
      ownDataValue(candidate, 'receiverConfigurationDigest'),
    );
    const assignmentSignerKeyId = opaque(ownDataValue(candidate, 'assignmentSignerKeyId'));
    const assignmentSignerPublicKeySpkiSha256 = digest(
      ownDataValue(candidate, 'assignmentSignerPublicKeySpkiSha256'),
    );
    const state = ownDataValue(candidate, 'state');
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const validFrom = timestamp(ownDataValue(candidate, 'validFrom'));
    const validUntil = timestamp(ownDataValue(candidate, 'validUntil'));
    if (
      !enrollmentId ||
      !pairingId ||
      !pairingRequestBodyDigest ||
      !pairingNonceDigest ||
      ownDataValue(candidate, 'pairingConsumed') !== true ||
      !deviceId ||
      !keyId ||
      !publicKey ||
      publicKey.digest !== publicKeyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'devicePlatform') !== TELEBIRR_DEVICE_BRIDGE_DEVICE_PLATFORM ||
      !minimumAppVersion ||
      !pilotRevisionId ||
      !receiverRevisionId ||
      !receiverProfileId ||
      !receiverProfileDigest ||
      !receiverConfigurationDigest ||
      !assignmentSignerKeyId ||
      !assignmentSignerPublicKeySpkiSha256 ||
      (state !== 'active' && state !== 'revoked') ||
      !issuedAt ||
      !validFrom ||
      !validUntil ||
      issuedAt > validFrom ||
      validFrom >= validUntil
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
      providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
      protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
      enrollmentId,
      pairingId,
      pairingRequestBodyDigest,
      pairingNonceDigest,
      pairingConsumed: true,
      deviceId,
      keyId,
      devicePublicKeySpki: publicKey.encoded,
      devicePublicKeySpkiSha256: publicKey.digest,
      signatureAlgorithm: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
      devicePlatform: TELEBIRR_DEVICE_BRIDGE_DEVICE_PLATFORM,
      minimumAppVersion,
      pilotRevisionId,
      receiverRevisionId,
      receiverProfileId,
      receiverProfileDigest,
      receiverConfigurationDigest,
      assignmentSignerKeyId,
      assignmentSignerPublicKeySpkiSha256,
      state,
      issuedAt,
      validFrom,
      validUntil,
      ...safety,
    });
  } catch {
    return undefined;
  }
}

function enrollmentBodyFields(
  body: TelebirrDeviceBridgeEnrollmentCertificateBody,
): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['providerCode', body.providerCode],
    ['protocolMode', body.protocolMode],
    ['enrollmentId', body.enrollmentId],
    ['pairingId', body.pairingId],
    ['pairingRequestBodyDigest', body.pairingRequestBodyDigest],
    ['pairingNonceDigest', body.pairingNonceDigest],
    ['pairingConsumed', body.pairingConsumed],
    ['deviceId', body.deviceId],
    ['keyId', body.keyId],
    ['devicePublicKeySpki', body.devicePublicKeySpki],
    ['devicePublicKeySpkiSha256', body.devicePublicKeySpkiSha256],
    ['signatureAlgorithm', body.signatureAlgorithm],
    ['devicePlatform', body.devicePlatform],
    ['minimumAppVersion', body.minimumAppVersion],
    ['pilotRevisionId', body.pilotRevisionId],
    ['receiverRevisionId', body.receiverRevisionId],
    ['receiverProfileId', body.receiverProfileId],
    ['receiverProfileDigest', body.receiverProfileDigest],
    ['receiverConfigurationDigest', body.receiverConfigurationDigest],
    ['assignmentSignerKeyId', body.assignmentSignerKeyId],
    ['assignmentSignerPublicKeySpkiSha256', body.assignmentSignerPublicKeySpkiSha256],
    ['state', body.state],
    ['issuedAt', body.issuedAt],
    ['validFrom', body.validFrom],
    ['validUntil', body.validUntil],
    ...safetyFields(body),
  ];
}

export function canonicalTelebirrDeviceBridgeEnrollmentCertificateBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(candidate);
  return body
    ? encodeFields(
        'fetanagent:telebirr:device-bridge:enrollment-certificate-body:v1',
        enrollmentBodyFields(body),
      )
    : undefined;
}

export function digestTelebirrDeviceBridgeEnrollmentCertificateBody(
  candidate: unknown,
): string | undefined {
  const bytes = canonicalTelebirrDeviceBridgeEnrollmentCertificateBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes(
  candidate: unknown,
  signerKeyIdCandidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(candidate);
  const bodyDigest = body && digestTelebirrDeviceBridgeEnrollmentCertificateBody(body);
  const signerKeyId = opaque(signerKeyIdCandidate);
  return body && bodyDigest && signerKeyId
    ? encodeFields('fetanagent:telebirr:device-bridge:enrollment-certificate-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['providerCode', body.providerCode],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM],
        ['signatureEncoding', TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING],
        ['signerKeyId', signerKeyId],
      ])
    : undefined;
}

export function decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(
  candidate: unknown,
): SignedTelebirrDeviceBridgeEnrollmentCertificate | undefined {
  return decodeServerEnvelope(
    candidate,
    TELEBIRR_DEVICE_BRIDGE_CERTIFICATE_TRANSCRIPT_VERSION,
    decodeTelebirrDeviceBridgeEnrollmentCertificateBody,
  ) as SignedTelebirrDeviceBridgeEnrollmentCertificate | undefined;
}

export function verifySignedTelebirrDeviceBridgeEnrollmentCertificate(
  candidate: unknown,
  trustedServerPublicKeySpkiDer: unknown,
): boolean {
  const certificate = decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(candidate);
  const key = parseExternalP256Spki(trustedServerPublicKeySpkiDer);
  const computedDigest =
    certificate && digestTelebirrDeviceBridgeEnrollmentCertificateBody(certificate.body);
  return Boolean(
    certificate &&
    computedDigest === certificate.bodyDigest &&
    verifyP1363(
      canonicalTelebirrDeviceBridgeEnrollmentCertificateSignatureBytes(
        certificate.body,
        certificate.signerKeyId,
      ),
      certificate.signature,
      key,
    ),
  );
}

export function telebirrDeviceBridgeCertificateMatchesPairingRequest(
  certificateCandidate: unknown,
  pairingCandidate: unknown,
): boolean {
  const certificate = decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(certificateCandidate);
  const pairing = decodeSignedTelebirrDeviceBridgePairingRequest(pairingCandidate);
  if (!certificate || !pairing || !verifySignedTelebirrDeviceBridgePairingRequest(pairing)) {
    return false;
  }
  return (
    certificate.body.pairingId === pairing.body.pairingId &&
    certificate.body.pairingRequestBodyDigest === pairing.bodyDigest &&
    certificate.body.pairingNonceDigest === pairing.body.pairingNonceDigest &&
    certificate.body.deviceId === pairing.body.deviceId &&
    certificate.body.keyId === pairing.body.keyId &&
    certificate.body.devicePublicKeySpki === pairing.body.devicePublicKeySpki &&
    certificate.body.devicePublicKeySpkiSha256 === pairing.body.devicePublicKeySpkiSha256 &&
    Date.parse(certificate.body.issuedAt) >= Date.parse(pairing.body.issuedAt) &&
    Date.parse(certificate.body.issuedAt) < Date.parse(pairing.body.expiresAt)
  );
}

export function decodeTelebirrDeviceBridgeRequestBody(
  candidate: unknown,
): TelebirrDeviceBridgeRequestBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, requestBodyKeys) ||
      !hasHeader(candidate) ||
      !hasSafety(candidate)
    ) {
      return undefined;
    }
    const requestId = opaque(ownDataValue(candidate, 'requestId'));
    const enrollmentId = opaque(ownDataValue(candidate, 'enrollmentId'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const command = parseCommand(ownDataValue(candidate, 'command'));
    const canonicalPath = ownDataValue(candidate, 'canonicalPath');
    const payloadDigest = digest(ownDataValue(candidate, 'payloadDigest'));
    const nonceDigest = digest(ownDataValue(candidate, 'nonceDigest'));
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const expiresAt = timestamp(ownDataValue(candidate, 'expiresAt'));
    if (
      !requestId ||
      !enrollmentId ||
      !deviceId ||
      !keyId ||
      !command ||
      ownDataValue(candidate, 'method') !== 'POST' ||
      canonicalPath !== pathForCommand(command) ||
      !payloadDigest ||
      !nonceDigest ||
      !issuedAt ||
      !expiresAt ||
      !validLifetime(issuedAt, expiresAt, MAX_REQUEST_LIFETIME_MS)
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
      providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
      protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
      requestId,
      enrollmentId,
      deviceId,
      keyId,
      command,
      method: 'POST',
      canonicalPath: pathForCommand(command),
      payloadDigest,
      nonceDigest,
      issuedAt,
      expiresAt,
      ...safety,
    });
  } catch {
    return undefined;
  }
}

function requestBodyFields(body: TelebirrDeviceBridgeRequestBody): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['providerCode', body.providerCode],
    ['protocolMode', body.protocolMode],
    ['requestId', body.requestId],
    ['enrollmentId', body.enrollmentId],
    ['deviceId', body.deviceId],
    ['keyId', body.keyId],
    ['command', body.command],
    ['method', body.method],
    ['canonicalPath', body.canonicalPath],
    ['payloadDigest', body.payloadDigest],
    ['nonceDigest', body.nonceDigest],
    ['issuedAt', body.issuedAt],
    ['expiresAt', body.expiresAt],
    ...safetyFields(body),
  ];
}

export function canonicalTelebirrDeviceBridgeRequestBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrDeviceBridgeRequestBody(candidate);
  return body
    ? encodeFields('fetanagent:telebirr:device-bridge:request-body:v1', requestBodyFields(body))
    : undefined;
}

export function digestTelebirrDeviceBridgeRequestBody(candidate: unknown): string | undefined {
  const bytes = canonicalTelebirrDeviceBridgeRequestBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalTelebirrDeviceBridgeRequestSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrDeviceBridgeRequestBody(candidate);
  const bodyDigest = body && digestTelebirrDeviceBridgeRequestBody(body);
  return body && bodyDigest
    ? encodeFields('fetanagent:telebirr:device-bridge:request-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['providerCode', body.providerCode],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM],
        ['signatureEncoding', TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING],
        ['keyId', body.keyId],
      ])
    : undefined;
}

export function decodeSignedTelebirrDeviceBridgeRequest(
  candidate: unknown,
): SignedTelebirrDeviceBridgeRequest | undefined {
  return decodeDeviceEnvelope(
    candidate,
    TELEBIRR_DEVICE_BRIDGE_REQUEST_TRANSCRIPT_VERSION,
    decodeTelebirrDeviceBridgeRequestBody,
  ) as SignedTelebirrDeviceBridgeRequest | undefined;
}

export function deriveTelebirrDeviceBridgeRequestReplayIdentity(
  candidate: unknown,
): string | undefined {
  const request = decodeSignedTelebirrDeviceBridgeRequest(candidate);
  const bodyDigest = request && digestTelebirrDeviceBridgeRequestBody(request.body);
  return request && bodyDigest === request.bodyDigest
    ? sha256(
        encodeFields('fetanagent:telebirr:device-bridge:request-replay-identity:v1', [
          ['requestId', request.body.requestId],
          ['enrollmentId', request.body.enrollmentId],
          ['deviceId', request.body.deviceId],
          ['keyId', request.body.keyId],
          ['command', request.body.command],
          ['nonceDigest', request.body.nonceDigest],
          ['bodyDigest', request.bodyDigest],
        ]),
      )
    : undefined;
}

export function verifySignedTelebirrDeviceBridgeRequest(
  requestCandidate: unknown,
  certificateCandidate: unknown,
  trustedServerPublicKeySpkiDer: unknown,
  assessedAtCandidate: unknown,
  consumedReplayIdentities: readonly string[] = [],
): boolean {
  const request = decodeSignedTelebirrDeviceBridgeRequest(requestCandidate);
  const certificate = decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(certificateCandidate);
  const assessedAt = timestamp(assessedAtCandidate);
  if (
    !request ||
    !certificate ||
    !assessedAt ||
    consumedReplayIdentities.length > MAX_REPLAY_IDENTITIES ||
    certificate.body.state !== 'active' ||
    !verifySignedTelebirrDeviceBridgeEnrollmentCertificate(
      certificate,
      trustedServerPublicKeySpkiDer,
    )
  ) {
    return false;
  }
  if (
    request.body.enrollmentId !== certificate.body.enrollmentId ||
    request.body.deviceId !== certificate.body.deviceId ||
    request.body.keyId !== certificate.body.keyId ||
    Date.parse(assessedAt) < Date.parse(certificate.body.validFrom) ||
    Date.parse(assessedAt) >= Date.parse(certificate.body.validUntil) ||
    Date.parse(assessedAt) < Date.parse(request.body.issuedAt) ||
    Date.parse(assessedAt) >= Date.parse(request.body.expiresAt)
  ) {
    return false;
  }
  const bodyDigest = digestTelebirrDeviceBridgeRequestBody(request.body);
  const replayIdentity = deriveTelebirrDeviceBridgeRequestReplayIdentity(request);
  const deviceKey = parseP256Spki(certificate.body.devicePublicKeySpki)?.key;
  return Boolean(
    bodyDigest === request.bodyDigest &&
    replayIdentity &&
    !consumedReplayIdentities.includes(replayIdentity) &&
    verifyP1363(
      canonicalTelebirrDeviceBridgeRequestSignatureBytes(request.body),
      request.signature,
      deviceKey,
    ),
  );
}

export function decodeTelebirrDeviceBridgeAssignmentPollPayload(
  candidate: unknown,
): TelebirrDeviceBridgeAssignmentPollPayload | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, assignmentPollPayloadKeys)
  ) {
    return undefined;
  }
  const requestedLeaseSeconds = ownDataValue(candidate, 'requestedLeaseSeconds');
  return typeof requestedLeaseSeconds === 'number' &&
    Number.isSafeInteger(requestedLeaseSeconds) &&
    requestedLeaseSeconds >= 30 &&
    requestedLeaseSeconds <= 300
    ? Object.freeze({ requestedLeaseSeconds })
    : undefined;
}

export function decodeTelebirrDeviceBridgeHeartbeatPayload(
  candidate: unknown,
): TelebirrDeviceBridgeHeartbeatPayload | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, heartbeatPayloadKeys)
  ) {
    return undefined;
  }
  const runtimeState = ownDataValue(candidate, 'runtimeState');
  const statusCode = ownDataValue(candidate, 'statusCode');
  const appVersion = version(ownDataValue(candidate, 'appVersion'));
  if (
    runtimeState !== 'enrollment_required' &&
    runtimeState !== 'ready' &&
    runtimeState !== 'busy' &&
    runtimeState !== 'upload_pending' &&
    runtimeState !== 'attention'
  ) {
    return undefined;
  }
  return typeof statusCode === 'string' && STATUS_CODE_PATTERN.test(statusCode) && appVersion
    ? Object.freeze({ runtimeState, statusCode, appVersion })
    : undefined;
}

export function decodeTelebirrDeviceBridgeObservationUploadPayload(
  candidate: unknown,
): TelebirrDeviceBridgeObservationUploadPayload | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, observationUploadPayloadKeys)
  ) {
    return undefined;
  }
  const signedAssignment = decodeTelebirrLivePilotSignedAssignment(
    ownDataValue(candidate, 'signedAssignment'),
  );
  const signedObservation = decodeTelebirrLivePilotSignedObservation(
    ownDataValue(candidate, 'signedObservation'),
  );
  if (
    !signedAssignment ||
    !signedObservation ||
    signedAssignment.bodyDigest !== signedObservation.body.assignmentBodyDigest ||
    signedAssignment.body.assignmentId !== signedObservation.body.assignmentId ||
    signedAssignment.body.deviceId !== signedObservation.body.deviceId ||
    signedAssignment.body.keyId !== signedObservation.body.keyId ||
    digestTelebirrLivePilotAssignmentBody(signedAssignment.body) !== signedAssignment.bodyDigest ||
    digestTelebirrLivePilotObservationBody(signedObservation.body) !== signedObservation.bodyDigest
  ) {
    return undefined;
  }
  return Object.freeze({ signedAssignment, signedObservation });
}

export function digestTelebirrDeviceBridgePayload(
  command: TelebirrDeviceBridgeCommand,
  candidate: unknown,
): string | undefined {
  switch (command) {
    case 'assignment_poll': {
      const payload = decodeTelebirrDeviceBridgeAssignmentPollPayload(candidate);
      return payload
        ? sha256(
            encodeFields('fetanagent:telebirr:device-bridge:assignment-poll-payload:v1', [
              ['requestedLeaseSeconds', payload.requestedLeaseSeconds],
            ]),
          )
        : undefined;
    }
    case 'heartbeat': {
      const payload = decodeTelebirrDeviceBridgeHeartbeatPayload(candidate);
      return payload
        ? sha256(
            encodeFields('fetanagent:telebirr:device-bridge:heartbeat-payload:v1', [
              ['runtimeState', payload.runtimeState],
              ['statusCode', payload.statusCode],
              ['appVersion', payload.appVersion],
            ]),
          )
        : undefined;
    }
    case 'observation_upload': {
      const payload = decodeTelebirrDeviceBridgeObservationUploadPayload(candidate);
      return payload
        ? sha256(
            encodeFields('fetanagent:telebirr:device-bridge:observation-upload-payload:v1', [
              ['assignmentBodyDigest', payload.signedAssignment.bodyDigest],
              [
                'assignmentSignatureDigest',
                sha256(Buffer.from(payload.signedAssignment.signature, 'base64url')),
              ],
              ['observationBodyDigest', payload.signedObservation.bodyDigest],
              [
                'observationSignatureDigest',
                sha256(Buffer.from(payload.signedObservation.signature, 'base64url')),
              ],
            ]),
          )
        : undefined;
    }
  }
}

export function decodeTelebirrDeviceBridgeCommandFrame(
  candidate: unknown,
): TelebirrDeviceBridgeCommandFrame | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, commandFrameKeys)
  ) {
    return undefined;
  }
  const request = decodeSignedTelebirrDeviceBridgeRequest(ownDataValue(candidate, 'request'));
  if (!request) return undefined;
  const rawPayload = ownDataValue(candidate, 'payload');
  const payload =
    request.body.command === 'assignment_poll'
      ? decodeTelebirrDeviceBridgeAssignmentPollPayload(rawPayload)
      : request.body.command === 'heartbeat'
        ? decodeTelebirrDeviceBridgeHeartbeatPayload(rawPayload)
        : decodeTelebirrDeviceBridgeObservationUploadPayload(rawPayload);
  const payloadDigest = digestTelebirrDeviceBridgePayload(request.body.command, payload);
  return payload && payloadDigest === request.body.payloadDigest
    ? Object.freeze({ request, payload })
    : undefined;
}

function validAcknowledgementSemantics(
  command: TelebirrDeviceBridgeCommand,
  outcome: TelebirrDeviceBridgeAcknowledgementOutcome,
  assignmentBodyDigest: string | null,
  observationBodyDigest: string | null,
  reasonCode: TelebirrDeviceBridgeReasonCode | null,
): boolean {
  if (outcome === 'assignment') {
    return (
      command === 'assignment_poll' &&
      assignmentBodyDigest !== null &&
      observationBodyDigest === null &&
      reasonCode === null
    );
  }
  if (outcome === 'no_assignment') {
    return (
      command === 'assignment_poll' &&
      assignmentBodyDigest === null &&
      observationBodyDigest === null &&
      reasonCode === null
    );
  }
  if (outcome === 'acknowledged') {
    return command === 'heartbeat'
      ? assignmentBodyDigest === null && observationBodyDigest === null && reasonCode === null
      : command === 'observation_upload' &&
          assignmentBodyDigest !== null &&
          observationBodyDigest !== null &&
          reasonCode === null;
  }
  if (outcome === 'retry') {
    return (
      assignmentBodyDigest === null &&
      observationBodyDigest === null &&
      reasonCode === 'temporary_unavailable'
    );
  }
  return (
    outcome === 'rejected' &&
    assignmentBodyDigest === null &&
    observationBodyDigest === null &&
    reasonCode !== null &&
    reasonCode !== 'temporary_unavailable'
  );
}

export function decodeTelebirrDeviceBridgeAcknowledgementBody(
  candidate: unknown,
): TelebirrDeviceBridgeAcknowledgementBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, acknowledgementBodyKeys) ||
      !hasHeader(candidate) ||
      !hasSafety(candidate)
    ) {
      return undefined;
    }
    const acknowledgementId = opaque(ownDataValue(candidate, 'acknowledgementId'));
    const requestId = opaque(ownDataValue(candidate, 'requestId'));
    const enrollmentId = opaque(ownDataValue(candidate, 'enrollmentId'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const command = parseCommand(ownDataValue(candidate, 'command'));
    const requestBodyDigest = digest(ownDataValue(candidate, 'requestBodyDigest'));
    const requestPayloadDigest = digest(ownDataValue(candidate, 'requestPayloadDigest'));
    const outcome = ownDataValue(candidate, 'outcome');
    const assignmentCandidate = ownDataValue(candidate, 'assignmentBodyDigest');
    const observationCandidate = ownDataValue(candidate, 'observationBodyDigest');
    const reasonCandidate = ownDataValue(candidate, 'reasonCode');
    const assignmentBodyDigest = assignmentCandidate === null ? null : digest(assignmentCandidate);
    const observationBodyDigest =
      observationCandidate === null ? null : digest(observationCandidate);
    const reasonCode = reasonCandidate === null ? null : parseReasonCode(reasonCandidate);
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const expiresAt = timestamp(ownDataValue(candidate, 'expiresAt'));
    if (
      !acknowledgementId ||
      !requestId ||
      !enrollmentId ||
      !deviceId ||
      !keyId ||
      !command ||
      !requestBodyDigest ||
      !requestPayloadDigest ||
      (outcome !== 'assignment' &&
        outcome !== 'no_assignment' &&
        outcome !== 'acknowledged' &&
        outcome !== 'retry' &&
        outcome !== 'rejected') ||
      assignmentBodyDigest === undefined ||
      observationBodyDigest === undefined ||
      reasonCode === undefined ||
      !validAcknowledgementSemantics(
        command,
        outcome,
        assignmentBodyDigest,
        observationBodyDigest,
        reasonCode,
      ) ||
      !issuedAt ||
      !expiresAt ||
      !validLifetime(issuedAt, expiresAt, MAX_ACKNOWLEDGEMENT_LIFETIME_MS)
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
      providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
      protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
      acknowledgementId,
      requestId,
      enrollmentId,
      deviceId,
      keyId,
      command,
      requestBodyDigest,
      requestPayloadDigest,
      outcome,
      assignmentBodyDigest,
      observationBodyDigest,
      reasonCode,
      issuedAt,
      expiresAt,
      ...safety,
    });
  } catch {
    return undefined;
  }
}

function acknowledgementBodyFields(
  body: TelebirrDeviceBridgeAcknowledgementBody,
): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['providerCode', body.providerCode],
    ['protocolMode', body.protocolMode],
    ['acknowledgementId', body.acknowledgementId],
    ['requestId', body.requestId],
    ['enrollmentId', body.enrollmentId],
    ['deviceId', body.deviceId],
    ['keyId', body.keyId],
    ['command', body.command],
    ['requestBodyDigest', body.requestBodyDigest],
    ['requestPayloadDigest', body.requestPayloadDigest],
    ['outcome', body.outcome],
    ['assignmentBodyDigest', body.assignmentBodyDigest],
    ['observationBodyDigest', body.observationBodyDigest],
    ['reasonCode', body.reasonCode],
    ['issuedAt', body.issuedAt],
    ['expiresAt', body.expiresAt],
    ...safetyFields(body),
  ];
}

export function canonicalTelebirrDeviceBridgeAcknowledgementBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrDeviceBridgeAcknowledgementBody(candidate);
  return body
    ? encodeFields(
        'fetanagent:telebirr:device-bridge:acknowledgement-body:v1',
        acknowledgementBodyFields(body),
      )
    : undefined;
}

export function digestTelebirrDeviceBridgeAcknowledgementBody(
  candidate: unknown,
): string | undefined {
  const bytes = canonicalTelebirrDeviceBridgeAcknowledgementBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes(
  candidate: unknown,
  signerKeyIdCandidate: unknown,
): Buffer | undefined {
  const body = decodeTelebirrDeviceBridgeAcknowledgementBody(candidate);
  const bodyDigest = body && digestTelebirrDeviceBridgeAcknowledgementBody(body);
  const signerKeyId = opaque(signerKeyIdCandidate);
  return body && bodyDigest && signerKeyId
    ? encodeFields('fetanagent:telebirr:device-bridge:acknowledgement-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['providerCode', body.providerCode],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM],
        ['signatureEncoding', TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING],
        ['signerKeyId', signerKeyId],
      ])
    : undefined;
}

export function decodeSignedTelebirrDeviceBridgeAcknowledgement(
  candidate: unknown,
): SignedTelebirrDeviceBridgeAcknowledgement | undefined {
  return decodeServerEnvelope(
    candidate,
    TELEBIRR_DEVICE_BRIDGE_ACKNOWLEDGEMENT_TRANSCRIPT_VERSION,
    decodeTelebirrDeviceBridgeAcknowledgementBody,
  ) as SignedTelebirrDeviceBridgeAcknowledgement | undefined;
}

export function verifySignedTelebirrDeviceBridgeAcknowledgement(
  acknowledgementCandidate: unknown,
  requestCandidate: unknown,
  trustedServerPublicKeySpkiDer: unknown,
  assessedAtCandidate: unknown,
): boolean {
  const acknowledgement = decodeSignedTelebirrDeviceBridgeAcknowledgement(acknowledgementCandidate);
  const request = decodeSignedTelebirrDeviceBridgeRequest(requestCandidate);
  const assessedAt = timestamp(assessedAtCandidate);
  const key = parseExternalP256Spki(trustedServerPublicKeySpkiDer);
  if (!acknowledgement || !request || !assessedAt || !key) return false;
  if (
    acknowledgement.body.requestId !== request.body.requestId ||
    acknowledgement.body.enrollmentId !== request.body.enrollmentId ||
    acknowledgement.body.deviceId !== request.body.deviceId ||
    acknowledgement.body.keyId !== request.body.keyId ||
    acknowledgement.body.command !== request.body.command ||
    acknowledgement.body.requestBodyDigest !== request.bodyDigest ||
    acknowledgement.body.requestPayloadDigest !== request.body.payloadDigest ||
    Date.parse(assessedAt) < Date.parse(acknowledgement.body.issuedAt) ||
    Date.parse(assessedAt) >= Date.parse(acknowledgement.body.expiresAt)
  ) {
    return false;
  }
  const bodyDigest = digestTelebirrDeviceBridgeAcknowledgementBody(acknowledgement.body);
  return Boolean(
    bodyDigest === acknowledgement.bodyDigest &&
    verifyP1363(
      canonicalTelebirrDeviceBridgeAcknowledgementSignatureBytes(
        acknowledgement.body,
        acknowledgement.signerKeyId,
      ),
      acknowledgement.signature,
      key,
    ),
  );
}

function decodeDeviceEnvelope<TBody>(
  candidate: unknown,
  transcriptVersion: string,
  decodeBody: (candidate: unknown) => TBody | undefined,
): Record<string, unknown> | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, deviceSignedEnvelopeKeys) ||
      !hasHeader(candidate)
    ) {
      return undefined;
    }
    const body = decodeBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const keyId = opaque(ownDataValue(candidate, 'keyId'));
    const encodedSignature = signature(ownDataValue(candidate, 'signature'));
    const bodyKeyId =
      body && typeof body === 'object' && body !== null && 'keyId' in body
        ? (body as { readonly keyId?: unknown }).keyId
        : undefined;
    if (
      ownDataValue(candidate, 'transcriptVersion') !== transcriptVersion ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !== TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !== TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING ||
      !body ||
      !bodyDigest ||
      !keyId ||
      keyId !== bodyKeyId ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
      providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
      protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
      transcriptVersion,
      bodyDigestAlgorithm: TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
      signatureEncoding: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING,
      keyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

function decodeServerEnvelope<TBody>(
  candidate: unknown,
  transcriptVersion: string,
  decodeBody: (candidate: unknown) => TBody | undefined,
): Record<string, unknown> | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, serverSignedEnvelopeKeys) ||
      !hasHeader(candidate)
    ) {
      return undefined;
    }
    const body = decodeBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const signerKeyId = opaque(ownDataValue(candidate, 'signerKeyId'));
    const encodedSignature = signature(ownDataValue(candidate, 'signature'));
    if (
      ownDataValue(candidate, 'transcriptVersion') !== transcriptVersion ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !== TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !== TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING ||
      !body ||
      !bodyDigest ||
      !signerKeyId ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
      providerCode: TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
      protocolMode: TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
      transcriptVersion,
      bodyDigestAlgorithm: TELEBIRR_DEVICE_BRIDGE_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ALGORITHM,
      signatureEncoding: TELEBIRR_DEVICE_BRIDGE_SIGNATURE_ENCODING,
      signerKeyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

/** Safe operational projection: never contains identifiers, digests, payloads, or receipt data. */
export function redactedTelebirrDeviceBridgeRequestForLog(candidate: unknown): Readonly<{
  valid: boolean;
  command: TelebirrDeviceBridgeCommand | 'invalid';
  evidenceOnly: true;
  financialActionAllowed: false;
}> {
  const request = decodeSignedTelebirrDeviceBridgeRequest(candidate);
  return Object.freeze({
    valid: Boolean(request),
    command: request?.body.command ?? 'invalid',
    evidenceOnly: true,
    financialActionAllowed: false,
  });
}
