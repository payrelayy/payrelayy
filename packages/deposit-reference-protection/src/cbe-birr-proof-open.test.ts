import { describe, expect, it } from 'vitest';

import { openCbeBirrDepositProofReference } from './cbe-birr-proof-open.js';
import { protectDepositProofReference } from './index.js';

const encryptionSecret = 'a'.repeat(64);
const fingerprintSecret = 'b'.repeat(64);
const reference = 'SYNTHETIC123';
const protectedProof = protectDepositProofReference(
  {
    provider: 'cbe_birr',
    reference: 'synthetic123',
    secrets: { encryptionSecret, fingerprintSecret },
  },
  { nonce: () => Buffer.alloc(12, 7) },
);

const validInput = () => ({
  provider: 'cbe_birr' as const,
  ciphertext: protectedProof.ciphertext,
  masked: protectedProof.masked,
  referenceProfileVersion: 2 as const,
  encryptionKeyVersion: 2 as const,
  encryptionSecret,
});

describe('internal CBE Birr provider-aware proof open candidate', () => {
  it('recovers only the authenticated canonical reference using the encryption master', () => {
    expect(openCbeBirrDepositProofReference(validInput())).toBe(reference);
    expect(protectedProof.masked).toBe('***C123');
  });

  it('rejects provider confusion, a wrong key, a changed tag, ciphertext, mask, and version', () => {
    const envelope = protectedProof.ciphertext.split('.');
    const cases = [
      { ...validInput(), provider: 'telebirr' },
      { ...validInput(), encryptionSecret: 'c'.repeat(64) },
      {
        ...validInput(),
        ciphertext: protectedProof.ciphertext.replace('v2.cbe_birr', 'v2.telebirr'),
      },
      {
        ...validInput(),
        ciphertext: [envelope[0], envelope[1], envelope[2], 'A'.repeat(22), envelope[4]].join('.'),
      },
      { ...validInput(), ciphertext: `${protectedProof.ciphertext.slice(0, -1)}A` },
      { ...validInput(), masked: '***D123' },
      { ...validInput(), referenceProfileVersion: 1 },
      { ...validInput(), encryptionKeyVersion: 1 },
    ];
    for (const candidate of cases) {
      expect(() => openCbeBirrDepositProofReference(candidate as never)).toThrow(
        'CBE Birr deposit proof reference is unavailable.',
      );
    }
  });

  it('rejects accessors, proxies, extra fields, and legacy or noncanonical input without echoing them', () => {
    const accessor = { ...validInput() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'ciphertext', {
      get: () => {
        throw new Error('sensitive');
      },
    });
    const cases: unknown[] = [
      accessor,
      new Proxy(validInput(), {}),
      { ...validInput(), extra: reference },
      { ...validInput(), ciphertext: 'v1.cbe_birr.other' },
      { ...validInput(), ciphertext: ` ${protectedProof.ciphertext}` },
      { ...validInput(), encryptionSecret: fingerprintSecret.toUpperCase() },
    ];
    for (const candidate of cases) {
      try {
        openCbeBirrDepositProofReference(candidate as never);
        throw new Error('unexpected success');
      } catch (error) {
        expect(error).toMatchObject({
          name: 'CbeBirrDepositProofOpenError',
          message: 'CBE Birr deposit proof reference is unavailable.',
        });
        expect(String(error)).not.toContain(reference);
        expect(String(error)).not.toContain(protectedProof.ciphertext);
      }
    }
  });
});
