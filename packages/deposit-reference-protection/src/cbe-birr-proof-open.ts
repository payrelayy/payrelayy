import { createDecipheriv, createHmac } from 'node:crypto';
import { isProxy } from 'node:util/types';

/**
 * Offline CBE-only worker decrypt candidate for provider-aware v2 proof references. Deliberately
 * absent from the package entry point and every application. A valid plaintext does not prove
 * receipt origin, proof ownership, an independent worker key lifecycle, or lease eligibility.
 */
export interface OpenCbeBirrDepositProofReferenceInput {
  readonly provider: 'cbe_birr';
  readonly ciphertext: string;
  readonly masked: string;
  readonly referenceProfileVersion: 2;
  readonly encryptionKeyVersion: 2;
  readonly encryptionSecret: string;
}

const ENVELOPE_PATTERN =
  /^v2\.cbe_birr\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{11,43})$/u;
const CANONICAL_REFERENCE_PATTERN = /^[A-Z0-9]{8,32}$/u;
const SECRET_PATTERN = /^[0-9a-f]{64}$/u;

export class CbeBirrDepositProofOpenError extends Error {
  constructor() {
    super('CBE Birr deposit proof reference is unavailable.');
    this.name = 'CbeBirrDepositProofOpenError';
  }
}

function exactInput(candidate: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return undefined;
  if (Object.getPrototypeOf(candidate) !== Object.prototype) return undefined;
  const expected = [
    'provider',
    'ciphertext',
    'masked',
    'referenceProfileVersion',
    'encryptionKeyVersion',
    'encryptionSecret',
  ] as const;
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expected.length ||
    keys.some(
      (key) => typeof key !== 'string' || !expected.includes(key as (typeof expected)[number]),
    )
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return undefined;
    }
    values[key] = descriptor.value;
  }
  return values;
}

/**
 * Opens exactly one authenticated CBE v2 envelope with the encryption master only. The caller
 * must obtain that master through a separately reviewed worker lifecycle and must never log or
 * persist the returned reference. This function performs no database, lease, or provider action.
 */
export function openCbeBirrDepositProofReference(
  input: OpenCbeBirrDepositProofReferenceInput,
): string {
  let encryptionMaster: Buffer | undefined;
  let encryptionKey: Buffer | undefined;
  let nonce: Buffer | undefined;
  let tag: Buffer | undefined;
  let encrypted: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    const values = exactInput(input);
    if (
      !values ||
      values.provider !== 'cbe_birr' ||
      values.referenceProfileVersion !== 2 ||
      values.encryptionKeyVersion !== 2 ||
      typeof values.ciphertext !== 'string' ||
      typeof values.masked !== 'string' ||
      !/^\*{3}[A-Z0-9]{4}$/u.test(values.masked) ||
      typeof values.encryptionSecret !== 'string' ||
      !SECRET_PATTERN.test(values.encryptionSecret)
    ) {
      throw new Error();
    }
    const envelope = ENVELOPE_PATTERN.exec(values.ciphertext);
    if (!envelope?.[1] || !envelope[2] || !envelope[3]) throw new Error();
    nonce = Buffer.from(envelope[1], 'base64url');
    tag = Buffer.from(envelope[2], 'base64url');
    encrypted = Buffer.from(envelope[3], 'base64url');
    if (
      nonce.byteLength !== 12 ||
      tag.byteLength !== 16 ||
      encrypted.byteLength < 8 ||
      encrypted.byteLength > 32 ||
      nonce.toString('base64url') !== envelope[1] ||
      tag.toString('base64url') !== envelope[2] ||
      encrypted.toString('base64url') !== envelope[3]
    ) {
      throw new Error();
    }

    encryptionMaster = Buffer.from(values.encryptionSecret, 'hex');
    encryptionKey = createHmac('sha256', encryptionMaster)
      .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:cbe_birr', 'utf8')
      .digest();
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, nonce);
    decipher.setAAD(
      Buffer.from(
        'fetanagent:deposit-proof-reference:encryption-aad:v2\nprovider:cbe_birr',
        'utf8',
      ),
    );
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const reference = plaintext.toString('utf8');
    if (
      !CANONICAL_REFERENCE_PATTERN.test(reference) ||
      values.masked !== `***${reference.slice(-4)}`
    ) {
      throw new Error();
    }
    return reference;
  } catch {
    throw new CbeBirrDepositProofOpenError();
  } finally {
    encryptionMaster?.fill(0);
    encryptionKey?.fill(0);
    nonce?.fill(0);
    tag?.fill(0);
    encrypted?.fill(0);
    plaintext?.fill(0);
  }
}
