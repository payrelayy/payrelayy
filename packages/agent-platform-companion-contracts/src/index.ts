import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import { isProxy } from 'node:util/types';

/**
 * Provider-neutral security contracts for a locally operated companion.
 *
 * Version 1 deliberately grants only one capability: a read-only, exact-five
 * KemerBet Player-ID lookup. These contracts cannot represent an amount,
 * note, deposit, withdrawal, transfer, final action, or money movement.
 */
export const AGENT_PLATFORM_COMPANION_CONTRACT_VERSION = 1 as const;
export const AGENT_PLATFORM_COMPANION_PROTOCOL_MODE = 'local_companion_no_transfer_v1' as const;
export const AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256' as const;
export const AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING = 'ieee-p1363-base64url' as const;
export const AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM = 'sha256' as const;
export const AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM = 'windows' as const;
export const AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION =
  'agent-platform-companion-pairing-transcript-v1' as const;
export const AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION =
  'agent-platform-companion-certificate-transcript-v1' as const;
export const AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION =
  'agent-platform-companion-http-request-transcript-v1' as const;
export const AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION =
  'agent-platform-companion-lookup-assignment-transcript-v1' as const;
export const AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION =
  'agent-platform-companion-lookup-result-transcript-v1' as const;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const P1363_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PATH_PATTERN = /^\/[a-z0-9][a-z0-9/_-]{0,191}$/u;
const MAX_SPKI_BYTES = 512;
const MAX_PAIRING_LIFETIME_MS = 10 * 60 * 1_000;
const MAX_HTTP_REQUEST_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_ASSIGNMENT_LIFETIME_MS = 10 * 60 * 1_000;

export interface CompanionNoMoneySafety {
  readonly accountMutationAllowed: false;
  readonly balanceMutationAllowed: false;
  readonly providerMutationAllowed: false;
  readonly paymentAllowed: false;
  readonly depositAllowed: false;
  readonly withdrawAllowed: false;
  readonly transferAllowed: false;
  readonly settlementAllowed: false;
  readonly finalActionAllowed: false;
  readonly financialActionAllowed: false;
  readonly moneyMovementAllowed: false;
  readonly transferDisabled: true;
  readonly identifiersRedacted: true;
  readonly moneyMoved: false;
}

export interface CompanionPairingPublicPayload extends CompanionNoMoneySafety {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly pairingId: string;
  readonly pairingNonceDigest: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly devicePublicKeySpki: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly signatureAlgorithm: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM;
  readonly devicePlatform: typeof AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM;
  readonly companionVersion: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly oneUse: true;
}

export interface SignedCompanionPairingRequest {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING;
  readonly deviceKeyId: string;
  readonly body: CompanionPairingPublicPayload;
  readonly signature: string;
}

