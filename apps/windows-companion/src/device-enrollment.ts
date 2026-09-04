import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isProxy } from 'node:util/types';

import {
  AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
  AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
  AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
  AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION,
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PAIRING_PACKAGE_PREFIX,
  AGENT_PLATFORM_COMPANION_PAIRING_PATH,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
  AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
  canonicalCompanionPairingSignatureBytes,
  certificateMatchesPairingRequest,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedCompanionPairingRequest,
  digestCompanionPairingPublicPayload,
  verifySignedCompanionEnrollmentCertificate,
  verifySignedCompanionPairingRequest,
  type CompanionNoMoneySafety,
  type CompanionPairingPublicPayload,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionPairingRequest,
} from '@fetanagent/agent-platform-companion-contracts';

import {
  createWindowsCurrentUserDataProtector,
  type WindowsCurrentUserDataProtector,
} from './windows-data-protection.js';

export const WINDOWS_COMPANION_VERSION = '0.1.4' as const;
export const COMPANION_PAIRING_PACKAGE_PREFIX = AGENT_PLATFORM_COMPANION_PAIRING_PACKAGE_PREFIX;
export const COMPANION_PAIRING_CONTENT_TYPE = AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE;
export const COMPANION_PAIRING_PATH = AGENT_PLATFORM_COMPANION_PAIRING_PATH;

const DEVICE_KEY_FILE = 'companion-primary.key.json';
const DEVICE_ENROLLMENT_FILE = 'companion-primary.enrollment.json';
const MAXIMUM_STORED_FILE_BYTES = 64 * 1_024;
const MAXIMUM_RESPONSE_BYTES = 64 * 1_024;
const MAXIMUM_PAIRING_LIFETIME_MS = 10 * 60 * 1_000;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const noMoneySafety: CompanionNoMoneySafety = Object.freeze({
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

const safetyKeys = Object.freeze(Object.keys(noMoneySafety).sort());

export type CompanionDeviceEnrollmentFailureCode =
  'FETANAGENT_DEVICE_ENROLLMENT_REJECTED' | 'FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE';

export class CompanionDeviceEnrollmentError extends Error {
  readonly code: CompanionDeviceEnrollmentFailureCode;

  constructor(code: CompanionDeviceEnrollmentFailureCode) {
    super('The FetanAgent companion device enrollment could not be completed.');
    this.name = 'CompanionDeviceEnrollmentError';
    this.code = code;
  }
}

interface CompanionPairingPackage extends CompanionNoMoneySafety {
  readonly schemaVersion: 1;
  readonly protocolMode: typeof AGENT_PLATFORM_COMPANION_PROTOCOL_MODE;
  readonly pairingId: string;
  readonly pairingNonceDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly endpoint: string;
  readonly signerKeyId: string;
  readonly serverSigningPublicKeySpki: string;
  readonly serverSigningPublicKeySpkiSha256: string;
  readonly minimumCompanionVersion: string;
  readonly oneUse: true;
}

interface StoredDeviceKey {
  readonly keyVersion: 1;
  readonly createdAt: string;
  readonly firstCreatedReleaseSha: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly devicePublicKeySpki: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly keyProtection: 'windows-dpapi-current-user';
  readonly protectedPrivateKeyBase64: string;
  readonly signatureAlgorithm: typeof AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM;
}

interface StoredDeviceEnrollment {
  readonly enrollmentVersion: 1;
  readonly endpoint: string;
  readonly serverSignerKeyId: string;
  readonly serverSigningPublicKeySpki: string;
  readonly serverSigningPublicKeySpkiSha256: string;
  readonly certificate: SignedCompanionEnrollmentCertificate;
}

export interface EnsureCompanionDeviceEnrollmentOptions {
  readonly dataRoot: string;
  readonly pairingPackage?: string;
  readonly releaseSha: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly protector?: WindowsCurrentUserDataProtector;
}

export interface CompanionDeviceEnrollmentResult {
  readonly alreadyPaired: boolean;
  readonly devicePaired: boolean;
  readonly identifiersRedacted: true;
  readonly pairingRequired: boolean;
  readonly transferDisabled: true;
}

function fail(code: CompanionDeviceEnrollmentFailureCode): never {
  throw new CompanionDeviceEnrollmentError(code);
}

function plainRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    !isProxy(candidate) &&
    Object.getPrototypeOf(candidate) === Object.prototype
  );
}

function exactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(candidate).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]) &&
    actual.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      return Boolean(descriptor?.enumerable && 'value' in (descriptor ?? {}));
    })
  );
}

function exactSafety(candidate: Record<string, unknown>): boolean {
  return safetyKeys.every(
    (key) => candidate[key] === noMoneySafety[key as keyof CompanionNoMoneySafety],
  );
}

function timestamp(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  try {
    return new Date(candidate).toISOString() === candidate ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalBase64(
  value: unknown,
  encoding: 'base64' | 'base64url',
  maximum: number,
): Buffer {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum * 2 ||
    (encoding === 'base64'
      ? !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
      : !/^[A-Za-z0-9_-]+$/u.test(value))
  ) {
    fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
  const bytes = Buffer.from(value, encoding);
  if (bytes.length < 1 || bytes.length > maximum || bytes.toString(encoding) !== value) {
    bytes.fill(0);
    fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
  return bytes;
}

function p256PublicKey(encoded: unknown): { readonly bytes: Buffer; readonly digest: string } {
  const bytes = canonicalBase64(encoded, 'base64url', 512);
  try {
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    const canonical = Buffer.from(key.export({ format: 'der', type: 'spki' }));
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !canonical.equals(bytes)
    ) {
      canonical.fill(0);
      fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
    }
    canonical.fill(0);
    return Object.freeze({ bytes, digest: sha256(bytes) });
  } catch (error) {
    bytes.fill(0);
    if (error instanceof CompanionDeviceEnrollmentError) throw error;
    return fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
}

function validEndpoint(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate.length > 256) return false;
  try {
    const endpoint = new URL(candidate);
    return (
      endpoint.protocol === 'https:' &&
      endpoint.hostname === 'device.fetanagent.com' &&
      endpoint.port === '' &&
      endpoint.pathname === COMPANION_PAIRING_PATH &&
      endpoint.search === '' &&
      endpoint.hash === '' &&
      endpoint.username === '' &&
      endpoint.password === ''
    );
  } catch {
    return false;
  }
}

function semverAtLeast(actual: string, minimum: string): boolean {
  const pattern = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/u;
  const actualMatch = pattern.exec(actual);
  const minimumMatch = pattern.exec(minimum);
  if (!actualMatch || !minimumMatch) return false;
  for (let index = 1; index <= 3; index += 1) {
    const left = Number(actualMatch[index]);
    const right = Number(minimumMatch[index]);
    if (left !== right) return left > right;
  }
  return true;
}

export function decodeCompanionPairingPackage(
  encodedPackage: unknown,
  assessedAt: Date,
): CompanionPairingPackage | undefined {
  try {
    if (
      typeof encodedPackage !== 'string' ||
      !encodedPackage.startsWith(COMPANION_PAIRING_PACKAGE_PREFIX) ||
      encodedPackage.length > 8_192
    ) {
      return undefined;
    }
    const encoded = encodedPackage.slice(COMPANION_PAIRING_PACKAGE_PREFIX.length);
    const bytes = canonicalBase64(encoded, 'base64url', 6_000);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } finally {
      bytes.fill(0);
    }
    const expectedKeys = [
      'schemaVersion',
      'protocolMode',
      'pairingId',
      'pairingNonceDigest',
      'issuedAt',
      'expiresAt',
      'endpoint',
      'signerKeyId',
      'serverSigningPublicKeySpki',
      'serverSigningPublicKeySpkiSha256',
      'minimumCompanionVersion',
      'oneUse',
      ...safetyKeys,
    ];
    if (!plainRecord(parsed) || !exactKeys(parsed, expectedKeys) || !exactSafety(parsed)) {
      return undefined;
    }
    const issuedAt = timestamp(parsed.issuedAt);
    const expiresAt = timestamp(parsed.expiresAt);
    const serverKey = p256PublicKey(parsed.serverSigningPublicKeySpki);
    const assessedMilliseconds = assessedAt.getTime();
    if (
      parsed.schemaVersion !== 1 ||
      parsed.protocolMode !== AGENT_PLATFORM_COMPANION_PROTOCOL_MODE ||
      typeof parsed.pairingId !== 'string' ||
      !OPAQUE_ID_PATTERN.test(parsed.pairingId) ||
      typeof parsed.pairingNonceDigest !== 'string' ||
      !DIGEST_PATTERN.test(parsed.pairingNonceDigest) ||
      !issuedAt ||
      !expiresAt ||
      Date.parse(expiresAt) <= Date.parse(issuedAt) ||
      Date.parse(expiresAt) - Date.parse(issuedAt) > MAXIMUM_PAIRING_LIFETIME_MS ||
      !Number.isFinite(assessedMilliseconds) ||
      assessedMilliseconds < Date.parse(issuedAt) ||
      assessedMilliseconds >= Date.parse(expiresAt) ||
      !validEndpoint(parsed.endpoint) ||
      typeof parsed.signerKeyId !== 'string' ||
      !OPAQUE_ID_PATTERN.test(parsed.signerKeyId) ||
      typeof parsed.serverSigningPublicKeySpkiSha256 !== 'string' ||
      parsed.serverSigningPublicKeySpkiSha256 !== serverKey.digest ||
      typeof parsed.minimumCompanionVersion !== 'string' ||
      !semverAtLeast(WINDOWS_COMPANION_VERSION, parsed.minimumCompanionVersion) ||
      parsed.oneUse !== true
    ) {
      serverKey.bytes.fill(0);
      return undefined;
    }
    serverKey.bytes.fill(0);
    return Object.freeze(parsed as unknown as CompanionPairingPackage);
  } catch {
    return undefined;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
}

async function readStored(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAXIMUM_STORED_FILE_BYTES
    ) {
      fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
    }
    return await readFile(path, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    if (error instanceof CompanionDeviceEnrollmentError) throw error;
    return fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
}

async function writeExclusive(path: string, value: unknown): Promise<void> {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } catch {
    fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function decodeStoredDeviceKey(candidate: unknown): StoredDeviceKey | undefined {
  if (
    !plainRecord(candidate) ||
    !exactKeys(candidate, [
      'keyVersion',
      'createdAt',
      'firstCreatedReleaseSha',
      'deviceId',
      'deviceKeyId',
      'devicePublicKeySpki',
      'devicePublicKeySpkiSha256',
      'keyProtection',
      'protectedPrivateKeyBase64',
      'signatureAlgorithm',
    ]) ||
    candidate.keyVersion !== 1 ||
    !timestamp(candidate.createdAt) ||
    typeof candidate.firstCreatedReleaseSha !== 'string' ||
    !/^(?:[0-9a-f]{40}|local-development)$/u.test(candidate.firstCreatedReleaseSha) ||
    typeof candidate.deviceId !== 'string' ||
    !OPAQUE_ID_PATTERN.test(candidate.deviceId) ||
    typeof candidate.deviceKeyId !== 'string' ||
    !OPAQUE_ID_PATTERN.test(candidate.deviceKeyId) ||
    typeof candidate.devicePublicKeySpkiSha256 !== 'string' ||
    !DIGEST_PATTERN.test(candidate.devicePublicKeySpkiSha256) ||
    candidate.keyProtection !== 'windows-dpapi-current-user' ||
    typeof candidate.protectedPrivateKeyBase64 !== 'string' ||
    candidate.signatureAlgorithm !== AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM
  ) {
    return undefined;
  }
  const publicKey = p256PublicKey(candidate.devicePublicKeySpki);
  const protectedKey = canonicalBase64(candidate.protectedPrivateKeyBase64, 'base64', 4_096);
  protectedKey.fill(0);
  if (publicKey.digest !== candidate.devicePublicKeySpkiSha256) {
    publicKey.bytes.fill(0);
    return undefined;
  }
  publicKey.bytes.fill(0);
  return Object.freeze(candidate as unknown as StoredDeviceKey);
}

async function openDevicePrivateKey(
  stored: StoredDeviceKey,
  protector: WindowsCurrentUserDataProtector,
): Promise<KeyObject> {
  const protectedBytes = canonicalBase64(stored.protectedPrivateKeyBase64, 'base64', 4_096);
  let clearBytes: Buffer | null = null;
  try {
    clearBytes = await protector.unprotect(protectedBytes);
    const privateKey = createPrivateKey({ key: clearBytes, format: 'der', type: 'pkcs8' });
    const canonicalPrivate = Buffer.from(privateKey.export({ format: 'der', type: 'pkcs8' }));
    const publicBytes = Buffer.from(
      createPublicKey(privateKey).export({ format: 'der', type: 'spki' }),
    );
    const valid =
      privateKey.asymmetricKeyType === 'ec' &&
      privateKey.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
      canonicalPrivate.equals(clearBytes) &&
      publicBytes.toString('base64url') === stored.devicePublicKeySpki &&
      sha256(publicBytes) === stored.devicePublicKeySpkiSha256;
    canonicalPrivate.fill(0);
    publicBytes.fill(0);
    if (!valid) fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
    return privateKey;
  } catch (error) {
    if (error instanceof CompanionDeviceEnrollmentError) throw error;
    return fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  } finally {
    protectedBytes.fill(0);
    clearBytes?.fill(0);
  }
}

async function loadOrCreateDeviceKey(
  path: string,
  releaseSha: string,
  now: Date,
  protector: WindowsCurrentUserDataProtector,
): Promise<StoredDeviceKey> {
  const existing = await readStored(path);
  if (existing !== undefined) {
    const stored = decodeStoredDeviceKey(parseJson(existing));
    if (!stored) fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
    const privateKey = await openDevicePrivateKey(stored, protector);
    // The KeyObject holds no serializable reference after this validation scope.
    void privateKey;
    return stored;
  }

  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateBytes = Buffer.from(pair.privateKey.export({ format: 'der', type: 'pkcs8' }));
  const publicBytes = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
  let protectedBytes: Buffer | null = null;
  try {
    protectedBytes = await protector.protect(privateBytes);
    const stored: StoredDeviceKey = Object.freeze({
      keyVersion: 1,
      createdAt: now.toISOString(),
      firstCreatedReleaseSha: releaseSha,
      deviceId: randomUUID(),
      deviceKeyId: randomUUID(),
      devicePublicKeySpki: publicBytes.toString('base64url'),
      devicePublicKeySpkiSha256: sha256(publicBytes),
      keyProtection: 'windows-dpapi-current-user',
      protectedPrivateKeyBase64: protectedBytes.toString('base64'),
      signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    });
    await writeExclusive(path, stored);
    return stored;
  } finally {
    privateBytes.fill(0);
    publicBytes.fill(0);
    protectedBytes?.fill(0);
  }
}

function signedPairingRequest(
  pairingPackage: CompanionPairingPackage,
  storedKey: StoredDeviceKey,
  privateKey: KeyObject,
): SignedCompanionPairingRequest {
  const body: CompanionPairingPublicPayload = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    pairingId: pairingPackage.pairingId,
    pairingNonceDigest: pairingPackage.pairingNonceDigest,
    deviceId: storedKey.deviceId,
    deviceKeyId: storedKey.deviceKeyId,
    devicePublicKeySpki: storedKey.devicePublicKeySpki,
    devicePublicKeySpkiSha256: storedKey.devicePublicKeySpkiSha256,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    devicePlatform: AGENT_PLATFORM_COMPANION_DEVICE_PLATFORM,
    companionVersion: WINDOWS_COMPANION_VERSION,
    issuedAt: pairingPackage.issuedAt,
    expiresAt: pairingPackage.expiresAt,
    oneUse: true,
    ...noMoneySafety,
  });
  const bodyDigest = digestCompanionPairingPublicPayload(body);
  const transcript = canonicalCompanionPairingSignatureBytes(body);
  if (!bodyDigest || !transcript) fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  const request: SignedCompanionPairingRequest = Object.freeze({
    contractVersion: AGENT_PLATFORM_COMPANION_CONTRACT_VERSION,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    transcriptVersion: AGENT_PLATFORM_COMPANION_PAIRING_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: AGENT_PLATFORM_COMPANION_DIGEST_ALGORITHM,
    bodyDigest,
    signatureAlgorithm: AGENT_PLATFORM_COMPANION_SIGNATURE_ALGORITHM,
    signatureEncoding: AGENT_PLATFORM_COMPANION_SIGNATURE_ENCODING,
    deviceKeyId: storedKey.deviceKeyId,
    body,
    signature: sign('sha256', transcript, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  });
  if (
    !decodeSignedCompanionPairingRequest(request) ||
    !verifySignedCompanionPairingRequest(request)
  ) {
    fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
  return request;
}

async function responseBytes(response: Response): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^[1-9][0-9]{0,5}$/u.test(declared) || Number(declared) > MAXIMUM_RESPONSE_BYTES)
  ) {
    fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
  }
  if (!response.body) fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
      }
      chunks.push(Buffer.from(part.value));
    }
    if (total < 1 || (declared !== null && total !== Number(declared))) {
      fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
    }
    return Buffer.concat(chunks, total);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    reader.releaseLock();
  }
}

