import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { isProxy } from 'node:util/types';

/**
 * Offline receiver-revision protection candidate. This file is deliberately not exported from
 * the package entry point or imported by an application. A valid envelope does not prove that
 * its keys were independently provisioned or that the revision came from Owner-controlled SQL.
 */
export const CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION = 2 as const;
export const CBE_BIRR_RECEIVER_LOOKUP_ENCRYPTION_KEY_VERSION = 2 as const;
export const CBE_BIRR_RECEIVER_LOOKUP_FINGERPRINT_KEY_VERSION = 2 as const;
export const CBE_BIRR_RECEIVER_LOOKUP_OPENING_CONTRACT_VERSION = 1 as const;
export const CBE_BIRR_RECEIVER_LOOKUP_OPENING_PURPOSE = 'receiver-lookup-opening' as const;

const PHONE_PATTERN = /^251[0-9]{9}$/u;
const REVISION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SECRET_PATTERN = /^[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CIPHERTEXT_PATTERN =
  /^cbe-receiver-v2\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16})$/u;
const MAX_REVISION_VERSION = 2_147_483_647;

export interface ProtectCbeBirrReceiverLookupInput {
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly receiverPhone: string;
  readonly secrets: Readonly<{
    encryptionSecret: string;
    fingerprintSecret: string;
  }>;
}

export interface ProtectedCbeBirrReceiverLookup {
  readonly ciphertext: string;
  readonly fingerprint: string;
  readonly masked: string;
  readonly protectionProfileVersion: typeof CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION;
  readonly encryptionKeyVersion: typeof CBE_BIRR_RECEIVER_LOOKUP_ENCRYPTION_KEY_VERSION;
  readonly fingerprintKeyVersion: typeof CBE_BIRR_RECEIVER_LOOKUP_FINGERPRINT_KEY_VERSION;
}

export interface OpenCbeBirrReceiverLookupInput {
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly ciphertext: string;
  readonly masked: string;
  readonly protectionProfileVersion: typeof CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION;
  readonly encryptionKeyVersion: typeof CBE_BIRR_RECEIVER_LOOKUP_ENCRYPTION_KEY_VERSION;
}

/** Produced by a trusted offline provisioner, never by the future verifier. */
export interface DeriveCbeBirrReceiverLookupChildKeyInput {
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly encryptionSecret: string;
}

export interface CbeBirrReceiverLookupChildKey {
  readonly contractVersion: typeof CBE_BIRR_RECEIVER_LOOKUP_OPENING_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly purpose: typeof CBE_BIRR_RECEIVER_LOOKUP_OPENING_PURPOSE;
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly keyId: string;
  readonly keyHex: string;
}

/** Nonsecret manifest; its provenance and immutability are deployment responsibilities. */
export interface CbeBirrReceiverLookupOpeningProfile {
  readonly version: typeof CBE_BIRR_RECEIVER_LOOKUP_OPENING_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly purpose: typeof CBE_BIRR_RECEIVER_LOOKUP_OPENING_PURPOSE;
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly keyId: string;
  readonly rootEncryptionMasterFingerprint: string;
  readonly rootFingerprintMasterFingerprint: string;
}

/** Independently approved, nonsecret identity of the Owner's two lookup masters. */
export interface CbeBirrApprovedReceiverLookupRootProfile {
  readonly encryptionMasterFingerprint: string;
  readonly fingerprintMasterFingerprint: string;
  readonly purpose: 'cbe_birr_receiver_lookup';
  readonly version: typeof CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION;
}

export class CbeBirrReceiverLookupProtectionError extends Error {
  constructor() {
    super('CBE Birr receiver lookup material is unavailable.');
    this.name = 'CbeBirrReceiverLookupProtectionError';
  }
}

function exactDataProperties(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return undefined;
  if (Object.getPrototypeOf(candidate) !== Object.prototype) return undefined;
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return undefined;
    }
    values[key] = descriptor.value;
  }
  return values;
}

function validRevisionId(value: unknown): value is string {
  return typeof value === 'string' && REVISION_ID_PATTERN.test(value);
}

function validRevisionVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_REVISION_VERSION
  );
}

function validSecret(value: unknown): value is string {
  return typeof value === 'string' && SECRET_PATTERN.test(value);
}