export interface CompanionEnrollmentCertificateBody extends CompanionNoMoneySafety {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly certificateId: string;
  readonly pairingId: string;
  readonly pairingRequestBodyDigest: string;
  readonly pairingNonceDigest: string;
  readonly pairingConsumed: true;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly devicePublicKeySpki: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly signatureAlgorithm: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM;
  readonly devicePlatform: typeof AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM;
  readonly companionVersion: string;
  readonly state: 'active' | 'revoked';
  readonly issuedAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface SignedCompanionEnrollmentCertificate {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: CompanionEnrollmentCertificateBody;
  readonly signature: string;
}

export interface CompanionHttpRequestBody extends CompanionNoMoneySafety {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly requestId: string;
  readonly certificateId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly method: 'GET' | 'POST';
  readonly canonicalPath: string;
  readonly queryDigest: string;
  readonly contentDigest: string;
  readonly nonceDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SignedCompanionHttpRequest {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING;
  readonly deviceKeyId: string;
  readonly body: CompanionHttpRequestBody;
  readonly signature: string;
}

export type ExactFivePlayerIds = readonly [string, string, string, string, string];

export interface KemerBetExactFiveLookupAssignmentBody extends CompanionNoMoneySafety {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly assignmentId: string;
  readonly requestId: string;
  readonly certificateId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly platformCode: 'kemerbet';
  readonly assignmentKind: 'exact_five_player_lookup';
  readonly lookupMode: 'find_only';
  readonly playerIds: ExactFivePlayerIds;
  readonly currencyCode: 'ETB';
  readonly leaseNonceDigest: string;
  readonly oneUse: true;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SignedKemerBetExactFiveLookupAssignment {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING;
  readonly signerKeyId: string;
  readonly body: KemerBetExactFiveLookupAssignmentBody;
  readonly signature: string;
}

export type CompanionPlayerLookupOutcome = 'found' | 'not_found' | 'review_required';

export interface CompanionPlayerLookupResultItem {
  readonly playerIndex: 0 | 1 | 2 | 3 | 4;
  readonly playerIdDigest: string;
  readonly outcome: CompanionPlayerLookupOutcome;
}

export type ExactFiveLookupResultItems = readonly [
  CompanionPlayerLookupResultItem,
  CompanionPlayerLookupResultItem,
  CompanionPlayerLookupResultItem,
  CompanionPlayerLookupResultItem,
  CompanionPlayerLookupResultItem,
];

export interface KemerBetExactFiveLookupResultBody extends CompanionNoMoneySafety {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly resultId: string;
  readonly assignmentId: string;
  readonly assignmentBodyDigest: string;
  readonly requestId: string;
  readonly certificateId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly platformCode: 'kemerbet';
  readonly assignmentKind: 'exact_five_player_lookup';
  readonly lookupMode: 'find_only';
  readonly currencyCode: 'ETB';
  readonly items: ExactFiveLookupResultItems;
  readonly foundCount: number;
  readonly notFoundCount: number;
  readonly reviewRequiredCount: number;
  readonly observedAt: string;
}

export interface SignedKemerBetExactFiveLookupResult {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly transcriptVersion: typeof AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: typeof AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM;
  readonly bodyDigest: string;
  readonly signatureAlgorithm: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM;
  readonly signatureEncoding: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING;
  readonly deviceKeyId: string;
  readonly body: KemerBetExactFiveLookupResultBody;
  readonly signature: string;
}

type UnknownRecord = Record<string, unknown>;
type Scalar = string | number | boolean | null;
type CanonicalField = readonly [string, Scalar];

const safetyKeys = [
  'accountMutationAllowed',
  'balanceMutationAllowed',
  'providerMutationAllowed',
  'paymentAllowed',
  'depositAllowed',
  'withdrawAllowed',
  'transferAllowed',
  'settlementAllowed',
  'finalActionAllowed',
  'financialActionAllowed',
  'moneyMovementAllowed',
  'transferDisabled',
  'identifiersRedacted',
  'moneyMoved',
] as const;

const pairingBodyKeys = [
  'contractVersion',
  'protocolMode',
  'pairingId',
  'pairingNonceDigest',
  'deviceId',
  'deviceKeyId',
  'devicePublicKeySpki',
  'devicePublicKeySpkiSha256',
  'signatureAlgorithm',
  'devicePlatform',
  'companionVersion',
  'issuedAt',
  'expiresAt',
  'oneUse',
  ...safetyKeys,
] as const;

const certificateBodyKeys = [
  'contractVersion',
  'protocolMode',
  'certificateId',
  'pairingId',
  'pairingRequestBodyDigest',
  'pairingNonceDigest',
  'pairingConsumed',
  'deviceId',
  'deviceKeyId',
  'devicePublicKeySpki',
  'devicePublicKeySpkiSha256',
  'signatureAlgorithm',
  'devicePlatform',
  'companionVersion',
  'state',
  'issuedAt',
  'validFrom',
  'validUntil',
  ...safetyKeys,
] as const;

const httpBodyKeys = [
  'contractVersion',
  'protocolMode',
  'requestId',
  'certificateId',
  'deviceId',
  'deviceKeyId',
  'method',
  'canonicalPath',
  'queryDigest',
  'contentDigest',
  'nonceDigest',
  'issuedAt',
  'expiresAt',
  ...safetyKeys,
] as const;

const assignmentBodyKeys = [
  'contractVersion',
  'protocolMode',
  'assignmentId',
  'requestId',
  'certificateId',
  'deviceId',
  'deviceKeyId',
  'platformCode',
  'assignmentKind',
  'lookupMode',
  'playerIds',
  'currencyCode',
  'leaseNonceDigest',
  'oneUse',
  'issuedAt',
  'expiresAt',
  ...safetyKeys,
] as const;

const resultItemKeys = ['playerIndex', 'playerIdDigest', 'outcome'] as const;

const resultBodyKeys = [
  'contractVersion',
  'protocolMode',
  'resultId',
  'assignmentId',
  'assignmentBodyDigest',
  'requestId',
  'certificateId',
  'deviceId',
  'deviceKeyId',
  'platformCode',
  'assignmentKind',
  'lookupMode',
  'currencyCode',
  'items',
  'foundCount',
  'notFoundCount',
  'reviewRequiredCount',
  'observedAt',
  ...safetyKeys,
] as const;

const deviceSignedEnvelopeKeys = [
  'contractVersion',
  'protocolMode',
  'transcriptVersion',
  'bodyDigestAlgorithm',
  'bodyDigest',
  'signatureAlgorithm',
  'signatureEncoding',
  'deviceKeyId',
  'body',
  'signature',
] as const;

const serverSignedEnvelopeKeys = [
  'contractVersion',
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

const safety: CompanionNoMoneySafety = Object.freeze({
  accountMutationAllowed: false,
  balanceMutationAllowed: false,
  providerMutationAllowed: false,
  paymentAllowed: false,
  depositAllowed: false,
  withdrawAllowed: false,
  transferAllowed: false,
  settlementAllowed: false,
  finalActionAllowed: false,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  transferDisabled: true,
  identifiersRedacted: true,
  moneyMoved: false,
});

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }
  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function header(value: UnknownRecord): boolean {
  return (
    ownDataValue(value, 'contractVersion') === AGENT_PLATFORM_COMPANION_CONTRACT_VERSION &&
    ownDataValue(value, 'protocolMode') === AGENT_PLATFORM_COMPANION_PROTOCOL_MODE
  );
}

function hasSafeLiterals(value: UnknownRecord): boolean {
  return (
    ownDataValue(value, 'accountMutationAllowed') === false &&
    ownDataValue(value, 'balanceMutationAllowed') === false &&
    ownDataValue(value, 'providerMutationAllowed') === false &&
    ownDataValue(value, 'paymentAllowed') === false &&
    ownDataValue(value, 'depositAllowed') === false &&
    ownDataValue(value, 'withdrawAllowed') === false &&
    ownDataValue(value, 'transferAllowed') === false &&
    ownDataValue(value, 'settlementAllowed') === false &&
    ownDataValue(value, 'finalActionAllowed') === false &&
    ownDataValue(value, 'financialActionAllowed') === false &&
    ownDataValue(value, 'moneyMovementAllowed') === false &&
    ownDataValue(value, 'transferDisabled') === true &&
    ownDataValue(value, 'identifiersRedacted') === true &&
    ownDataValue(value, 'moneyMoved') === false
  );
}

function opaque(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value) ? value : undefined;
}

function digest(value: unknown): string | undefined {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? value : undefined;
}

function version(value: unknown): string | undefined {
  return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function signature(value: unknown): string | undefined {
  return typeof value === 'string' && P1363_BASE64URL_PATTERN.test(value) ? value : undefined;
}

function safeCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 5
    ? (value as number)
    : undefined;
}

function exactDenseArray(value: unknown, length: number): value is unknown[] {
  if (!Array.isArray(value) || isProxy(value) || value.length !== length) return false;
  const expected = ['length', ...Array.from({ length }, (_, index) => String(index))];
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== 'string' || !expected.includes(key))
  ) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
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

function safetyFields(value: CompanionNoMoneySafety): readonly CanonicalField[] {
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

function validLifetime(issuedAt: string, expiresAt: string, maximumMs: number): boolean {
  const start = Date.parse(issuedAt);
  const end = Date.parse(expiresAt);
  return end > start && end - start <= maximumMs;
}

export function decodeCompanionPairingPublicPayload(
  candidate: unknown,
): CompanionPairingPublicPayload | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, pairingBodyKeys) ||
      !header(candidate) ||
      !hasSafeLiterals(candidate)
    ) {
      return undefined;
    }
    const pairingId = opaque(ownDataValue(candidate, 'pairingId'));
    const pairingNonceDigest = digest(ownDataValue(candidate, 'pairingNonceDigest'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const deviceKeyId = opaque(ownDataValue(candidate, 'deviceKeyId'));
    const devicePublicKeySpki = parseP256Spki(ownDataValue(candidate, 'devicePublicKeySpki'));
    const devicePublicKeySpkiSha256 = digest(ownDataValue(candidate, 'devicePublicKeySpkiSha256'));
    const companionVersion = version(ownDataValue(candidate, 'companionVersion'));
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const expiresAt = timestamp(ownDataValue(candidate, 'expiresAt'));
    if (
      !pairingId ||
      !pairingNonceDigest ||
      !deviceId ||
      !deviceKeyId ||
      !devicePublicKeySpki ||
      !devicePublicKeySpkiSha256 ||
      devicePublicKeySpki.digest !== devicePublicKeySpkiSha256 ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'devicePlatform') !== AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM ||
      !companionVersion ||
      !issuedAt ||
      !expiresAt ||
      !validLifetime(issuedAt, expiresAt, MAX_PAIRING_LIFETIME_MS) ||
      ownDataValue(candidate, 'oneUse') !== true
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      pairingId,
      pairingNonceDigest,
      deviceId,
      deviceKeyId,
      devicePublicKeySpki: devicePublicKeySpki.encoded,
      devicePublicKeySpkiSha256,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      devicePlatform: AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
      companionVersion,
      issuedAt,
      expiresAt,
      oneUse: true,
      ...safety,
    });
  } catch {
    return undefined;
  }
}

