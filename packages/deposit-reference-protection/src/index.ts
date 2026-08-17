import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

const REFERENCE_PATTERN = /^[A-Za-z0-9._-]+$/u;
const SECRET_PATTERN = /^[0-9a-f]{64}$/u;

export const DEPOSIT_REFERENCE_KEY_VERSION = 1 as const;
export const DEPOSIT_REFERENCE_MIN_CODE_POINTS = 5;
export const DEPOSIT_REFERENCE_MAX_CODE_POINTS = 128;

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

function exactNonce(factory: (() => Buffer) | undefined): Buffer {
  const nonce = factory?.() ?? randomBytes(12);
  if (!Buffer.isBuffer(nonce) || nonce.byteLength !== 12) throw new Error();
  return Buffer.from(nonce);
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
