import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { createDecipheriv, timingSafeEqual } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

const REFERENCE_PATTERN = /^[A-Za-z0-9._-]+$/u;
const DIRECT_PROOF_REFERENCE_PATTERN = /^[A-Za-z0-9]+$/u;
const SECRET_PATTERN = /^[0-9a-f]{64}$/u;

export const DEPOSIT_REFERENCE_KEY_VERSION = 1 as const;
export const DEPOSIT_REFERENCE_MIN_CODE_POINTS = 5;
export const DEPOSIT_REFERENCE_MAX_CODE_POINTS = 128;

export const DEPOSIT_PROOF_REFERENCE_KEY_VERSION = 2 as const;
export const DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION = 2 as const;
export const DEPOSIT_PROOF_REFERENCE_MIN_CODE_POINTS = 8;
export const DEPOSIT_PROOF_REFERENCE_MAX_CODE_POINTS = 32;
export const DEPOSIT_PROOF_REFERENCE_PROVIDERS = Object.freeze(['cbe_birr', 'telebirr'] as const);

export const RECEIVER_ACCOUNT_REFERENCE_KEY_VERSION = 1 as const;
export const RECEIVER_ACCOUNT_REFERENCE_PROFILE_VERSION = 1 as const;
export const RECEIVER_ACCOUNT_REFERENCE_MIN_DIGITS = 9;
export const RECEIVER_ACCOUNT_REFERENCE_MAX_DIGITS = 24;

export type DepositProofReferenceProvider = (typeof DEPOSIT_PROOF_REFERENCE_PROVIDERS)[number];

export interface ProtectedDepositReference {
  readonly ciphertext: string;
  readonly fingerprint: string;
  readonly keyVersion: typeof DEPOSIT_REFERENCE_KEY_VERSION;
  readonly masked: string;
}

export interface DepositReferenceProtectionDependencies {
  readonly nonce?: () => Buffer;
}

export interface DepositReferenceProtectionSecrets {
  readonly encryptionSecret: string;
  readonly fingerprintSecret: string;
}

export interface DepositProofReferenceProtectionInput {
  readonly provider: DepositProofReferenceProvider;
  readonly reference: string;
  readonly secrets: DepositReferenceProtectionSecrets;
}

export interface ProtectedDepositProofReference {
  readonly ciphertext: string;
  readonly fingerprint: string;
  readonly keyVersion: typeof DEPOSIT_PROOF_REFERENCE_KEY_VERSION;
  readonly masked: string;
  readonly provider: DepositProofReferenceProvider;
}

export interface ReceiverAccountReferenceProtectionInput {
  readonly provider: DepositProofReferenceProvider;
  readonly reference: string;
  readonly secrets: DepositReferenceProtectionSecrets;
}

export interface ProtectedReceiverAccountReference {
  readonly ciphertext: string;
  readonly fingerprint: string;
  readonly keyVersion: typeof RECEIVER_ACCOUNT_REFERENCE_KEY_VERSION;
  readonly masked: string;
  readonly profileVersion: typeof RECEIVER_ACCOUNT_REFERENCE_PROFILE_VERSION;
  readonly provider: DepositProofReferenceProvider;
}

export interface ReceiverAccountReferenceUnprotectionInput {
  readonly ciphertext: string;
  readonly fingerprint: string;
  readonly masked: string;
  readonly provider: DepositProofReferenceProvider;
  readonly secrets: DepositReferenceProtectionSecrets;
}

export class DepositReferenceProtectionError extends Error {
  constructor() {
    super('The deposit reference could not be protected.');
    this.name = 'DepositReferenceProtectionError';
  }
}

function validReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    Array.from(value).length >= DEPOSIT_REFERENCE_MIN_CODE_POINTS &&
    Array.from(value).length <= DEPOSIT_REFERENCE_MAX_CODE_POINTS &&
    REFERENCE_PATTERN.test(value)
  );
}

function validSecret(value: unknown): value is string {
  return typeof value === 'string' && SECRET_PATTERN.test(value);
}

function validDepositProofReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= DEPOSIT_PROOF_REFERENCE_MIN_CODE_POINTS &&
    value.length <= DEPOSIT_PROOF_REFERENCE_MAX_CODE_POINTS &&
    DIRECT_PROOF_REFERENCE_PATTERN.test(value)
  );
}

function validReceiverAccountReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= RECEIVER_ACCOUNT_REFERENCE_MIN_DIGITS &&
    value.length <= RECEIVER_ACCOUNT_REFERENCE_MAX_DIGITS &&
    /^[0-9]+$/u.test(value)
  );
}

function exactNonce(factory: (() => Buffer) | undefined): Buffer {
  const nonce = factory?.() ?? randomBytes(12);
  if (!Buffer.isBuffer(nonce) || nonce.byteLength !== 12) throw new Error();
  return Buffer.from(nonce);
}

function exactDataProperties(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || nodeUtilTypes.isProxy(value)) return undefined;
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return undefined;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return undefined;
    }
    properties[key] = descriptor.value;
  }
  return properties;
}

function exactProvider(value: unknown): value is DepositProofReferenceProvider {
  return value === 'cbe_birr' || value === 'telebirr';
}

function exactProviderAwareNonce(
  dependencies: DepositReferenceProtectionDependencies,
): (() => Buffer) | undefined {
  if (nodeUtilTypes.isProxy(dependencies)) throw new Error();
  const keys = Reflect.ownKeys(dependencies);
  if (keys.length === 0) {
    if (Object.getPrototypeOf(dependencies) !== Object.prototype) throw new Error();
    return undefined;
  }

  const properties = exactDataProperties(dependencies, ['nonce']);
  if (properties === undefined || typeof properties.nonce !== 'function') throw new Error();
  return properties.nonce as () => Buffer;
}

/**
 * Protects a customer-entered CBE Birr reference inside server-only trusted memory. The returned
 * fingerprint is stable across both customer channels, while randomized AES-GCM ciphertext keeps
 * the canonical reference confidential at rest. No raw reference is included in errors or safe
 * projections.
 */