function pairingBodyFields(body: CompanionPairingPublicPayload): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['protocolMode', body.protocolMode],
    ['pairingId', body.pairingId],
    ['pairingNonceDigest', body.pairingNonceDigest],
    ['deviceId', body.deviceId],
    ['deviceKeyId', body.deviceKeyId],
    ['devicePublicKeySpki', body.devicePublicKeySpki],
    ['devicePublicKeySpkiSha256', body.devicePublicKeySpkiSha256],
    ['signatureAlgorithm', body.signatureAlgorithm],
    ['devicePlatform', body.devicePlatform],
    ['companionVersion', body.companionVersion],
    ['issuedAt', body.issuedAt],
    ['expiresAt', body.expiresAt],
    ['oneUse', body.oneUse],
    ...safetyFields(body),
  ];
}

export function canonicalCompanionPairingPublicPayloadBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeCompanionPairingPublicPayload(candidate);
  return body
    ? encodeFields(
        'fetanagent:agent-platform-companion:pairing-public-payload:v1',
        pairingBodyFields(body),
      )
    : undefined;
}

export function digestCompanionPairingPublicPayload(candidate: unknown): string | undefined {
  const bytes = canonicalCompanionPairingPublicPayloadBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalCompanionPairingSignatureBytes(candidate: unknown): Buffer | undefined {
  const body = decodeCompanionPairingPublicPayload(candidate);
  const bodyDigest = body && digestCompanionPairingPublicPayload(body);
  return body && bodyDigest
    ? encodeFields('fetanagent:agent-platform-companion:pairing-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM],
        ['signatureEncoding', AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING],
        ['deviceKeyId', body.deviceKeyId],
      ])
    : undefined;
}

export function decodeSignedCompanionPairingRequest(
  candidate: unknown,
): SignedCompanionPairingRequest | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, deviceSignedEnvelopeKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const body = decodeCompanionPairingPublicPayload(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const deviceKeyId = opaque(ownDataValue(candidate, 'deviceKeyId'));
    const encodedSignature = signature(ownDataValue(candidate, 'signature'));
    if (
      ownDataValue(candidate, 'transcriptVersion') !==
        AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !==
        AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM ||
      !bodyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING ||
      !deviceKeyId ||
      !body ||
      body.deviceKeyId !== deviceKeyId ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      deviceKeyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

export function verifySignedCompanionPairingRequest(candidate: unknown): boolean {
  const envelope = decodeSignedCompanionPairingRequest(candidate);
  if (!envelope) return false;
  const computedDigest = digestCompanionPairingPublicPayload(envelope.body);
  const publicKey = parseP256Spki(envelope.body.devicePublicKeySpki);
  return Boolean(
    computedDigest &&
    computedDigest === envelope.bodyDigest &&
    publicKey &&
    verifyP1363(
      canonicalCompanionPairingSignatureBytes(envelope.body),
      envelope.signature,
      publicKey.key,
    ),
  );
}

export function deriveCompanionPairingReplayIdentity(candidate: unknown): string | undefined {
  const envelope = decodeSignedCompanionPairingRequest(candidate);
  const computedDigest = envelope && digestCompanionPairingPublicPayload(envelope.body);
  return envelope && computedDigest === envelope.bodyDigest
    ? sha256(
        encodeFields('fetanagent:agent-platform-companion:pairing-replay-identity:v1', [
          ['pairingId', envelope.body.pairingId],
          ['pairingNonceDigest', envelope.body.pairingNonceDigest],
          ['deviceId', envelope.body.deviceId],
          ['deviceKeyId', envelope.body.deviceKeyId],
          ['bodyDigest', envelope.bodyDigest],
        ]),
      )
    : undefined;
}

export function decodeCompanionEnrollmentCertificateBody(
  candidate: unknown,
): CompanionEnrollmentCertificateBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, certificateBodyKeys) ||
      !header(candidate) ||
      !hasSafeLiterals(candidate)
    ) {
      return undefined;
    }
    const certificateId = opaque(ownDataValue(candidate, 'certificateId'));
    const pairingId = opaque(ownDataValue(candidate, 'pairingId'));
    const pairingRequestBodyDigest = digest(ownDataValue(candidate, 'pairingRequestBodyDigest'));
    const pairingNonceDigest = digest(ownDataValue(candidate, 'pairingNonceDigest'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const deviceKeyId = opaque(ownDataValue(candidate, 'deviceKeyId'));
    const devicePublicKeySpki = parseP256Spki(ownDataValue(candidate, 'devicePublicKeySpki'));
    const devicePublicKeySpkiSha256 = digest(ownDataValue(candidate, 'devicePublicKeySpkiSha256'));
    const companionVersion = version(ownDataValue(candidate, 'companionVersion'));
    const state = ownDataValue(candidate, 'state');
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const validFrom = timestamp(ownDataValue(candidate, 'validFrom'));
    const validUntil = timestamp(ownDataValue(candidate, 'validUntil'));
    if (
      !certificateId ||
      !pairingId ||
      !pairingRequestBodyDigest ||
      !pairingNonceDigest ||
      ownDataValue(candidate, 'pairingConsumed') !== true ||
      !deviceId ||
      !deviceKeyId ||
      !devicePublicKeySpki ||
      !devicePublicKeySpkiSha256 ||
      devicePublicKeySpki.digest !== devicePublicKeySpkiSha256 ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'devicePlatform') !== AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM ||
      !companionVersion ||
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
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      certificateId,
      pairingId,
      pairingRequestBodyDigest,
      pairingNonceDigest,
      pairingConsumed: true,
      deviceId,
      deviceKeyId,
      devicePublicKeySpki: devicePublicKeySpki.encoded,
      devicePublicKeySpkiSha256,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      devicePlatform: AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
      companionVersion,
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

function certificateBodyFields(
  body: CompanionEnrollmentCertificateBody,
): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['protocolMode', body.protocolMode],
    ['certificateId', body.certificateId],
    ['pairingId', body.pairingId],
    ['pairingRequestBodyDigest', body.pairingRequestBodyDigest],
    ['pairingNonceDigest', body.pairingNonceDigest],
    ['pairingConsumed', body.pairingConsumed],
    ['deviceId', body.deviceId],
    ['deviceKeyId', body.deviceKeyId],
    ['devicePublicKeySpki', body.devicePublicKeySpki],
    ['devicePublicKeySpkiSha256', body.devicePublicKeySpkiSha256],
    ['signatureAlgorithm', body.signatureAlgorithm],
    ['devicePlatform', body.devicePlatform],
    ['companionVersion', body.companionVersion],
    ['state', body.state],
    ['issuedAt', body.issuedAt],
    ['validFrom', body.validFrom],
    ['validUntil', body.validUntil],
    ...safetyFields(body),
  ];
}

export function canonicalCompanionEnrollmentCertificateBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeCompanionEnrollmentCertificateBody(candidate);
  return body
    ? encodeFields(
        'fetanagent:agent-platform-companion:enrollment-certificate-body:v1',
        certificateBodyFields(body),
      )
    : undefined;
}

export function digestCompanionEnrollmentCertificateBody(candidate: unknown): string | undefined {
  const bytes = canonicalCompanionEnrollmentCertificateBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalCompanionEnrollmentCertificateSignatureBytes(
  candidate: unknown,
  signerKeyIdCandidate: unknown,
): Buffer | undefined {
  const body = decodeCompanionEnrollmentCertificateBody(candidate);
  const bodyDigest = body && digestCompanionEnrollmentCertificateBody(body);
  const signerKeyId = opaque(signerKeyIdCandidate);
  return body && bodyDigest && signerKeyId
    ? encodeFields('fetanagent:agent-platform-companion:enrollment-certificate-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM],
        ['signatureEncoding', AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING],
        ['signerKeyId', signerKeyId],
      ])
    : undefined;
}

export function decodeSignedCompanionEnrollmentCertificate(
  candidate: unknown,
): SignedCompanionEnrollmentCertificate | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, serverSignedEnvelopeKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const body = decodeCompanionEnrollmentCertificateBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const signerKeyId = opaque(ownDataValue(candidate, 'signerKeyId'));
    const encodedSignature = signature(ownDataValue(candidate, 'signature'));
    if (
      ownDataValue(candidate, 'transcriptVersion') !==
        AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !==
        AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM ||
      !bodyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING ||
      !signerKeyId ||
      !body ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      signerKeyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

export function verifySignedCompanionEnrollmentCertificate(
  candidate: unknown,
  trustedServerPublicKeySpkiDer: unknown,
): boolean {
  const envelope = decodeSignedCompanionEnrollmentCertificate(candidate);
  const key = parseExternalP256Spki(trustedServerPublicKeySpkiDer);
  const computedDigest = envelope && digestCompanionEnrollmentCertificateBody(envelope.body);
  return Boolean(
    envelope &&
    computedDigest === envelope.bodyDigest &&
    verifyP1363(
      canonicalCompanionEnrollmentCertificateSignatureBytes(envelope.body, envelope.signerKeyId),
      envelope.signature,
      key,
    ),
  );
}

export function certificateMatchesPairingRequest(
  certificateCandidate: unknown,
  pairingRequestCandidate: unknown,
): boolean {
  const certificate = decodeSignedCompanionEnrollmentCertificate(certificateCandidate);
  const pairing = decodeSignedCompanionPairingRequest(pairingRequestCandidate);
  if (!certificate || !pairing || !verifySignedCompanionPairingRequest(pairing)) return false;
  const certificateBody = certificate.body;
  const pairingBody = pairing.body;
  return (
    certificateBody.pairingId === pairingBody.pairingId &&
    certificateBody.pairingRequestBodyDigest === pairing.bodyDigest &&
    certificateBody.pairingNonceDigest === pairingBody.pairingNonceDigest &&
    certificateBody.deviceId === pairingBody.deviceId &&
    certificateBody.deviceKeyId === pairingBody.deviceKeyId &&
    certificateBody.devicePublicKeySpki === pairingBody.devicePublicKeySpki &&
    certificateBody.devicePublicKeySpkiSha256 === pairingBody.devicePublicKeySpkiSha256 &&
    certificateBody.devicePlatform === pairingBody.devicePlatform &&
    certificateBody.companionVersion === pairingBody.companionVersion &&
    Date.parse(certificateBody.issuedAt) >= Date.parse(pairingBody.issuedAt) &&
    Date.parse(certificateBody.issuedAt) < Date.parse(pairingBody.expiresAt)
  );
}

export function decodeCompanionHttpRequestBody(
  candidate: unknown,
): CompanionHttpRequestBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, httpBodyKeys) ||
      !header(candidate) ||
      !hasSafeLiterals(candidate)
    ) {
      return undefined;
    }
    const requestId = opaque(ownDataValue(candidate, 'requestId'));
    const certificateId = opaque(ownDataValue(candidate, 'certificateId'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const deviceKeyId = opaque(ownDataValue(candidate, 'deviceKeyId'));
    const method = ownDataValue(candidate, 'method');
    const canonicalPath = ownDataValue(candidate, 'canonicalPath');
    const queryDigest = digest(ownDataValue(candidate, 'queryDigest'));
    const contentDigest = digest(ownDataValue(candidate, 'contentDigest'));
    const nonceDigest = digest(ownDataValue(candidate, 'nonceDigest'));
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const expiresAt = timestamp(ownDataValue(candidate, 'expiresAt'));
    if (
      !requestId ||
      !certificateId ||
      !deviceId ||
      !deviceKeyId ||
      (method !== 'GET' && method !== 'POST') ||
      typeof canonicalPath !== 'string' ||
      !PATH_PATTERN.test(canonicalPath) ||
      canonicalPath.includes('//') ||
      canonicalPath.includes('/../') ||
      canonicalPath.endsWith('/..') ||
      !queryDigest ||
      !contentDigest ||
      !nonceDigest ||
      !issuedAt ||
      !expiresAt ||
      !validLifetime(issuedAt, expiresAt, MAX_HTTP_REQUEST_LIFETIME_MS)
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      requestId,
      certificateId,
      deviceId,
      deviceKeyId,
      method,
      canonicalPath,
      queryDigest,
      contentDigest,
      nonceDigest,
      issuedAt,
      expiresAt,
      ...safety,
    });
  } catch {
    return undefined;
  }
}

function httpBodyFields(body: CompanionHttpRequestBody): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['protocolMode', body.protocolMode],
    ['requestId', body.requestId],
    ['certificateId', body.certificateId],
    ['deviceId', body.deviceId],
    ['deviceKeyId', body.deviceKeyId],
    ['method', body.method],
    ['canonicalPath', body.canonicalPath],
    ['queryDigest', body.queryDigest],
    ['contentDigest', body.contentDigest],
    ['nonceDigest', body.nonceDigest],
    ['issuedAt', body.issuedAt],
    ['expiresAt', body.expiresAt],
    ...safetyFields(body),
  ];
}

export function canonicalCompanionHttpRequestBodyBytes(candidate: unknown): Buffer | undefined {
  const body = decodeCompanionHttpRequestBody(candidate);
  return body
    ? encodeFields('fetanagent:agent-platform-companion:http-request-body:v1', httpBodyFields(body))
    : undefined;
}