async function requestCertificate(
  pairingPackage: CompanionPairingPackage,
  request: SignedCompanionPairingRequest,
  fetchImplementation: typeof fetch,
  assessedAt: Date,
): Promise<SignedCompanionEnrollmentCertificate> {
  let response: Response;
  try {
    response = await fetchImplementation(pairingPackage.endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        accept: COMPANION_PAIRING_CONTENT_TYPE,
        'content-type': COMPANION_PAIRING_CONTENT_TYPE,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
  if (
    (response.status !== 200 && response.status !== 201) ||
    response.headers.get('content-type') !== COMPANION_PAIRING_CONTENT_TYPE
  ) {
    return fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
  }
  const bytes = await responseBytes(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
  } finally {
    bytes.fill(0);
  }
  if (!plainRecord(parsed) || !exactKeys(parsed, ['certificate'])) {
    return fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
  }
  const certificate = decodeSignedCompanionEnrollmentCertificate(parsed.certificate);
  const serverKey = p256PublicKey(pairingPackage.serverSigningPublicKeySpki);
  try {
    if (
      !certificate ||
      certificate.signerKeyId !== pairingPackage.signerKeyId ||
      certificate.transcriptVersion !== AGENT_PLATFORM_COMPANION_CERTIFICATE_TRANSCRIPT_VERSION ||
      certificate.body.state !== 'active' ||
      Date.parse(certificate.body.validFrom) > assessedAt.getTime() ||
      Date.parse(certificate.body.validUntil) <= assessedAt.getTime() ||
      !verifySignedCompanionEnrollmentCertificate(certificate, serverKey.bytes) ||
      !certificateMatchesPairingRequest(certificate, request)
    ) {
      return fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
    }
    return certificate;
  } finally {
    serverKey.bytes.fill(0);
  }
}

function decodeStoredEnrollment(candidate: unknown): StoredDeviceEnrollment | undefined {
  if (
    !plainRecord(candidate) ||
    !exactKeys(candidate, [
      'enrollmentVersion',
      'endpoint',
      'serverSignerKeyId',
      'serverSigningPublicKeySpki',
      'serverSigningPublicKeySpkiSha256',
      'certificate',
    ]) ||
    candidate.enrollmentVersion !== 1 ||
    !validEndpoint(candidate.endpoint) ||
    typeof candidate.serverSignerKeyId !== 'string' ||
    !OPAQUE_ID_PATTERN.test(candidate.serverSignerKeyId) ||
    typeof candidate.serverSigningPublicKeySpkiSha256 !== 'string' ||
    !DIGEST_PATTERN.test(candidate.serverSigningPublicKeySpkiSha256)
  ) {
    return undefined;
  }
  const certificate = decodeSignedCompanionEnrollmentCertificate(candidate.certificate);
  const serverKey = p256PublicKey(candidate.serverSigningPublicKeySpki);
  try {
    if (
      !certificate ||
      certificate.signerKeyId !== candidate.serverSignerKeyId ||
      serverKey.digest !== candidate.serverSigningPublicKeySpkiSha256 ||
      !verifySignedCompanionEnrollmentCertificate(certificate, serverKey.bytes)
    ) {
      return undefined;
    }
    return Object.freeze({
      enrollmentVersion: 1,
      endpoint: candidate.endpoint,
      serverSignerKeyId: candidate.serverSignerKeyId,
      serverSigningPublicKeySpki: candidate.serverSigningPublicKeySpki as string,
      serverSigningPublicKeySpkiSha256: candidate.serverSigningPublicKeySpkiSha256,
      certificate,
    });
  } finally {
    serverKey.bytes.fill(0);
  }
}

async function validateExistingEnrollment(
  key: StoredDeviceKey,
  rawEnrollment: string,
  assessedAt: Date,
): Promise<boolean> {
  const enrollment = decodeStoredEnrollment(parseJson(rawEnrollment));
  const body = enrollment?.certificate.body;
  return Boolean(
    enrollment &&
    body &&
    body.state === 'active' &&
    body.deviceId === key.deviceId &&
    body.deviceKeyId === key.deviceKeyId &&
    body.devicePublicKeySpki === key.devicePublicKeySpki &&
    body.devicePublicKeySpkiSha256 === key.devicePublicKeySpkiSha256 &&
    Date.parse(body.validFrom) <= assessedAt.getTime() &&
    Date.parse(body.validUntil) > assessedAt.getTime(),
  );
}

export async function ensureCompanionDeviceEnrollment(
  options: EnsureCompanionDeviceEnrollmentOptions,
): Promise<CompanionDeviceEnrollmentResult> {
  if (!/^(?:[0-9a-f]{40}|local-development)$/u.test(options.releaseSha)) {
    fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
  const now = options.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime()) || now.toISOString() !== timestamp(now.toISOString())) {
    fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
  const deviceRoot = resolve(options.dataRoot, 'device');
  await mkdir(deviceRoot, { recursive: true });
  if (
    (await realpath(deviceRoot)).toLocaleLowerCase('en-US') !==
    deviceRoot.toLocaleLowerCase('en-US')
  ) {
    fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
  const keyPath = resolve(deviceRoot, DEVICE_KEY_FILE);
  const enrollmentPath = resolve(deviceRoot, DEVICE_ENROLLMENT_FILE);
  const protector =
    options.protector ?? createWindowsCurrentUserDataProtector(process.env, 'device-signing-key');
  const rawKey = await readStored(keyPath);
  const key = rawKey === undefined ? undefined : decodeStoredDeviceKey(parseJson(rawKey));
  if (rawKey !== undefined && !key) fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  if (key) await openDevicePrivateKey(key, protector);
  const rawEnrollment = await readStored(enrollmentPath);
  if (rawEnrollment !== undefined) {
    if (!key || !(await validateExistingEnrollment(key, rawEnrollment, now))) {
      fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
    }
    return Object.freeze({
      alreadyPaired: true,
      devicePaired: true,
      identifiersRedacted: true,
      pairingRequired: false,
      transferDisabled: true,
    });
  }
  if (options.pairingPackage === undefined) {
    return Object.freeze({
      alreadyPaired: false,
      devicePaired: false,
      identifiersRedacted: true,
      pairingRequired: true,
      transferDisabled: true,
    });
  }
  const pairingPackage = decodeCompanionPairingPackage(options.pairingPackage, now);
  if (!pairingPackage) fail('FETANAGENT_DEVICE_ENROLLMENT_REJECTED');
  const storedKey =
    key ?? (await loadOrCreateDeviceKey(keyPath, options.releaseSha, now, protector));
  const privateKey = await openDevicePrivateKey(storedKey, protector);
  const request = signedPairingRequest(pairingPackage, storedKey, privateKey);
  const certificate = await requestCertificate(
    pairingPackage,
    request,
    options.fetch ?? fetch,
    now,
  );
  const storedEnrollment: StoredDeviceEnrollment = Object.freeze({
    enrollmentVersion: 1,
    endpoint: pairingPackage.endpoint,
    serverSignerKeyId: pairingPackage.signerKeyId,
    serverSigningPublicKeySpki: pairingPackage.serverSigningPublicKeySpki,
    serverSigningPublicKeySpkiSha256: pairingPackage.serverSigningPublicKeySpkiSha256,
    certificate,
  });
  await writeExclusive(enrollmentPath, storedEnrollment);
  if (!(await validateExistingEnrollment(storedKey, JSON.stringify(storedEnrollment), now))) {
    fail('FETANAGENT_DEVICE_ENROLLMENT_UNAVAILABLE');
  }
  return Object.freeze({
    alreadyPaired: false,
    devicePaired: true,
    identifiersRedacted: true,
    pairingRequired: false,
    transferDisabled: true,
  });
}
