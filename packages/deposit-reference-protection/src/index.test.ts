import { describe, expect, it } from 'vitest';

import { DepositReferenceProtectionError, protectCbeBirrDepositReference } from './index.js';

const secrets = {
  encryptionSecret: 'a'.repeat(64),
  fingerprintSecret: 'b'.repeat(64),
} as const;

describe('CBE Birr deposit-reference protection', () => {
  it('canonicalizes case for the blind index while randomizing ciphertext', () => {
    const first = protectCbeBirrDepositReference('ab.cd-1234', secrets, {
      nonce: () => Buffer.alloc(12, 1),
    });
    const second = protectCbeBirrDepositReference('AB.CD-1234', secrets, {
      nonce: () => Buffer.alloc(12, 2),
    });

    expect(first).toEqual({
      ciphertext: expect.stringMatching(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u),
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      keyVersion: 1,
      masked: '***1234',
    });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.ciphertext).not.toBe(first.ciphertext);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it.each([
    '',
    ' abc1',
    'abc1 ',
    'abc',
    'abcd',
    'a'.repeat(129),
    'reference value',
    'reference\nvalue',
  ])('rejects malformed references without echoing them: %j', (reference) => {
    let thrown: unknown;
    try {
      protectCbeBirrDepositReference(reference, secrets);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DepositReferenceProtectionError);
    if (reference !== '') expect(String(thrown)).not.toContain(reference);
  });

  it.each(['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])(
    'rejects a malformed server secret',
    (candidate) => {
      expect(() =>
        protectCbeBirrDepositReference('ABCD1234', {
          ...secrets,
          encryptionSecret: candidate,
        }),
      ).toThrow(DepositReferenceProtectionError);
      expect(() =>
        protectCbeBirrDepositReference('ABCD1234', {
          ...secrets,
          fingerprintSecret: candidate,
        }),
      ).toThrow(DepositReferenceProtectionError);
    },
  );

  it('rejects a malformed nonce source without leaking the reference', () => {
    expect(() =>
      protectCbeBirrDepositReference('NEVER_ECHO_1234', secrets, {
        nonce: () => Buffer.alloc(11),
      }),
    ).toThrow('The deposit reference could not be protected.');
  });

  it('keeps the blind index stable across encryption rotation but changes it for fingerprint rotation', () => {
    const baseline = protectCbeBirrDepositReference('ABCD1234', secrets, {
      nonce: () => Buffer.alloc(12, 3),
    });
    const newEncryption = protectCbeBirrDepositReference(
      'ABCD1234',
      { ...secrets, encryptionSecret: 'c'.repeat(64) },
      { nonce: () => Buffer.alloc(12, 3) },
    );
    const newFingerprint = protectCbeBirrDepositReference(
      'ABCD1234',
      { ...secrets, fingerprintSecret: 'd'.repeat(64) },
      { nonce: () => Buffer.alloc(12, 3) },
    );

    expect(newEncryption.fingerprint).toBe(baseline.fingerprint);
    expect(newEncryption.ciphertext).not.toBe(baseline.ciphertext);
    expect(newFingerprint.fingerprint).not.toBe(baseline.fingerprint);
  });

  it('rejects reusing one root for encryption and fingerprinting', () => {
    expect(() =>
      protectCbeBirrDepositReference('ABCD1234', {
        encryptionSecret: 'a'.repeat(64),
        fingerprintSecret: 'a'.repeat(64),
      }),
    ).toThrow(DepositReferenceProtectionError);
  });
});