export function digestCompanionHttpRequestBody(candidate: unknown): string | undefined {
  const bytes = canonicalCompanionHttpRequestBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalCompanionHttpRequestSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeCompanionHttpRequestBody(candidate);
  const bodyDigest = body && digestCompanionHttpRequestBody(body);
  return body && bodyDigest
    ? encodeFields('fetanagent:agent-platform-companion:http-request-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM],
        ['signatureEncoding', AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING],
        ['deviceKeyId', body.deviceKeyId],
      ])
    : undefined;
}

export function decodeSignedCompanionHttpRequest(
  candidate: unknown,
): SignedCompanionHttpRequest | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, deviceSignedEnvelopeKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const body = decodeCompanionHttpRequestBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const deviceKeyId = opaque(ownDataValue(candidate, 'deviceKeyId'));
    const encodedSignature = signature(ownDataValue(candidate, 'signature'));
    if (
      ownDataValue(candidate, 'transcriptVersion') !==
        AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !==
        AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM ||
      !bodyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING ||
      !deviceKeyId ||
      !body ||
      deviceKeyId !== body.deviceKeyId ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_HTTP_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      deviceKeyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

export function deriveCompanionHttpRequestReplayIdentity(candidate: unknown): string | undefined {
  const envelope = decodeSignedCompanionHttpRequest(candidate);
  const computedDigest = envelope && digestCompanionHttpRequestBody(envelope.body);
  return envelope && computedDigest === envelope.bodyDigest
    ? sha256(
        encodeFields('fetanagent:agent-platform-companion:http-request-replay-identity:v1', [
          ['requestId', envelope.body.requestId],
          ['certificateId', envelope.body.certificateId],
          ['deviceId', envelope.body.deviceId],
          ['deviceKeyId', envelope.body.deviceKeyId],
          ['nonceDigest', envelope.body.nonceDigest],
          ['bodyDigest', envelope.bodyDigest],
        ]),
      )
    : undefined;
}

export function verifySignedCompanionHttpRequest(
  candidate: unknown,
  certificateCandidate: unknown,
  trustedServerPublicKeySpkiDer: unknown,
  assessedAtCandidate: unknown,
  consumedReplayIdentities: readonly string[] = [],
): boolean {
  const envelope = decodeSignedCompanionHttpRequest(candidate);
  const certificate = decodeSignedCompanionEnrollmentCertificate(certificateCandidate);
  const assessedAt = timestamp(assessedAtCandidate);
  if (
    !envelope ||
    !certificate ||
    !assessedAt ||
    certificate.body.state !== 'active' ||
    !verifySignedCompanionEnrollmentCertificate(certificate, trustedServerPublicKeySpkiDer)
  ) {
    return false;
  }
  if (
    certificate.body.certificateId !== envelope.body.certificateId ||
    certificate.body.deviceId !== envelope.body.deviceId ||
    certificate.body.deviceKeyId !== envelope.body.deviceKeyId ||
    Date.parse(assessedAt) < Date.parse(certificate.body.validFrom) ||
    Date.parse(assessedAt) >= Date.parse(certificate.body.validUntil) ||
    Date.parse(assessedAt) < Date.parse(envelope.body.issuedAt) ||
    Date.parse(assessedAt) >= Date.parse(envelope.body.expiresAt)
  ) {
    return false;
  }
  const bodyDigest = digestCompanionHttpRequestBody(envelope.body);
  const replayIdentity = deriveCompanionHttpRequestReplayIdentity(envelope);
  const key = parseP256Spki(certificate.body.devicePublicKeySpki)?.key;
  return Boolean(
    bodyDigest === envelope.bodyDigest &&
    replayIdentity &&
    !consumedReplayIdentities.includes(replayIdentity) &&
    verifyP1363(
      canonicalCompanionHttpRequestSignatureBytes(envelope.body),
      envelope.signature,
      key,
    ),
  );
}

function parsePlayerIds(candidate: unknown): ExactFivePlayerIds | undefined {
  if (!exactDenseArray(candidate, 5)) return undefined;
  const ids: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const value = Object.getOwnPropertyDescriptor(candidate, String(index))?.value as unknown;
    if (typeof value !== 'string' || !PLAYER_ID_PATTERN.test(value) || ids.includes(value)) {
      return undefined;
    }
    ids.push(value);
  }
  return Object.freeze(ids) as unknown as ExactFivePlayerIds;
}

export function decodeKemerBetExactFiveLookupAssignmentBody(
  candidate: unknown,
): KemerBetExactFiveLookupAssignmentBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, assignmentBodyKeys) ||
      !header(candidate) ||
      !hasSafeLiterals(candidate)
    ) {
      return undefined;
    }
    const assignmentId = opaque(ownDataValue(candidate, 'assignmentId'));
    const requestId = opaque(ownDataValue(candidate, 'requestId'));
    const certificateId = opaque(ownDataValue(candidate, 'certificateId'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const deviceKeyId = opaque(ownDataValue(candidate, 'deviceKeyId'));
    const playerIds = parsePlayerIds(ownDataValue(candidate, 'playerIds'));
    const leaseNonceDigest = digest(ownDataValue(candidate, 'leaseNonceDigest'));
    const issuedAt = timestamp(ownDataValue(candidate, 'issuedAt'));
    const expiresAt = timestamp(ownDataValue(candidate, 'expiresAt'));
    if (
      !assignmentId ||
      !requestId ||
      !certificateId ||
      !deviceId ||
      !deviceKeyId ||
      ownDataValue(candidate, 'platformCode') !== 'kemerbet' ||
      ownDataValue(candidate, 'assignmentKind') !== 'exact_five_player_lookup' ||
      ownDataValue(candidate, 'lookupMode') !== 'find_only' ||
      !playerIds ||
      ownDataValue(candidate, 'currencyCode') !== 'ETB' ||
      !leaseNonceDigest ||
      ownDataValue(candidate, 'oneUse') !== true ||
      !issuedAt ||
      !expiresAt ||
      !validLifetime(issuedAt, expiresAt, MAX_ASSIGNMENT_LIFETIME_MS)
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      assignmentId,
      requestId,
      certificateId,
      deviceId,
      deviceKeyId,
      platformCode: 'kemerbet',
      assignmentKind: 'exact_five_player_lookup',
      lookupMode: 'find_only',
      playerIds,
      currencyCode: 'ETB',
      leaseNonceDigest,
      oneUse: true,
      issuedAt,
      expiresAt,
      ...safety,
    });
  } catch {
    return undefined;
  }
}

