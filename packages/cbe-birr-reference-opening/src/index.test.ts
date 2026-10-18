import { createHash, createHmac } from 'node:crypto';

import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';
import { describe, expect, it, vi } from 'vitest';

import {
  CBE_BIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION,
  CBE_BIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  CBE_BIRR_REFERENCE_OPENING_KEY_VERSION,
  CBE_BIRR_REFERENCE_OPENING_PROVIDER,
  CBE_BIRR_REFERENCE_OPENING_PURPOSE,
  CbeBirrReferenceOpeningError,
  withOpenedCbeBirrDepositProofReference,
  type CbeBirrProtectedReferenceOpeningInput,
  type CbeBirrScopedReferenceOpeningKey,
} from './index.js';

const encryptionMaster = 'a'.repeat(64);
const fingerprintMaster = 'b'.repeat(64);

function scopedKey(overrides: Partial<CbeBirrScopedReferenceOpeningKey> = {}) {
  const master = Buffer.from(encryptionMaster, 'hex');
  const child = createHmac('sha256', master)
    .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:cbe_birr', 'utf8')
    .digest();
  master.fill(0);
  const value: CbeBirrScopedReferenceOpeningKey = {
    contractVersion: CBE_BIRR_REFERENCE_OPENING_CONTRACT_VERSION,
    providerCode: CBE_BIRR_REFERENCE_OPENING_PROVIDER,
    purpose: CBE_BIRR_REFERENCE_OPENING_PURPOSE,
    keyVersion: CBE_BIRR_REFERENCE_OPENING_KEY_VERSION,
    keyId: `sha256:${createHash('sha256').update(child).digest('hex')}`,
    keyHex: child.toString('hex'),
    ...overrides,
  };
  child.fill(0);
  return value;
}

function protectedInput(reference = 'FTAN12345678'): CbeBirrProtectedReferenceOpeningInput {
  const protectedReference = protectDepositProofReference(
    {
      provider: 'cbe_birr',
      reference,
      secrets: {
        encryptionSecret: encryptionMaster,
        fingerprintSecret: fingerprintMaster,
      },
    },
    { nonce: () => Buffer.from('000102030405060708090a0b', 'hex') },
  );
  return {
    ciphertext: protectedReference.ciphertext,
    masked: protectedReference.masked,
    ciphertextProfileVersion: CBE_BIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION,
    encryptionKeyVersion: protectedReference.keyVersion,
    providerCode: CBE_BIRR_REFERENCE_OPENING_PROVIDER,
  };
}