function aad(revisionId: string, version: number): Buffer {
  return Buffer.from(
    `fetanagent:cbe-birr:receiver-lookup:v2\nrevision:${revisionId}\nversion:${version}`,
    'utf8',
  );
}

function deriveKey(
  master: Buffer,
  purpose: 'encryption' | 'fingerprint',
  revisionId: string,
  version: number,
): Buffer {
  return createHmac('sha256', master)
    .update(
      `fetanagent:cbe-birr:receiver-lookup:${purpose}-key:v2\nrevision:${revisionId}\nversion:${version}`,
      'utf8',
    )
    .digest();
}

function exactNonce(candidate: unknown): Buffer {
  const dependencies = exactDataProperties(candidate, ['nonce']);
  if (!dependencies || typeof dependencies.nonce !== 'function') throw new Error();
  const value = (dependencies.nonce as () => unknown)();
  if (!Buffer.isBuffer(value) || value.byteLength !== 12) throw new Error();
  return Buffer.from(value);
}

function isThenable(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  if (isProxy(value)) return true;
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'then');
    if (descriptor?.get !== undefined || descriptor?.set !== undefined) return true;
    if (typeof descriptor?.value === 'function') return true;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

/**
 * Produces a new v2 envelope for an already assigned immutable receiver revision. The encryption
 * and fingerprint masters must come from separately provisioned secrets; this pure function
 * cannot attest their provenance. Neither a v1 ciphertext nor a nine-digit PH is accepted.
 */
export function protectCbeBirrReceiverLookup(
  input: ProtectCbeBirrReceiverLookupInput,
  dependencies?: Readonly<{ nonce: () => Buffer }>,
): ProtectedCbeBirrReceiverLookup {
  let encryptionMaster: Buffer | undefined;
  let fingerprintMaster: Buffer | undefined;
  let encryptionKey: Buffer | undefined;
  let fingerprintKey: Buffer | undefined;
  let nonce: Buffer | undefined;
  let plaintext: Buffer | undefined;
  let encrypted: Buffer | undefined;
  let tag: Buffer | undefined;
  try {
    const values = exactDataProperties(input, [
      'receiverRevisionId',
      'receiverVersion',
      'receiverPhone',
      'secrets',
    ]);
    const secrets = exactDataProperties(values?.secrets, ['encryptionSecret', 'fingerprintSecret']);
    if (
      !values ||
      !validRevisionId(values.receiverRevisionId) ||
      !validRevisionVersion(values.receiverVersion) ||
      typeof values.receiverPhone !== 'string' ||
      !PHONE_PATTERN.test(values.receiverPhone) ||
      !secrets ||
      !validSecret(secrets.encryptionSecret) ||
      !validSecret(secrets.fingerprintSecret) ||
      secrets.encryptionSecret === secrets.fingerprintSecret
    ) {
      throw new Error();
    }

    encryptionMaster = Buffer.from(secrets.encryptionSecret, 'hex');
    fingerprintMaster = Buffer.from(secrets.fingerprintSecret, 'hex');
    encryptionKey = deriveKey(
      encryptionMaster,
      'encryption',
      values.receiverRevisionId,
      values.receiverVersion,
    );
    fingerprintKey = deriveKey(
      fingerprintMaster,
      'fingerprint',
      values.receiverRevisionId,
      values.receiverVersion,
    );
    nonce = dependencies === undefined ? randomBytes(12) : exactNonce(dependencies);
    plaintext = Buffer.from(values.receiverPhone, 'utf8');

    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce, { authTagLength: 16 });
    cipher.setAAD(aad(values.receiverRevisionId, values.receiverVersion));
    encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    tag = cipher.getAuthTag();
    const fingerprint = createHmac('sha256', fingerprintKey)
      .update(aad(values.receiverRevisionId, values.receiverVersion))
      .update('\nphone:', 'utf8')
      .update(plaintext)
      .digest('hex');

    return Object.freeze({
      ciphertext: `cbe-receiver-v2.${nonce.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`,
      fingerprint,
      masked: `***${values.receiverPhone.slice(-4)}`,
      protectionProfileVersion: CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION,
      encryptionKeyVersion: CBE_BIRR_RECEIVER_LOOKUP_ENCRYPTION_KEY_VERSION,
      fingerprintKeyVersion: CBE_BIRR_RECEIVER_LOOKUP_FINGERPRINT_KEY_VERSION,
    });
  } catch {
    throw new CbeBirrReceiverLookupProtectionError();
  } finally {
    encryptionMaster?.fill(0);
    fingerprintMaster?.fill(0);
    encryptionKey?.fill(0);
    fingerprintKey?.fill(0);
    nonce?.fill(0);
    plaintext?.fill(0);
    encrypted?.fill(0);
    tag?.fill(0);
  }
}