function assignmentBodyFields(
  body: KemerBetExactFiveLookupAssignmentBody,
): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['protocolMode', body.protocolMode],
    ['assignmentId', body.assignmentId],
    ['requestId', body.requestId],
    ['certificateId', body.certificateId],
    ['deviceId', body.deviceId],
    ['deviceKeyId', body.deviceKeyId],
    ['platformCode', body.platformCode],
    ['assignmentKind', body.assignmentKind],
    ['lookupMode', body.lookupMode],
    ['playerIds.length', body.playerIds.length],
    ...body.playerIds.map((playerId, index) => [`playerIds.${String(index)}`, playerId] as const),
    ['currencyCode', body.currencyCode],
    ['leaseNonceDigest', body.leaseNonceDigest],
    ['oneUse', body.oneUse],
    ['issuedAt', body.issuedAt],
    ['expiresAt', body.expiresAt],
    ...safetyFields(body),
  ];
}

export function canonicalKemerBetExactFiveLookupAssignmentBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeKemerBetExactFiveLookupAssignmentBody(candidate);
  return body
    ? encodeFields(
        'fetanagent:agent-platform-companion:kemerbet-exact-five-lookup-assignment-body:v1',
        assignmentBodyFields(body),
      )
    : undefined;
}

export function digestKemerBetExactFiveLookupAssignmentBody(
  candidate: unknown,
): string | undefined {
  const bytes = canonicalKemerBetExactFiveLookupAssignmentBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalKemerBetExactFiveLookupAssignmentSignatureBytes(
  candidate: unknown,
  signerKeyIdCandidate: unknown,
): Buffer | undefined {
  const body = decodeKemerBetExactFiveLookupAssignmentBody(candidate);
  const bodyDigest = body && digestKemerBetExactFiveLookupAssignmentBody(body);
  const signerKeyId = opaque(signerKeyIdCandidate);
  return body && bodyDigest && signerKeyId
    ? encodeFields('fetanagent:agent-platform-companion:lookup-assignment-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM],
        ['signatureEncoding', AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING],
        ['signerKeyId', signerKeyId],
      ])
    : undefined;
}

export function decodeSignedKemerBetExactFiveLookupAssignment(
  candidate: unknown,
): SignedKemerBetExactFiveLookupAssignment | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, serverSignedEnvelopeKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const body = decodeKemerBetExactFiveLookupAssignmentBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const signerKeyId = opaque(ownDataValue(candidate, 'signerKeyId'));
    const encodedSignature = signature(ownDataValue(candidate, 'signature'));
    if (
      ownDataValue(candidate, 'transcriptVersion') !==
        AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !==
        AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM ||
      !bodyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING ||
      !signerKeyId ||
      !body ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_ASSIGNMENT_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      signerKeyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

export function verifySignedKemerBetExactFiveLookupAssignment(
  candidate: unknown,
  trustedServerPublicKeySpkiDer: unknown,
): boolean {
  const envelope = decodeSignedKemerBetExactFiveLookupAssignment(candidate);
  const key = parseExternalP256Spki(trustedServerPublicKeySpkiDer);
  const computedDigest = envelope && digestKemerBetExactFiveLookupAssignmentBody(envelope.body);
  return Boolean(
    envelope &&
    computedDigest === envelope.bodyDigest &&
    verifyP1363(
      canonicalKemerBetExactFiveLookupAssignmentSignatureBytes(envelope.body, envelope.signerKeyId),
      envelope.signature,
      key,
    ),
  );
}

/** One-use identity for consuming an assignment exactly once, independent of result bytes. */
export function deriveKemerBetExactFiveLookupAssignmentReplayIdentity(
  candidate: unknown,
): string | undefined {
  const envelope = decodeSignedKemerBetExactFiveLookupAssignment(candidate);
  const computedDigest = envelope && digestKemerBetExactFiveLookupAssignmentBody(envelope.body);
  return envelope && computedDigest === envelope.bodyDigest
    ? sha256(
        encodeFields('fetanagent:agent-platform-companion:lookup-assignment-replay-identity:v1', [
          ['assignmentId', envelope.body.assignmentId],
          ['requestId', envelope.body.requestId],
          ['certificateId', envelope.body.certificateId],
          ['deviceId', envelope.body.deviceId],
          ['deviceKeyId', envelope.body.deviceKeyId],
          ['leaseNonceDigest', envelope.body.leaseNonceDigest],
          ['bodyDigest', envelope.bodyDigest],
        ]),
      )
    : undefined;
}

export function digestCompanionPlayerId(playerIdCandidate: unknown): string | undefined {
  return typeof playerIdCandidate === 'string' && PLAYER_ID_PATTERN.test(playerIdCandidate)
    ? sha256(
        encodeFields('fetanagent:agent-platform-companion:kemerbet-player-id:v1', [
          ['platformCode', 'kemerbet'],
          ['playerId', playerIdCandidate],
        ]),
      )
    : undefined;
}

function parseResultItems(candidate: unknown): ExactFiveLookupResultItems | undefined {
  if (!exactDenseArray(candidate, 5)) return undefined;
  const items: CompanionPlayerLookupResultItem[] = [];
  const seenDigests = new Set<string>();
  for (let index = 0; index < 5; index += 1) {
    const raw = Object.getOwnPropertyDescriptor(candidate, String(index))?.value as unknown;
    if (!isPlainNonProxyRecord(raw) || !hasExactEnumerableDataKeys(raw, resultItemKeys)) {
      return undefined;
    }
    const playerIndex = ownDataValue(raw, 'playerIndex');
    const playerIdDigest = digest(ownDataValue(raw, 'playerIdDigest'));
    const outcome = ownDataValue(raw, 'outcome');
    if (
      playerIndex !== index ||
      !playerIdDigest ||
      seenDigests.has(playerIdDigest) ||
      (outcome !== 'found' && outcome !== 'not_found' && outcome !== 'review_required')
    ) {
      return undefined;
    }
    seenDigests.add(playerIdDigest);
    items.push(
      Object.freeze({
        playerIndex: playerIndex as 0 | 1 | 2 | 3 | 4,
        playerIdDigest,
        outcome,
      }),
    );
  }
  return Object.freeze(items) as unknown as ExactFiveLookupResultItems;
}

export function decodeKemerBetExactFiveLookupResultBody(
  candidate: unknown,
): KemerBetExactFiveLookupResultBody | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, resultBodyKeys) ||
      !header(candidate) ||
      !hasSafeLiterals(candidate)
    ) {
      return undefined;
    }
    const resultId = opaque(ownDataValue(candidate, 'resultId'));
    const assignmentId = opaque(ownDataValue(candidate, 'assignmentId'));
    const assignmentBodyDigest = digest(ownDataValue(candidate, 'assignmentBodyDigest'));
    const requestId = opaque(ownDataValue(candidate, 'requestId'));
    const certificateId = opaque(ownDataValue(candidate, 'certificateId'));
    const deviceId = opaque(ownDataValue(candidate, 'deviceId'));
    const deviceKeyId = opaque(ownDataValue(candidate, 'deviceKeyId'));
    const items = parseResultItems(ownDataValue(candidate, 'items'));
    const foundCount = safeCount(ownDataValue(candidate, 'foundCount'));
    const notFoundCount = safeCount(ownDataValue(candidate, 'notFoundCount'));
    const reviewRequiredCount = safeCount(ownDataValue(candidate, 'reviewRequiredCount'));
    const observedAt = timestamp(ownDataValue(candidate, 'observedAt'));
    if (
      !resultId ||
      !assignmentId ||
      !assignmentBodyDigest ||
      !requestId ||
      !certificateId ||
      !deviceId ||
      !deviceKeyId ||
      ownDataValue(candidate, 'platformCode') !== 'kemerbet' ||
      ownDataValue(candidate, 'assignmentKind') !== 'exact_five_player_lookup' ||
      ownDataValue(candidate, 'lookupMode') !== 'find_only' ||
      ownDataValue(candidate, 'currencyCode') !== 'ETB' ||
      !items ||
      foundCount === undefined ||
      notFoundCount === undefined ||
      reviewRequiredCount === undefined ||
      foundCount + notFoundCount + reviewRequiredCount !== 5 ||
      items.filter((item) => item.outcome === 'found').length !== foundCount ||
      items.filter((item) => item.outcome === 'not_found').length !== notFoundCount ||
      items.filter((item) => item.outcome === 'review_required').length !== reviewRequiredCount ||
      !observedAt
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      resultId,
      assignmentId,
      assignmentBodyDigest,
      requestId,
      certificateId,
      deviceId,
      deviceKeyId,
      platformCode: 'kemerbet',
      assignmentKind: 'exact_five_player_lookup',
      lookupMode: 'find_only',
      currencyCode: 'ETB',
      items,
      foundCount,
      notFoundCount,
      reviewRequiredCount,
      observedAt,
      ...safety,
    });
  } catch {
    return undefined;
  }
}

