import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

export const TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_REFERENCE_OPENING_PROVIDER = 'telebirr' as const;
export const TELEBIRR_REFERENCE_OPENING_PURPOSE = 'deposit-proof-reference-opening' as const;
export const TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION = 2 as const;
export const TELEBIRR_REFERENCE_OPENING_KEY_VERSION = 2 as const;

const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const REFERENCE_PATTERN = /^[A-Z0-9]{8,32}$/u;
const ENVELOPE_PATTERN =
  /^v2\.telebirr\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{11,43})$/u;

export interface TelebirrScopedReferenceOpeningKey {
  readonly contractVersion: typeof TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION;
  readonly providerCode: typeof TELEBIRR_REFERENCE_OPENING_PROVIDER;
  readonly purpose: typeof TELEBIRR_REFERENCE_OPENING_PURPOSE;
  readonly keyVersion: typeof TELEBIRR_REFERENCE_OPENING_KEY_VERSION;
  /** SHA-256 fingerprint of keyHex; safe to pin in an immutable non-secret manifest. */
  readonly keyId: string;
  /** Provider/purpose-scoped child key. This is not an API master or fingerprint key. */
  readonly keyHex: string;
}

export interface TelebirrProtectedReferenceOpeningInput {
  readonly ciphertext: string;
  readonly ciphertextProfileVersion: typeof TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION;
  readonly encryptionKeyVersion: typeof TELEBIRR_REFERENCE_OPENING_KEY_VERSION;
  readonly providerCode: typeof TELEBIRR_REFERENCE_OPENING_PROVIDER;
}

export class TelebirrReferenceOpeningError extends Error {
  constructor() {
    super('The protected TeleBirr reference could not be opened.');
    this.name = 'TelebirrReferenceOpeningError';
  }
}

function exactDataProperties(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    nodeUtilTypes.isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Object.prototype
  ) {
    return undefined;
  }
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function decodeBase64url(
  value: string,
  expectedLength: number | readonly [number, number],
): Buffer {
  const decoded = Buffer.from(value, 'base64url');
  const validLength =
    typeof expectedLength === 'number'
      ? decoded.byteLength === expectedLength
      : decoded.byteLength >= expectedLength[0] && decoded.byteLength <= expectedLength[1];
  if (!validLength || decoded.toString('base64url') !== value) {
    decoded.fill(0);
    throw new Error();
  }
  return decoded;
}

function isThenable(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  if (nodeUtilTypes.isProxy(value)) return true;
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
 * Opens exactly one provider-bound reference for a synchronous trusted callback. The plaintext
 * buffer and all decoded key/envelope material are wiped before this function returns. The callback
 * must not return the raw string directly or retain it for asynchronous work.
 */
export function withOpenedTelebirrDepositProofReference<Result>(
  inputCandidate: TelebirrProtectedReferenceOpeningInput,
  keyCandidate: TelebirrScopedReferenceOpeningKey,
  useReference: (rawReference: string) => Result,
): Result {
  let key: Buffer | undefined;
  let keyFingerprint: Buffer | undefined;
  let expectedKeyFingerprint: Buffer | undefined;
  let nonce: Buffer | undefined;
  let tag: Buffer | undefined;
  let encrypted: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    const input = exactDataProperties(inputCandidate, [
      'ciphertext',
      'ciphertextProfileVersion',
      'encryptionKeyVersion',
      'providerCode',
    ]);
    const scopedKey = exactDataProperties(keyCandidate, [
      'contractVersion',
      'providerCode',
      'purpose',
      'keyVersion',
      'keyId',
      'keyHex',
    ]);
    if (
      input === undefined ||
      scopedKey === undefined ||
      input.providerCode !== TELEBIRR_REFERENCE_OPENING_PROVIDER ||
      input.ciphertextProfileVersion !== TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION ||
      input.encryptionKeyVersion !== TELEBIRR_REFERENCE_OPENING_KEY_VERSION ||
      typeof input.ciphertext !== 'string' ||
      input.ciphertext !== input.ciphertext.trim() ||
      scopedKey.contractVersion !== TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION ||
      scopedKey.providerCode !== TELEBIRR_REFERENCE_OPENING_PROVIDER ||
      scopedKey.purpose !== TELEBIRR_REFERENCE_OPENING_PURPOSE ||
      scopedKey.keyVersion !== TELEBIRR_REFERENCE_OPENING_KEY_VERSION ||
      typeof scopedKey.keyId !== 'string' ||
      !KEY_ID_PATTERN.test(scopedKey.keyId) ||
      typeof scopedKey.keyHex !== 'string' ||
      !HEX_KEY_PATTERN.test(scopedKey.keyHex) ||
      typeof useReference !== 'function' ||
      nodeUtilTypes.isProxy(useReference)
    ) {
      throw new Error();
    }

    key = Buffer.from(scopedKey.keyHex, 'hex');
    keyFingerprint = createHash('sha256').update(key).digest();
    expectedKeyFingerprint = Buffer.from(scopedKey.keyId.slice(7), 'hex');
    if (!timingSafeEqual(keyFingerprint, expectedKeyFingerprint)) throw new Error();

    const envelope = ENVELOPE_PATTERN.exec(input.ciphertext);
    if (envelope === null) throw new Error();
    nonce = decodeBase64url(envelope[1]!, 12);
    tag = decodeBase64url(envelope[2]!, 16);
    encrypted = decodeBase64url(envelope[3]!, [8, 32]);

    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(
      Buffer.from(
        'fetanagent:deposit-proof-reference:encryption-aad:v2\nprovider:telebirr',
        'utf8',
      ),
    );
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    if (
      plaintext.byteLength < 8 ||
      plaintext.byteLength > 32 ||
      plaintext.some(
        (value) => !((value >= 0x30 && value <= 0x39) || (value >= 0x41 && value <= 0x5a)),
      )
    ) {
      throw new Error();
    }
    const rawReference = plaintext.toString('ascii');
    if (!REFERENCE_PATTERN.test(rawReference)) throw new Error();

    const result = useReference(rawReference);
    if (result === rawReference || isThenable(result)) throw new Error();
    return result;
  } catch {
    throw new TelebirrReferenceOpeningError();
  } finally {
    key?.fill(0);
    keyFingerprint?.fill(0);
    expectedKeyFingerprint?.fill(0);
    nonce?.fill(0);
    tag?.fill(0);
    encrypted?.fill(0);
    plaintext?.fill(0);
  }
}