describe('CBE Birr protected-reference opening boundary', () => {
  it('opens only the provider-scoped v2 envelope inside the synchronous callback', () => {
    const callback = vi.fn((reference: string) => Object.freeze({ digest: reference.slice(-4) }));
    const result = withOpenedCbeBirrDepositProofReference(protectedInput(), scopedKey(), callback);

    expect(result).toEqual({ digest: '5678' });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('FTAN12345678');
  });

  it('opens the canonical uppercase reference produced from mixed-case capture', () => {
    const callback = vi.fn((reference: string) => reference.endsWith('5678'));
    expect(
      withOpenedCbeBirrDepositProofReference(protectedInput('ftan12345678'), scopedKey(), callback),
    ).toBe(true);
    expect(callback).toHaveBeenCalledWith('FTAN12345678');
  });

  it('rejects a wrong scoped key or mismatched key fingerprint without exposing material', () => {
    const wrongKey = scopedKey({ keyHex: 'c'.repeat(64) });
    expect(() =>
      withOpenedCbeBirrDepositProofReference(protectedInput(), wrongKey, () => ({ ok: true })),
    ).toThrow(CbeBirrReferenceOpeningError);
    try {
      withOpenedCbeBirrDepositProofReference(protectedInput(), wrongKey, () => ({ ok: true }));
    } catch (error) {
      expect(String(error)).not.toContain(encryptionMaster);
      expect(String(error)).not.toContain(fingerprintMaster);
      expect(String(error)).not.toContain('FTAN12345678');
    }
  });

  it.each([
    (value: CbeBirrProtectedReferenceOpeningInput) => ({ ...value, providerCode: 'telebirr' }),
    (value: CbeBirrProtectedReferenceOpeningInput) => ({ ...value, masked: '***9999' }),
    (value: CbeBirrProtectedReferenceOpeningInput) => ({ ...value, masked: '***5678 ' }),
    (value: CbeBirrProtectedReferenceOpeningInput) => ({
      ...value,
      ciphertext: value.ciphertext.replace('cbe_birr', 'telebirr'),
    }),
    (value: CbeBirrProtectedReferenceOpeningInput) => ({ ...value, ciphertextProfileVersion: 1 }),
    (value: CbeBirrProtectedReferenceOpeningInput) => ({ ...value, encryptionKeyVersion: 1 }),
    (value: CbeBirrProtectedReferenceOpeningInput) => ({ ...value, extra: true }),
    (value: CbeBirrProtectedReferenceOpeningInput) => ({
      ...value,
      ciphertext: `${value.ciphertext.slice(0, -1)}${value.ciphertext.endsWith('A') ? 'B' : 'A'}`,
    }),
  ])('fails closed for altered input %#', (alter) => {
    const callback = vi.fn(() => ({ ok: true }));
    expect(() =>
      withOpenedCbeBirrDepositProofReference(
        alter(protectedInput()) as CbeBirrProtectedReferenceOpeningInput,
        scopedKey(),
        callback,
      ),
    ).toThrow(CbeBirrReferenceOpeningError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects a different child key even when its key fingerprint is internally consistent', () => {
    const otherChild = Buffer.alloc(32, 0xc);
    const otherKey = scopedKey({
      keyHex: otherChild.toString('hex'),
      keyId: `sha256:${createHash('sha256').update(otherChild).digest('hex')}`,
    });
    otherChild.fill(0);
    expect(() =>
      withOpenedCbeBirrDepositProofReference(protectedInput(), otherKey, () => ({ ok: true })),
    ).toThrow(CbeBirrReferenceOpeningError);
  });

  it.each([
    (key: CbeBirrScopedReferenceOpeningKey) => ({ ...key, providerCode: 'telebirr' }),
    (key: CbeBirrScopedReferenceOpeningKey) => ({ ...key, purpose: 'receiver-opening' }),
    (key: CbeBirrScopedReferenceOpeningKey) => ({ ...key, contractVersion: 2 }),
    (key: CbeBirrScopedReferenceOpeningKey) => ({ ...key, keyVersion: 1 }),
    (key: CbeBirrScopedReferenceOpeningKey) => ({ ...key, extra: true }),
  ])('rejects altered key metadata %# before invoking the callback', (alter) => {
    const callback = vi.fn(() => ({ ok: true }));
    expect(() =>
      withOpenedCbeBirrDepositProofReference(
        protectedInput(),
        alter(scopedKey()) as CbeBirrScopedReferenceOpeningKey,
        callback,
      ),
    ).toThrow(CbeBirrReferenceOpeningError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects accessor, proxy, asynchronous, and directly returned plaintext escape paths', () => {
    const accessor = {} as CbeBirrProtectedReferenceOpeningInput;
    Object.defineProperty(accessor, 'ciphertext', {
      enumerable: true,
      get: () => protectedInput().ciphertext,
    });
    for (const [key, value] of Object.entries(protectedInput()).slice(1)) {
      Object.defineProperty(accessor, key, { enumerable: true, value });
    }
    expect(() =>
      withOpenedCbeBirrDepositProofReference(accessor, scopedKey(), () => ({ ok: true })),
    ).toThrow(CbeBirrReferenceOpeningError);
    expect(() =>
      withOpenedCbeBirrDepositProofReference(
        new Proxy(protectedInput(), {}) as CbeBirrProtectedReferenceOpeningInput,
        scopedKey(),
        () => ({ ok: true }),
      ),
    ).toThrow(CbeBirrReferenceOpeningError);
    expect(() =>
      withOpenedCbeBirrDepositProofReference(protectedInput(), scopedKey(), async () => true),
    ).toThrow(CbeBirrReferenceOpeningError);
    expect(() =>
      withOpenedCbeBirrDepositProofReference(protectedInput(), scopedKey(), (value) => value),
    ).toThrow(CbeBirrReferenceOpeningError);
  });

  it('does not accept the API master or fingerprint master shape as a scoped runtime key', () => {
    expect(() =>
      withOpenedCbeBirrDepositProofReference(
        protectedInput(),
        {
          encryptionSecret: encryptionMaster,
          fingerprintSecret: fingerprintMaster,
        } as unknown as CbeBirrScopedReferenceOpeningKey,
        () => ({ ok: true }),
      ),
    ).toThrow(CbeBirrReferenceOpeningError);
  });
});