function resultBodyFields(body: KemerBetExactFiveLookupResultBody): readonly CanonicalField[] {
  return [
    ['contractVersion', body.contractVersion],
    ['protocolMode', body.protocolMode],
    ['resultId', body.resultId],
    ['assignmentId', body.assignmentId],
    ['assignmentBodyDigest', body.assignmentBodyDigest],
    ['requestId', body.requestId],
    ['certificateId', body.certificateId],
    ['deviceId', body.deviceId],
    ['deviceKeyId', body.deviceKeyId],
    ['platformCode', body.platformCode],
    ['assignmentKind', body.assignmentKind],
    ['lookupMode', body.lookupMode],
    ['currencyCode', body.currencyCode],
    ['items.length', body.items.length],
    ...body.items.flatMap((item, index) => [
      [`items.${String(index)}.playerIndex`, item.playerIndex] as const,
      [`items.${String(index)}.playerIdDigest`, item.playerIdDigest] as const,
      [`items.${String(index)}.outcome`, item.outcome] as const,
    ]),
    ['foundCount', body.foundCount],
    ['notFoundCount', body.notFoundCount],
    ['reviewRequiredCount', body.reviewRequiredCount],
    ['observedAt', body.observedAt],
    ...safetyFields(body),
  ];
}

export function canonicalKemerBetExactFiveLookupResultBodyBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeKemerBetExactFiveLookupResultBody(candidate);
  return body
    ? encodeFields(
        'fetanagent:agent-platform-companion:kemerbet-exact-five-lookup-result-body:v1',
        resultBodyFields(body),
      )
    : undefined;
}

export function digestKemerBetExactFiveLookupResultBody(candidate: unknown): string | undefined {
  const bytes = canonicalKemerBetExactFiveLookupResultBodyBytes(candidate);
  return bytes ? sha256(bytes) : undefined;
}

export function canonicalKemerBetExactFiveLookupResultSignatureBytes(
  candidate: unknown,
): Buffer | undefined {
  const body = decodeKemerBetExactFiveLookupResultBody(candidate);
  const bodyDigest = body && digestKemerBetExactFiveLookupResultBody(body);
  return body && bodyDigest
    ? encodeFields('fetanagent:agent-platform-companion:lookup-result-signature:v1', [
        ['contractVersion', body.contractVersion],
        ['protocolMode', body.protocolMode],
        ['transcriptVersion', AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION],
        ['bodyDigestAlgorithm', AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM],
        ['bodyDigest', bodyDigest],
        ['signatureAlgorithm', AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM],
        ['signatureEncoding', AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING],
        ['deviceKeyId', body.deviceKeyId],
      ])
    : undefined;
}

export function decodeSignedKemerBetExactFiveLookupResult(
  candidate: unknown,
): SignedKemerBetExactFiveLookupResult | undefined {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, deviceSignedEnvelopeKeys) ||
      !header(candidate)
    ) {
      return undefined;
    }
    const body = decodeKemerBetExactFiveLookupResultBody(ownDataValue(candidate, 'body'));
    const bodyDigest = digest(ownDataValue(candidate, 'bodyDigest'));
    const deviceKeyId = opaque(ownDataValue(candidate, 'deviceKeyId'));
    const encodedSignature = signature(ownDataValue(candidate, 'signature'));
    if (
      ownDataValue(candidate, 'transcriptVersion') !==
        AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION ||
      ownDataValue(candidate, 'bodyDigestAlgorithm') !==
        AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM ||
      !bodyDigest ||
      ownDataValue(candidate, 'signatureAlgorithm') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM ||
      ownDataValue(candidate, 'signatureEncoding') !==
        AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING ||
      !deviceKeyId ||
      !body ||
      deviceKeyId !== body.deviceKeyId ||
      !encodedSignature
    ) {
      return undefined;
    }
    return Object.freeze({
      contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
      protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
      transcriptVersion: AGENT_PLATFORM_COMPANION_RESULT_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
      bodyDigest,
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
      signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
      deviceKeyId,
      body,
      signature: encodedSignature,
    });
  } catch {
    return undefined;
  }
}

export function verifySignedKemerBetExactFiveLookupResult(
  candidate: unknown,
  certificateCandidate: unknown,
): boolean {
  const envelope = decodeSignedKemerBetExactFiveLookupResult(candidate);
  const certificate = decodeSignedCompanionEnrollmentCertificate(certificateCandidate);
  if (!envelope || !certificate || certificate.body.state !== 'active') return false;
  const computedDigest = digestKemerBetExactFiveLookupResultBody(envelope.body);
  const key = parseP256Spki(certificate.body.devicePublicKeySpki)?.key;
  return (
    certificate.body.certificateId === envelope.body.certificateId &&
    certificate.body.deviceId === envelope.body.deviceId &&
    certificate.body.deviceKeyId === envelope.body.deviceKeyId &&
    computedDigest === envelope.bodyDigest &&
    verifyP1363(
      canonicalKemerBetExactFiveLookupResultSignatureBytes(envelope.body),
      envelope.signature,
      key,
    )
  );
}