/** Derive one revision's decryption key in a trusted offline provisioning process. */
export function deriveCbeBirrReceiverLookupChildKey(
  input: DeriveCbeBirrReceiverLookupChildKeyInput,
): CbeBirrReceiverLookupChildKey {
  let encryptionMaster: Buffer | undefined;
  let childKey: Buffer | undefined;
  try {
    const values = exactDataProperties(input, [
      'receiverRevisionId',
      'receiverVersion',
      'encryptionSecret',
    ]);
    if (
      !values ||
      !validRevisionId(values.receiverRevisionId) ||
      !validRevisionVersion(values.receiverVersion) ||
      !validSecret(values.encryptionSecret)
    ) {
      throw new Error();
    }
    encryptionMaster = Buffer.from(values.encryptionSecret, 'hex');
    childKey = deriveKey(
      encryptionMaster,
      'encryption',
      values.receiverRevisionId,
      values.receiverVersion,
    );
    return Object.freeze({
      contractVersion: CBE_BIRR_RECEIVER_LOOKUP_OPENING_CONTRACT_VERSION,
      providerCode: 'cbe_birr',
      purpose: CBE_BIRR_RECEIVER_LOOKUP_OPENING_PURPOSE,
      receiverRevisionId: values.receiverRevisionId,
      receiverVersion: values.receiverVersion,
      keyId: `sha256:${createHash('sha256').update(childKey).digest('hex')}`,
      keyHex: childKey.toString('hex'),
    });
  } catch {
    throw new CbeBirrReceiverLookupProtectionError();
  } finally {
    encryptionMaster?.fill(0);
    childKey?.fill(0);
  }
}

/**
 * Internal, unwired opening candidate. A future verifier receives only one revision's child key,
 * never the Owner master. The trusted callback must use the phone synchronously and not retain it;
 * JavaScript strings cannot be erased. Row authorization, manifest provenance, key custody, and
 * provider-request approval remain separate gates.
 */
