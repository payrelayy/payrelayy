import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { DepositProofReferenceProvider, DepositReferenceProtectionSecrets } from './index.js';

const REFERENCE = /^[A-Z0-9]{8,32}$/u;
const SECRET = /^[0-9a-f]{64}$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MASK = /^\*{3}[A-Z0-9]{4}$/u;
const ENVELOPE = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{11,43})$/u;

export class OwnerPaymentDisplayUnavailableError extends Error {
  constructor() {
    super('The Owner payment identifier is unavailable.');
    this.name = 'OwnerPaymentDisplayUnavailableError';
  }
}

function provider(value: unknown): value is DepositProofReferenceProvider {
  return value === 'telebirr' || value === 'cbe_birr';
}

function open(
  ciphertext: string,
  prefix: string,
  encryptionSecret: string,
  keyDomain: string,
  aadDomain: string,
): string {
  const envelope = ciphertext.startsWith(`${prefix}.`)
    ? ENVELOPE.exec(ciphertext.slice(prefix.length + 1))
    : null;
  if (!envelope?.[1] || !envelope[2] || !envelope[3]) throw new Error();
  const nonce = Buffer.from(envelope[1], 'base64url');
  const tag = Buffer.from(envelope[2], 'base64url');
  const encrypted = Buffer.from(envelope[3], 'base64url');
  const master = Buffer.from(encryptionSecret, 'hex');
  const key = createHmac('sha256', master).update(keyDomain, 'utf8').digest();
  try {
    if (
      nonce.length !== 12 ||
      tag.length !== 16 ||
      encrypted.length < 8 ||
      encrypted.length > 32 ||
      nonce.toString('base64url') !== envelope[1] ||
      tag.toString('base64url') !== envelope[2] ||
      encrypted.toString('base64url') !== envelope[3]
    )
      throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(aadDomain, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } finally {
    master.fill(0);
    key.fill(0);
    nonce.fill(0);
    tag.fill(0);
    encrypted.fill(0);
  }
}

/** Opens a submitted v2 reference only for an authenticated Owner read path. */
export function openOwnerDepositProofReference(input: {
  readonly provider: DepositProofReferenceProvider;
  readonly ciphertext: string;
  readonly fingerprint: string;
  readonly masked: string;
  readonly secrets: DepositReferenceProtectionSecrets;
}): string {
  try {
    const { provider: code, ciphertext, fingerprint, masked, secrets } = input;
    if (
      !provider(code) ||
      typeof ciphertext !== 'string' ||
      !FINGERPRINT.test(fingerprint) ||
      !MASK.test(masked) ||
      !SECRET.test(secrets.encryptionSecret) ||
      !SECRET.test(secrets.fingerprintSecret) ||
      secrets.encryptionSecret === secrets.fingerprintSecret
    )
      throw new Error();
    const reference = open(
      ciphertext,
      `v2.${code}`,
      secrets.encryptionSecret,
      `fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:${code}`,
      `fetanagent:deposit-proof-reference:encryption-aad:v2\nprovider:${code}`,
    );
    if (!REFERENCE.test(reference) || masked !== `***${reference.slice(-4)}`) throw new Error();
    const master = Buffer.from(secrets.fingerprintSecret, 'hex');
    const key = createHmac('sha256', master)
      .update(`fetanagent:deposit-proof-reference:fingerprint-key:v2\nprovider:${code}`, 'utf8')
      .digest();
    try {
      const expected = createHmac('sha256', key)
        .update(
          `fetanagent:deposit-proof-reference:fingerprint-input:v2\nprovider:${code}\n`,
          'utf8',
        )
        .update(reference, 'utf8')
        .digest();
      const supplied = Buffer.from(fingerprint, 'hex');
      const valid = timingSafeEqual(expected, supplied);
      expected.fill(0);
      supplied.fill(0);
      if (!valid) throw new Error();
      return reference;
    } finally {
      master.fill(0);
      key.fill(0);
    }
  } catch {
    throw new OwnerPaymentDisplayUnavailableError();
  }
}

/** Encrypts a verified phone reference under a display-only key, separate from proof keys. */
export function protectReceiverSmsDisplayReference(
  input: {
    readonly provider: DepositProofReferenceProvider;
    readonly reference: string;
    readonly encryptionSecret: string;
  },
  nonceFactory: () => Buffer = () => randomBytes(12),
): {
  readonly ciphertext: string;
  readonly masked: string;
} {
  try {
    const { provider: code, reference, encryptionSecret } = input;
    if (!provider(code) || !REFERENCE.test(reference) || !SECRET.test(encryptionSecret))
      throw new Error();
    const nonce = nonceFactory();
    if (!Buffer.isBuffer(nonce) || nonce.length !== 12) throw new Error();
    const master = Buffer.from(encryptionSecret, 'hex');
    const key = createHmac('sha256', master)
      .update(`fetanagent:receiver-sms-owner-display:encryption-key:v1\nprovider:${code}`, 'utf8')
      .digest();
    try {
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(
        Buffer.from(`fetanagent:receiver-sms-owner-display:aad:v1\nprovider:${code}`, 'utf8'),
      );
      const encrypted = Buffer.concat([cipher.update(reference, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Object.freeze({
        ciphertext: `sms-display-v1.${code}.${nonce.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`,
        masked: `***${reference.slice(-4)}`,
      });
    } finally {
      master.fill(0);
      key.fill(0);
    }
  } catch {
    throw new OwnerPaymentDisplayUnavailableError();
  }
}

/** Opens one stored phone reference after checking its signed-event digest. */
export function openReceiverSmsDisplayReference(input: {
  readonly provider: DepositProofReferenceProvider;
  readonly ciphertext: string;
  readonly masked: string;
  readonly referenceDigest: string;
  readonly encryptionSecret: string;
}): string {
  try {
    const { provider: code, ciphertext, masked, referenceDigest, encryptionSecret } = input;
    if (
      !provider(code) ||
      typeof ciphertext !== 'string' ||
      !MASK.test(masked) ||
      !DIGEST.test(referenceDigest) ||
      !SECRET.test(encryptionSecret)
    )
      throw new Error();
    const reference = open(
      ciphertext,
      `sms-display-v1.${code}`,
      encryptionSecret,
      `fetanagent:receiver-sms-owner-display:encryption-key:v1\nprovider:${code}`,
      `fetanagent:receiver-sms-owner-display:aad:v1\nprovider:${code}`,
    );
    if (
      !REFERENCE.test(reference) ||
      masked !== `***${reference.slice(-4)}` ||
      `sha256:${createHash('sha256').update(reference, 'utf8').digest('hex')}` !== referenceDigest
    )
      throw new Error();
    return reference;
  } catch {
    throw new OwnerPaymentDisplayUnavailableError();
  }
}