export function deriveKemerBetExactFiveLookupResultReplayIdentity(
  candidate: unknown,
): string | undefined {
  const envelope = decodeSignedKemerBetExactFiveLookupResult(candidate);
  const computedDigest = envelope && digestKemerBetExactFiveLookupResultBody(envelope.body);
  return envelope && computedDigest === envelope.bodyDigest
    ? sha256(
        encodeFields('fetanagent:agent-platform-companion:lookup-result-replay-identity:v1', [
          ['resultId', envelope.body.resultId],
          ['assignmentId', envelope.body.assignmentId],
          ['assignmentBodyDigest', envelope.body.assignmentBodyDigest],
          ['certificateId', envelope.body.certificateId],
          ['deviceId', envelope.body.deviceId],
          ['deviceKeyId', envelope.body.deviceKeyId],
          ['bodyDigest', envelope.bodyDigest],
        ]),
      )
    : undefined;
}

export type CompanionLookupExchangeVerificationReason =
  | 'invalid_request'
  | 'certificate_inactive'
  | 'certificate_signature_invalid'
  | 'certificate_expired'
  | 'assignment_signature_invalid'
  | 'assignment_expired'
  | 'result_signature_invalid'
  | 'binding_mismatch'
  | 'player_digest_mismatch'
  | 'observation_time_invalid'
  | 'replay_detected'
  | 'signed_read_only_result_verified';

export interface CompanionLookupExchangeVerificationResult extends CompanionNoMoneySafety {
  readonly contractVersion: typeof AGENT_PLATFORM_COMPANION_CONTRACT_VERSION;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_request' | 'would_review' | 'would_accept_read_only_result';
  readonly reasonCode: CompanionLookupExchangeVerificationReason;
  readonly replayIdentity: string | null;
}

function exchangeResult(
  disposition: CompanionLookupExchangeVerificationResult['disposition'],
  reasonCode: CompanionLookupExchangeVerificationReason,
  replayIdentity: string | null = null,
): CompanionLookupExchangeVerificationResult {
  return Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    advisoryOnly: true,
    ...safety,
    disposition,
    reasonCode,
    replayIdentity,
  });
}

/**
 * Verifies the first companion slice end to end. It accepts a redacted,
 * read-only aggregate result only; it supplies no database, provider, claim,
 * settlement, final-action, transfer, or money-movement authority.
 */
export function verifyKemerBetExactFiveLookupExchange(
  inputCandidate: {
    readonly assessedAt: unknown;
    readonly certificate: unknown;
    readonly signedAssignment: unknown;
    readonly signedResult: unknown;
    readonly consumedReplayIdentities?: readonly string[];
  },
  trustedServerPublicKeySpkiDer: unknown,
): CompanionLookupExchangeVerificationResult {
  try {
    const assessedAt = timestamp(inputCandidate.assessedAt);
    const certificate = decodeSignedCompanionEnrollmentCertificate(inputCandidate.certificate);
    const assignment = decodeSignedKemerBetExactFiveLookupAssignment(
      inputCandidate.signedAssignment,
    );
    const result = decodeSignedKemerBetExactFiveLookupResult(inputCandidate.signedResult);
    if (!assessedAt || !certificate || !assignment || !result) {
      return exchangeResult('invalid_request', 'invalid_request');
    }
    if (certificate.body.state !== 'active') {
      return exchangeResult('would_review', 'certificate_inactive');
    }
    if (!verifySignedCompanionEnrollmentCertificate(certificate, trustedServerPublicKeySpkiDer)) {
      return exchangeResult('would_review', 'certificate_signature_invalid');
    }
    const assessedAtMs = Date.parse(assessedAt);
    if (
      assessedAtMs < Date.parse(certificate.body.validFrom) ||
      assessedAtMs >= Date.parse(certificate.body.validUntil)
    ) {
      return exchangeResult('would_review', 'certificate_expired');
    }
    if (!verifySignedKemerBetExactFiveLookupAssignment(assignment, trustedServerPublicKeySpkiDer)) {
      return exchangeResult('would_review', 'assignment_signature_invalid');
    }
    if (
      assessedAtMs < Date.parse(assignment.body.issuedAt) ||
      assessedAtMs >= Date.parse(assignment.body.expiresAt)
    ) {
      return exchangeResult('would_review', 'assignment_expired');
    }
    if (!verifySignedKemerBetExactFiveLookupResult(result, certificate)) {
      return exchangeResult('would_review', 'result_signature_invalid');
    }
    if (
      certificate.body.certificateId !== assignment.body.certificateId ||
      certificate.body.deviceId !== assignment.body.deviceId ||
      certificate.body.deviceKeyId !== assignment.body.deviceKeyId ||
      result.body.assignmentId !== assignment.body.assignmentId ||
      result.body.assignmentBodyDigest !== assignment.bodyDigest ||
      result.body.requestId !== assignment.body.requestId ||
      result.body.certificateId !== assignment.body.certificateId ||
      result.body.deviceId !== assignment.body.deviceId ||
      result.body.deviceKeyId !== assignment.body.deviceKeyId ||
      result.body.platformCode !== assignment.body.platformCode ||
      result.body.assignmentKind !== assignment.body.assignmentKind ||
      result.body.lookupMode !== assignment.body.lookupMode ||
      result.body.currencyCode !== assignment.body.currencyCode
    ) {
      return exchangeResult('would_review', 'binding_mismatch');
    }
    if (
      result.body.items.some(
        (item, index) =>
          item.playerIdDigest !== digestCompanionPlayerId(assignment.body.playerIds[index]),
      )
    ) {
      return exchangeResult('would_review', 'player_digest_mismatch');
    }
    const observedAtMs = Date.parse(result.body.observedAt);
    if (
      observedAtMs < Date.parse(assignment.body.issuedAt) ||
      observedAtMs >= Date.parse(assignment.body.expiresAt) ||
      observedAtMs > assessedAtMs
    ) {
      return exchangeResult('would_review', 'observation_time_invalid');
    }
    const replayIdentity = deriveKemerBetExactFiveLookupAssignmentReplayIdentity(assignment);
    if (!replayIdentity) return exchangeResult('invalid_request', 'invalid_request');
    const consumed = inputCandidate.consumedReplayIdentities ?? [];
    if (consumed.includes(replayIdentity)) {
      return exchangeResult('would_review', 'replay_detected', replayIdentity);
    }
    return exchangeResult(
      'would_accept_read_only_result',
      'signed_read_only_result_verified',
      replayIdentity,
    );
  } catch {
    return exchangeResult('invalid_request', 'invalid_request');
  }
}
