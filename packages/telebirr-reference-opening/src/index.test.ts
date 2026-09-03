import { createHash, createHmac } from 'node:crypto';

import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';
import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION,
  TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  TELEBIRR_REFERENCE_OPENING_PROVIDER,
  TELEBIRR_REFERENCE_OPENING_PURPOSE,
  TelebirrReferenceOpeningError,
  withOpenedTelebirrDepositProofReference,
  type TelebirrProtectedReferenceOpeningInput,
  type TelebirrScopedReferenceOpeningKey,
} from './index.js';

const encryptionMaster = 'a'.repeat(64);
const fingerprintMaster = 'b'.repeat(64);

function scopedKey(overrides: Partial<TelebirrScopedReferenceOpeningKey> = {}) {
  const master = Buffer.from(encryptionMaster, 'hex');
  const child = createHmac('sha256', master)
    .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:telebirr', 'utf8')
    .digest();
  master.fill(0);
  const value: TelebirrScopedReferenceOpeningKey = {
    contractVersion: TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
    providerCode: TELEBIRR_REFERENCE_OPENING_PROVIDER,
    purpose: TELEBIRR_REFERENCE_OPENING_PURPOSE,
    keyVersion: TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
    keyId: `sha256:${createHash('sha256').update(child).digest('hex')}`,
    keyHex: child.toString('hex'),
    ...overrides,
  };
  child.fill(0);
  return value;
}

function protectedInput(reference = 'FTAN12345678'): TelebirrProtectedReferenceOpeningInput {
  const protectedReference = protectDepositProofReference(
    {
      provider: 'telebirr',
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
    ciphertextProfileVersion: TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION,
    encryptionKeyVersion: protectedReference.keyVersion,
    providerCode: TELEBIRR_REFERENCE_OPENING_PROVIDER,
  };
}

describe('TeleBirr protected-reference opening boundary', () => {
  it('opens only the provider-scoped v2 envelope inside the synchronous callback', () => {
    const callback = vi.fn((reference: string) => Object.freeze({ digest: reference.slice(-4) }));
    const result = withOpenedTelebirrDepositProofReference(protectedInput(), scopedKey(), callback);

    expect(result).toEqual({ digest: '5678' });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('FTAN12345678');
  });

  it('rejects a wrong scoped key or mismatched key fingerprint without exposing material', () => {
    const wrongKey = scopedKey({ keyHex: 'c'.repeat(64) });
    expect(() =>
      withOpenedTelebirrDepositProofReference(protectedInput(), wrongKey, () => ({ ok: true })),
    ).toThrow(TelebirrReferenceOpeningError);
    try {
      withOpenedTelebirrDepositProofReference(protectedInput(), wrongKey, () => ({ ok: true }));
    } catch (error) {
      expect(String(error)).not.toContain(encryptionMaster);
      expect(String(error)).not.toContain(fingerprintMaster);
      expect(String(error)).not.toContain('FTAN12345678');
    }
  });

  it.each([
    (value: TelebirrProtectedReferenceOpeningInput) => ({ ...value, providerCode: 'cbe_birr' }),
    (value: TelebirrProtectedReferenceOpeningInput) => ({ ...value, ciphertextProfileVersion: 1 }),
    (value: TelebirrProtectedReferenceOpeningInput) => ({ ...value, encryptionKeyVersion: 1 }),
    (value: TelebirrProtectedReferenceOpeningInput) => ({ ...value, extra: true }),
    (value: TelebirrProtectedReferenceOpeningInput) => ({
      ...value,
      ciphertext: `${value.ciphertext.slice(0, -1)}${value.ciphertext.endsWith('A') ? 'B' : 'A'}`,
    }),
  ])('fails closed for altered input %#', (alter) => {
    expect(() =>
      withOpenedTelebirrDepositProofReference(
        alter(protectedInput()) as TelebirrProtectedReferenceOpeningInput,
        scopedKey(),
        () => ({ ok: true }),
      ),
    ).toThrow(TelebirrReferenceOpeningError);
  });

  it('rejects accessor, proxy, asynchronous, and directly returned plaintext escape paths', () => {
    const accessor = {} as TelebirrProtectedReferenceOpeningInput;
    Object.defineProperty(accessor, 'ciphertext', {
      enumerable: true,
      get: () => protectedInput().ciphertext,
    });
    for (const [key, value] of Object.entries(protectedInput()).slice(1)) {
      Object.defineProperty(accessor, key, { enumerable: true, value });
    }
    expect(() =>
      withOpenedTelebirrDepositProofReference(accessor, scopedKey(), () => ({ ok: true })),
    ).toThrow(TelebirrReferenceOpeningError);
    expect(() =>
      withOpenedTelebirrDepositProofReference(
        new Proxy(protectedInput(), {}) as TelebirrProtectedReferenceOpeningInput,
        scopedKey(),
        () => ({ ok: true }),
      ),
    ).toThrow(TelebirrReferenceOpeningError);
    expect(() =>
      withOpenedTelebirrDepositProofReference(protectedInput(), scopedKey(), async () => true),
    ).toThrow(TelebirrReferenceOpeningError);
    expect(() =>
      withOpenedTelebirrDepositProofReference(protectedInput(), scopedKey(), (value) => value),
    ).toThrow(TelebirrReferenceOpeningError);
  });

  it('does not accept the API master or fingerprint master shape as a scoped runtime key', () => {
    expect(() =>
      withOpenedTelebirrDepositProofReference(
        protectedInput(),
        {
          encryptionSecret: encryptionMaster,
          fingerprintSecret: fingerprintMaster,
        } as unknown as TelebirrScopedReferenceOpeningKey,
        () => ({ ok: true }),
      ),
    ).toThrow(TelebirrReferenceOpeningError);
  });
});