export function withOpenedCbeBirrReceiverLookup<Result>(
  input: OpenCbeBirrReceiverLookupInput,
  keyCandidate: CbeBirrReceiverLookupChildKey,
  profileCandidate: CbeBirrReceiverLookupOpeningProfile,
  approvedRootCandidate: CbeBirrApprovedReceiverLookupRootProfile,
  useReceiverPhone: (receiverPhone: string) => Result,
): Result {
  let childKey: Buffer | undefined;
  let keyFingerprint: Buffer | undefined;
  let expectedFingerprint: Buffer | undefined;
  let nonce: Buffer | undefined;
  let tag: Buffer | undefined;
  let encrypted: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    const values = exactDataProperties(input, [
      'receiverRevisionId',
      'receiverVersion',
      'ciphertext',
      'masked',
      'protectionProfileVersion',
      'encryptionKeyVersion',
    ]);
    const scopedKey = exactDataProperties(keyCandidate, [
      'contractVersion',
      'providerCode',
      'purpose',
      'receiverRevisionId',
      'receiverVersion',
      'keyId',
      'keyHex',
    ]);
    const profile = exactDataProperties(profileCandidate, [
      'version',
      'providerCode',
      'purpose',
      'receiverRevisionId',
      'receiverVersion',
      'keyId',
      'rootEncryptionMasterFingerprint',
      'rootFingerprintMasterFingerprint',
    ]);
    const approvedRoot = exactDataProperties(approvedRootCandidate, [
      'encryptionMasterFingerprint',
      'fingerprintMasterFingerprint',
      'purpose',
      'version',
    ]);
    if (
      !values ||
      !scopedKey ||
      !profile ||
      !approvedRoot ||
      !validRevisionId(values.receiverRevisionId) ||
      !validRevisionVersion(values.receiverVersion) ||
      values.protectionProfileVersion !== CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION ||
      values.encryptionKeyVersion !== CBE_BIRR_RECEIVER_LOOKUP_ENCRYPTION_KEY_VERSION ||
      typeof values.ciphertext !== 'string' ||
      typeof values.masked !== 'string' ||
      !/^\*{3}[0-9]{4}$/u.test(values.masked) ||
      scopedKey.contractVersion !== CBE_BIRR_RECEIVER_LOOKUP_OPENING_CONTRACT_VERSION ||
      scopedKey.providerCode !== 'cbe_birr' ||
      scopedKey.purpose !== CBE_BIRR_RECEIVER_LOOKUP_OPENING_PURPOSE ||
      scopedKey.receiverRevisionId !== values.receiverRevisionId ||
      scopedKey.receiverVersion !== values.receiverVersion ||
      !validSecret(scopedKey.keyHex) ||
      typeof scopedKey.keyId !== 'string' ||
      !KEY_ID_PATTERN.test(scopedKey.keyId) ||
      profile.version !== CBE_BIRR_RECEIVER_LOOKUP_OPENING_CONTRACT_VERSION ||
      profile.providerCode !== 'cbe_birr' ||
      profile.purpose !== CBE_BIRR_RECEIVER_LOOKUP_OPENING_PURPOSE ||
      profile.receiverRevisionId !== values.receiverRevisionId ||
      profile.receiverVersion !== values.receiverVersion ||
      profile.keyId !== scopedKey.keyId ||
      typeof profile.rootEncryptionMasterFingerprint !== 'string' ||
      !KEY_ID_PATTERN.test(profile.rootEncryptionMasterFingerprint) ||
      typeof profile.rootFingerprintMasterFingerprint !== 'string' ||
      !KEY_ID_PATTERN.test(profile.rootFingerprintMasterFingerprint) ||
      profile.rootEncryptionMasterFingerprint === profile.rootFingerprintMasterFingerprint ||
      approvedRoot.version !== CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION ||
      approvedRoot.purpose !== 'cbe_birr_receiver_lookup' ||
      approvedRoot.encryptionMasterFingerprint !== profile.rootEncryptionMasterFingerprint ||
      approvedRoot.fingerprintMasterFingerprint !== profile.rootFingerprintMasterFingerprint ||
      typeof useReceiverPhone !== 'function' ||
      isProxy(useReceiverPhone)
    ) {
      throw new Error();
    }
    const envelope = CIPHERTEXT_PATTERN.exec(values.ciphertext);
    if (!envelope?.[1] || !envelope[2] || !envelope[3]) throw new Error();
    nonce = Buffer.from(envelope[1], 'base64url');
    tag = Buffer.from(envelope[2], 'base64url');
    encrypted = Buffer.from(envelope[3], 'base64url');
    if (
      nonce.byteLength !== 12 ||
      tag.byteLength !== 16 ||
      encrypted.byteLength !== 12 ||
      nonce.toString('base64url') !== envelope[1] ||
      tag.toString('base64url') !== envelope[2] ||
      encrypted.toString('base64url') !== envelope[3]
    ) {
      throw new Error();
    }

    childKey = Buffer.from(scopedKey.keyHex, 'hex');
    keyFingerprint = createHash('sha256').update(childKey).digest();
    expectedFingerprint = Buffer.from(scopedKey.keyId.slice(7), 'hex');
    if (!timingSafeEqual(keyFingerprint, expectedFingerprint)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', childKey, nonce, { authTagLength: 16 });
    decipher.setAAD(aad(values.receiverRevisionId, values.receiverVersion));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const phone = plaintext.toString('utf8');
    if (!PHONE_PATTERN.test(phone) || values.masked !== `***${phone.slice(-4)}`) {
      throw new Error();
    }
    const result = useReceiverPhone(phone);
    if (result === phone || isThenable(result)) throw new Error();
    return result;
  } catch {
    throw new CbeBirrReceiverLookupProtectionError();
  } finally {
    childKey?.fill(0);
    keyFingerprint?.fill(0);
    expectedFingerprint?.fill(0);
    nonce?.fill(0);
    tag?.fill(0);
    encrypted?.fill(0);
    plaintext?.fill(0);
  }
}