export function protectCbeBirrDepositReference(
  reference: string,
  secrets: DepositReferenceProtectionSecrets,
  dependencies: DepositReferenceProtectionDependencies = {},
): ProtectedDepositReference {
  let encryptionMaster: Buffer | undefined;
  let fingerprintMaster: Buffer | undefined;
  let encryptionKey: Buffer | undefined;
  let fingerprintKey: Buffer | undefined;
  let nonce: Buffer | undefined;
  try {
    if (
      !validReference(reference) ||
      !validSecret(secrets?.encryptionSecret) ||
      !validSecret(secrets?.fingerprintSecret) ||
      secrets.encryptionSecret === secrets.fingerprintSecret
    ) {
      throw new Error();
    }

    const normalizedReference = reference.toUpperCase();
    encryptionMaster = Buffer.from(secrets.encryptionSecret, 'hex');
    fingerprintMaster = Buffer.from(secrets.fingerprintSecret, 'hex');
    encryptionKey = createHmac('sha256', encryptionMaster)
      .update('fetanagent:deposit-reference:encryption-key:v1', 'utf8')
      .digest();
    fingerprintKey = createHmac('sha256', fingerprintMaster)
      .update('fetanagent:deposit-reference:fingerprint-key:v1', 'utf8')
      .digest();
    nonce = exactNonce(dependencies.nonce);

    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    cipher.setAAD(Buffer.from('fetanagent:deposit-reference:v1', 'utf8'));
    const encrypted = Buffer.concat([cipher.update(normalizedReference, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const fingerprint = createHmac('sha256', fingerprintKey)
      .update('fetanagent:deposit-reference:fingerprint-input:v1\n', 'utf8')
      .update('provider:cbe_birr\n', 'utf8')
      .update(normalizedReference, 'utf8')
      .digest('hex');
    const suffix = normalizedReference.slice(-4);
    if (!/^[A-Z0-9._-]{4}$/u.test(suffix)) throw new Error();

    return Object.freeze({
      ciphertext: `v1.${nonce.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`,
      fingerprint,
      keyVersion: DEPOSIT_REFERENCE_KEY_VERSION,
      masked: `***${suffix}`,
    });
  } catch {
    throw new DepositReferenceProtectionError();
  } finally {
    encryptionMaster?.fill(0);
    fingerprintMaster?.fill(0);
    encryptionKey?.fill(0);
    fingerprintKey?.fill(0);
    nonce?.fill(0);
  }
}

/**
 * Protects a provider receipt reference without exposing the canonical value. Provider identity is
 * bound independently into the encryption key, authenticated data, fingerprint key, and
 * fingerprint input so values cannot be confused across payment-provider boundaries.
 */
export function protectDepositProofReference(
  input: DepositProofReferenceProtectionInput,
  dependencies: DepositReferenceProtectionDependencies = {},
): ProtectedDepositProofReference {
  let encryptionMaster: Buffer | undefined;
  let fingerprintMaster: Buffer | undefined;
  let encryptionKey: Buffer | undefined;
  let fingerprintKey: Buffer | undefined;
  let nonce: Buffer | undefined;
  try {
    const inputProperties = exactDataProperties(input, ['provider', 'reference', 'secrets']);
    if (inputProperties === undefined) throw new Error();

    const secretsProperties = exactDataProperties(inputProperties.secrets, [
      'encryptionSecret',
      'fingerprintSecret',
    ]);
    if (
      !exactProvider(inputProperties.provider) ||
      !validDepositProofReference(inputProperties.reference) ||
      secretsProperties === undefined ||
      !validSecret(secretsProperties.encryptionSecret) ||
      !validSecret(secretsProperties.fingerprintSecret) ||
      secretsProperties.encryptionSecret === secretsProperties.fingerprintSecret
    ) {
      throw new Error();
    }

    const provider = inputProperties.provider;
    const normalizedReference = inputProperties.reference.toUpperCase();
    encryptionMaster = Buffer.from(secretsProperties.encryptionSecret, 'hex');
    fingerprintMaster = Buffer.from(secretsProperties.fingerprintSecret, 'hex');
    encryptionKey = createHmac('sha256', encryptionMaster)
      .update(`fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:${provider}`, 'utf8')
      .digest();
    fingerprintKey = createHmac('sha256', fingerprintMaster)
      .update(`fetanagent:deposit-proof-reference:fingerprint-key:v2\nprovider:${provider}`, 'utf8')
      .digest();
    nonce = exactNonce(exactProviderAwareNonce(dependencies));

    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    cipher.setAAD(
      Buffer.from(
        `fetanagent:deposit-proof-reference:encryption-aad:v2\nprovider:${provider}`,
        'utf8',
      ),
    );
    const encrypted = Buffer.concat([cipher.update(normalizedReference, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const fingerprint = createHmac('sha256', fingerprintKey)
      .update(
        `fetanagent:deposit-proof-reference:fingerprint-input:v2\nprovider:${provider}\n`,
        'utf8',
      )
      .update(normalizedReference, 'utf8')
      .digest('hex');
    const suffix = normalizedReference.slice(-4);
    if (!/^[A-Z0-9]{4}$/u.test(suffix)) throw new Error();

    return Object.freeze({
      ciphertext: `v2.${provider}.${nonce.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`,
      fingerprint,
      keyVersion: DEPOSIT_PROOF_REFERENCE_KEY_VERSION,
      masked: `***${suffix}`,
      provider,
    });
  } catch {
    throw new DepositReferenceProtectionError();
  } finally {
    encryptionMaster?.fill(0);
    fingerprintMaster?.fill(0);
    encryptionKey?.fill(0);
    fingerprintKey?.fill(0);
    nonce?.fill(0);
  }
}

/**
 * Protects an Owner-configured receiver wallet/account number before it crosses the PostgreSQL
 * boundary. This contract is deliberately separate from customer proof references: provider
 * identity is bound into the derived keys, authenticated data, envelope, and blind index, while
 * only a four-digit suffix remains displayable. Callers must supply the exact digits; this routine
 * never guesses, strips punctuation, or normalizes a country prefix.
 */
export function protectReceiverAccountReference(
  input: ReceiverAccountReferenceProtectionInput,
  dependencies: DepositReferenceProtectionDependencies = {},
): ProtectedReceiverAccountReference {
  let encryptionMaster: Buffer | undefined;
  let fingerprintMaster: Buffer | undefined;
  let encryptionKey: Buffer | undefined;
  let fingerprintKey: Buffer | undefined;
  let nonce: Buffer | undefined;
  try {
    const inputProperties = exactDataProperties(input, ['provider', 'reference', 'secrets']);
    if (inputProperties === undefined) throw new Error();
    const secretsProperties = exactDataProperties(inputProperties.secrets, [
      'encryptionSecret',
      'fingerprintSecret',
    ]);
    if (
      !exactProvider(inputProperties.provider) ||
      !validReceiverAccountReference(inputProperties.reference) ||
      secretsProperties === undefined ||
      !validSecret(secretsProperties.encryptionSecret) ||
      !validSecret(secretsProperties.fingerprintSecret) ||
      secretsProperties.encryptionSecret === secretsProperties.fingerprintSecret
    ) {
      throw new Error();
    }

    const provider = inputProperties.provider;
    const reference = inputProperties.reference;
    encryptionMaster = Buffer.from(secretsProperties.encryptionSecret, 'hex');
    fingerprintMaster = Buffer.from(secretsProperties.fingerprintSecret, 'hex');
    encryptionKey = createHmac('sha256', encryptionMaster)
      .update(
        `fetanagent:receiver-account-reference:encryption-key:v1\nprovider:${provider}`,
        'utf8',
      )
      .digest();
    fingerprintKey = createHmac('sha256', fingerprintMaster)
      .update(
        `fetanagent:receiver-account-reference:fingerprint-key:v1\nprovider:${provider}`,
        'utf8',
      )
      .digest();
    nonce = exactNonce(exactProviderAwareNonce(dependencies));

    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    cipher.setAAD(
      Buffer.from(
        `fetanagent:receiver-account-reference:encryption-aad:v1\nprovider:${provider}`,
        'utf8',
      ),
    );
    const encrypted = Buffer.concat([cipher.update(reference, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const fingerprint = createHmac('sha256', fingerprintKey)
      .update(
        `fetanagent:receiver-account-reference:fingerprint-input:v1\nprovider:${provider}\n`,
        'utf8',
      )
      .update(reference, 'utf8')
      .digest('hex');

    return Object.freeze({
      ciphertext: `receiver-v1.${provider}.${nonce.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`,
      fingerprint,
      keyVersion: RECEIVER_ACCOUNT_REFERENCE_KEY_VERSION,
      masked: `***${reference.slice(-4)}`,
      profileVersion: RECEIVER_ACCOUNT_REFERENCE_PROFILE_VERSION,
      provider,
    });
  } catch {
    throw new DepositReferenceProtectionError();
  } finally {
    encryptionMaster?.fill(0);
    fingerprintMaster?.fill(0);
    encryptionKey?.fill(0);
    fingerprintKey?.fill(0);
    nonce?.fill(0);
  }
}

/**
 * Opens one Owner-protected receiver wallet/account number for an authenticated customer-payment
 * presentation. Callers must keep the returned digits in trusted memory, must never log them, and
 * must disclose them only after their own payment-readiness and customer-authorization checks.
 * The provider, authenticated ciphertext, keyed fingerprint, and stored mask must all agree.
 */
export function unprotectReceiverAccountReference(
  input: ReceiverAccountReferenceUnprotectionInput,
): string {
  let encryptionMaster: Buffer | undefined;
  let fingerprintMaster: Buffer | undefined;
  let encryptionKey: Buffer | undefined;
  let fingerprintKey: Buffer | undefined;
  let nonce: Buffer | undefined;
  let tag: Buffer | undefined;
  let encrypted: Buffer | undefined;
  let decrypted: Buffer | undefined;
  let calculatedFingerprint: Buffer | undefined;
  let suppliedFingerprint: Buffer | undefined;
  try {
    const inputProperties = exactDataProperties(input, [
      'ciphertext',
      'fingerprint',
      'masked',
      'provider',
      'secrets',
    ]);
    if (inputProperties === undefined) throw new Error();
    const secretsProperties = exactDataProperties(inputProperties.secrets, [
      'encryptionSecret',
      'fingerprintSecret',
    ]);
    if (
      !exactProvider(inputProperties.provider) ||
      typeof inputProperties.ciphertext !== 'string' ||
      typeof inputProperties.fingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(inputProperties.fingerprint) ||
      typeof inputProperties.masked !== 'string' ||
      !/^\*{3}[0-9]{4}$/u.test(inputProperties.masked) ||
      secretsProperties === undefined ||
      !validSecret(secretsProperties.encryptionSecret) ||
      !validSecret(secretsProperties.fingerprintSecret) ||
      secretsProperties.encryptionSecret === secretsProperties.fingerprintSecret
    ) {
      throw new Error();
    }

    const provider = inputProperties.provider;
    const envelopePattern = new RegExp(
      `^receiver-v1\\.${provider}\\.([A-Za-z0-9_-]{16})\\.([A-Za-z0-9_-]{22})\\.([A-Za-z0-9_-]{12,32})$`,
      'u',
    );
    const envelope = envelopePattern.exec(inputProperties.ciphertext);
    if (!envelope?.[1] || !envelope[2] || !envelope[3]) throw new Error();

    encryptionMaster = Buffer.from(secretsProperties.encryptionSecret, 'hex');
    fingerprintMaster = Buffer.from(secretsProperties.fingerprintSecret, 'hex');
    encryptionKey = createHmac('sha256', encryptionMaster)
      .update(
        `fetanagent:receiver-account-reference:encryption-key:v1\nprovider:${provider}`,
        'utf8',
      )
      .digest();
    fingerprintKey = createHmac('sha256', fingerprintMaster)
      .update(
        `fetanagent:receiver-account-reference:fingerprint-key:v1\nprovider:${provider}`,
        'utf8',
      )
      .digest();
    nonce = Buffer.from(envelope[1], 'base64url');
    tag = Buffer.from(envelope[2], 'base64url');
    encrypted = Buffer.from(envelope[3], 'base64url');
    if (
      nonce.byteLength !== 12 ||
      tag.byteLength !== 16 ||
      encrypted.byteLength < RECEIVER_ACCOUNT_REFERENCE_MIN_DIGITS ||
      encrypted.byteLength > RECEIVER_ACCOUNT_REFERENCE_MAX_DIGITS
    ) {
      throw new Error();
    }

    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, nonce);
    decipher.setAAD(
      Buffer.from(
        `fetanagent:receiver-account-reference:encryption-aad:v1\nprovider:${provider}`,
        'utf8',
      ),
    );
    decipher.setAuthTag(tag);
    decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const reference = decrypted.toString('utf8');
    if (
      !validReceiverAccountReference(reference) ||
      inputProperties.masked !== `***${reference.slice(-4)}`
    ) {
      throw new Error();
    }

    calculatedFingerprint = createHmac('sha256', fingerprintKey)
      .update(
        `fetanagent:receiver-account-reference:fingerprint-input:v1\nprovider:${provider}\n`,
        'utf8',
      )
      .update(reference, 'utf8')
      .digest();
    suppliedFingerprint = Buffer.from(inputProperties.fingerprint, 'hex');
    if (
      suppliedFingerprint.byteLength !== calculatedFingerprint.byteLength ||
      !timingSafeEqual(suppliedFingerprint, calculatedFingerprint)
    ) {
      throw new Error();
    }

    return reference;
  } catch {
    throw new DepositReferenceProtectionError();
  } finally {
    encryptionMaster?.fill(0);
    fingerprintMaster?.fill(0);
    encryptionKey?.fill(0);
    fingerprintKey?.fill(0);
    nonce?.fill(0);
    tag?.fill(0);
    encrypted?.fill(0);
    decrypted?.fill(0);
    calculatedFingerprint?.fill(0);
    suppliedFingerprint?.fill(0);
  }
}
