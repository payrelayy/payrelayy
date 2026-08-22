import { createDecipheriv, createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import * as depositReferenceProtection from './index.js';
import {
  DEPOSIT_PROOF_REFERENCE_KEY_VERSION,
  DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION,
  DepositReferenceProtectionError,
  RECEIVER_ACCOUNT_REFERENCE_KEY_VERSION,
  RECEIVER_ACCOUNT_REFERENCE_PROFILE_VERSION,
  protectCbeBirrDepositReference,
  protectDepositProofReference,
  protectReceiverAccountReference,
  type DepositProofReferenceProvider,
} from './index.js';

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
      ciphertext: 'v1.AQEBAQEBAQEBAQEB.CUbmOb728XDU1ZObeKaGYg.8jr6SjTyk7lbmQ',
      fingerprint: '8d5c6bc04ba9932d10d398e60d3b57af4276fe64faff018ea9fa6526b0afcff2',
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

function decryptProviderCiphertextForTest(
  ciphertext: string,
  providerForKey: DepositProofReferenceProvider,
  providerForAad: DepositProofReferenceProvider,
): string {
  const [version, storedProvider, nonceValue, tagValue, encryptedValue] = ciphertext.split('.');
  expect(version).toBe('v2');
  expect(storedProvider).toMatch(/^(?:cbe_birr|telebirr)$/u);
  expect(nonceValue).toBeDefined();
  expect(tagValue).toBeDefined();
  expect(encryptedValue).toBeDefined();

  const encryptionMaster = Buffer.from(secrets.encryptionSecret, 'hex');
  const encryptionKey = createHmac('sha256', encryptionMaster)
    .update(
      `fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:${providerForKey}`,
      'utf8',
    )
    .digest();
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey,
      Buffer.from(nonceValue!, 'base64url'),
    );
    decipher.setAAD(
      Buffer.from(
        `fetanagent:deposit-proof-reference:encryption-aad:v2\nprovider:${providerForAad}`,
        'utf8',
      ),
    );
    decipher.setAuthTag(Buffer.from(tagValue!, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue!, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } finally {
    encryptionMaster.fill(0);
    encryptionKey.fill(0);
  }
}

describe('provider-aware deposit proof-reference protection', () => {
  it('separates providers across metadata, keys, authenticated data, and fingerprints', () => {
    const reference = 'SYNTHREF4821';
    const nonce = () => Buffer.alloc(12, 7);
    const cbeBirr = protectDepositProofReference(
      { provider: 'cbe_birr', reference, secrets },
      { nonce },
    );
    const telebirr = protectDepositProofReference(
      { provider: 'telebirr', reference, secrets },
      { nonce },
    );

    expect(cbeBirr).toEqual({
      ciphertext: expect.stringMatching(
        /^v2\.cbe_birr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
      ),
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      keyVersion: 2,
      masked: '***4821',
      provider: 'cbe_birr',
    });
    expect(telebirr.ciphertext).toMatch(
      /^v2\.telebirr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(telebirr.fingerprint).not.toBe(cbeBirr.fingerprint);
    expect(telebirr.ciphertext).not.toBe(cbeBirr.ciphertext);
    expect(decryptProviderCiphertextForTest(cbeBirr.ciphertext, 'cbe_birr', 'cbe_birr')).toBe(
      reference,
    );
    expect(() =>
      decryptProviderCiphertextForTest(cbeBirr.ciphertext, 'cbe_birr', 'telebirr'),
    ).toThrow();
  });

  it('keeps one provider fingerprint stable after canonicalization and randomizes ciphertext', () => {
    const first = protectDepositProofReference({
      provider: 'telebirr',
      reference: 'syntheticref5902',
      secrets,
    });
    const second = protectDepositProofReference({
      provider: 'telebirr',
      reference: 'SYNTHETICREF5902',
      secrets,
    });

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it('keeps fingerprints through encryption rotation and changes them through fingerprint rotation', () => {
    const input = {
      provider: 'cbe_birr',
      reference: 'ROTATIONREF7316',
      secrets,
    } as const;
    const dependencies = { nonce: () => Buffer.alloc(12, 8) };
    const baseline = protectDepositProofReference(input, dependencies);
    const newEncryption = protectDepositProofReference(
      { ...input, secrets: { ...secrets, encryptionSecret: 'c'.repeat(64) } },
      dependencies,
    );
    const newFingerprint = protectDepositProofReference(
      { ...input, secrets: { ...secrets, fingerprintSecret: 'd'.repeat(64) } },
      dependencies,
    );

    expect(newEncryption.fingerprint).toBe(baseline.fingerprint);
    expect(newEncryption.ciphertext).not.toBe(baseline.ciphertext);
    expect(newFingerprint.fingerprint).not.toBe(baseline.fingerprint);
  });

  it('returns a frozen, storage-safe projection with only a masked suffix', () => {
    const reference = 'PRIVATESYNTHETIC6148';
    const protectedReference = protectDepositProofReference(
      { provider: 'cbe_birr', reference, secrets },
      { nonce: () => Buffer.alloc(12, 9) },
    );

    expect(Object.isFrozen(protectedReference)).toBe(true);
    expect(Object.keys(protectedReference).sort()).toEqual([
      'ciphertext',
      'fingerprint',
      'keyVersion',
      'masked',
      'provider',
    ]);
    expect(protectedReference.masked).toBe('***6148');
    expect(JSON.stringify(protectedReference)).not.toContain(reference);
    expect(JSON.stringify(protectedReference)).not.toContain('PRIVATESYNTHETIC');
  });

  it('keeps key and input-profile versions as independent exported contracts', () => {
    expect(DEPOSIT_PROOF_REFERENCE_KEY_VERSION).toBe(2);
    expect(DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION).toBe(2);
    expect(Object.hasOwn(depositReferenceProtection, 'DEPOSIT_PROOF_REFERENCE_KEY_VERSION')).toBe(
      true,
    );
    expect(
      Object.hasOwn(depositReferenceProtection, 'DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION'),
    ).toBe(true);
  });

  it.each(['ABCDEFGH', 'A'.repeat(32), 'synth9000qf'])(
    'accepts an exact ASCII-alphanumeric direct proof ID at the supported boundaries: %j',
    (reference) => {
      expect(
        protectDepositProofReference({ provider: 'telebirr', reference, secrets }),
      ).toMatchObject({ keyVersion: 2, provider: 'telebirr' });
    },
  );

  it.each([
    { provider: 'CBE_BIRR', reference: 'VALIDREF1234', secrets },
    { provider: 'unknown', reference: 'VALIDREF1234', secrets },
    { provider: 'cbe_birr', reference: '', secrets },
    { provider: 'cbe_birr', reference: ' ABCD1234', secrets },
    { provider: 'cbe_birr', reference: 'ABCD1234 ', secrets },
    { provider: 'cbe_birr', reference: 'abcd', secrets },
    { provider: 'cbe_birr', reference: 'A'.repeat(7), secrets },
    { provider: 'cbe_birr', reference: 'a'.repeat(33), secrets },
    { provider: 'cbe_birr', reference: 'INVALID VALUE', secrets },
    { provider: 'cbe_birr', reference: 'INVALID-REF', secrets },
    { provider: 'cbe_birr', reference: 'INVALID_REF', secrets },
    { provider: 'cbe_birr', reference: 'INVALID.REF', secrets },
    { provider: 'cbe_birr', reference: 'SYNTH9000QF\n', secrets },
    { provider: 'cbe_birr', reference: 'DHK9130EQÉ', secrets },
  ])('rejects an invalid provider or canonical reference', (input) => {
    expect(() =>
      protectDepositProofReference(input as Parameters<typeof protectDepositProofReference>[0]),
    ).toThrow(DepositReferenceProtectionError);
  });

  it('requires distinct, exact, lower-case hexadecimal server secrets', () => {
    expect(() =>
      protectDepositProofReference({
        provider: 'cbe_birr',
        reference: 'VALIDREF1234',
        secrets: { encryptionSecret: 'a'.repeat(64), fingerprintSecret: 'a'.repeat(64) },
      }),
    ).toThrow(DepositReferenceProtectionError);
    expect(() =>
      protectDepositProofReference({
        provider: 'cbe_birr',
        reference: 'VALIDREF1234',
        secrets: { encryptionSecret: 'A'.repeat(64), fingerprintSecret: 'b'.repeat(64) },
      }),
    ).toThrow(DepositReferenceProtectionError);
    expect(() =>
      protectDepositProofReference({
        provider: 'cbe_birr',
        reference: 'VALIDREF1234',
        secrets: { ...secrets, extra: 'forbidden' } as typeof secrets,
      }),
    ).toThrow(DepositReferenceProtectionError);
  });

  it('rejects extra and symbol input fields', () => {
    expect(() =>
      protectDepositProofReference({
        provider: 'cbe_birr',
        reference: 'VALIDREF1234',
        secrets,
        extra: true,
      } as Parameters<typeof protectDepositProofReference>[0]),
    ).toThrow(DepositReferenceProtectionError);

    const input = { provider: 'cbe_birr', reference: 'VALIDREF1234', secrets };
    Object.defineProperty(input, Symbol('forbidden'), { value: true });
    expect(() =>
      protectDepositProofReference(input as Parameters<typeof protectDepositProofReference>[0]),
    ).toThrow(DepositReferenceProtectionError);
  });

  it('rejects non-enumerable expected properties on exact input objects', () => {
    const input = { provider: 'cbe_birr', reference: 'VALIDREF1234', secrets };
    Object.defineProperty(input, 'reference', {
      configurable: true,
      enumerable: false,
      value: 'VALIDREF1234',
      writable: true,
    });
    expect(() =>
      protectDepositProofReference(input as Parameters<typeof protectDepositProofReference>[0]),
    ).toThrow(DepositReferenceProtectionError);

    const nonEnumerableSecrets = { ...secrets };
    Object.defineProperty(nonEnumerableSecrets, 'fingerprintSecret', {
      configurable: true,
      enumerable: false,
      value: secrets.fingerprintSecret,
      writable: true,
    });
    expect(() =>
      protectDepositProofReference({
        provider: 'telebirr',
        reference: 'VALIDREF1234',
        secrets: nonEnumerableSecrets,
      }),
    ).toThrow(DepositReferenceProtectionError);
  });

  it('rejects accessor and proxy input shapes without invoking hostile code', () => {
    let accessorInvoked = false;
    const accessorInput = {
      provider: 'cbe_birr',
      reference: 'VALIDREF1234',
      get secrets() {
        accessorInvoked = true;
        throw new Error('HOSTILE_ACCESSOR_DETAIL');
      },
    };
    expect(() =>
      protectDepositProofReference(
        accessorInput as unknown as Parameters<typeof protectDepositProofReference>[0],
      ),
    ).toThrow('The deposit reference could not be protected.');
    expect(accessorInvoked).toBe(false);

    let proxyTrapInvoked = false;
    const proxyInput = new Proxy(
      { provider: 'cbe_birr', reference: 'VALIDREF1234', secrets },
      {
        ownKeys() {
          proxyTrapInvoked = true;
          throw new Error('HOSTILE_PROXY_DETAIL');
        },
        get() {
          proxyTrapInvoked = true;
          throw new Error('HOSTILE_PROXY_DETAIL');
        },
      },
    );
    expect(() =>
      protectDepositProofReference(
        proxyInput as Parameters<typeof protectDepositProofReference>[0],
      ),
    ).toThrow('The deposit reference could not be protected.');
    expect(proxyTrapInvoked).toBe(false);
  });

  it('rejects missing, non-plain, and hostile nested secret shapes', () => {
    expect(() =>
      protectDepositProofReference({
        provider: 'cbe_birr',
        reference: 'VALIDREF1234',
      } as Parameters<typeof protectDepositProofReference>[0]),
    ).toThrow(DepositReferenceProtectionError);

    const nonPlainInput = Object.assign(Object.create({ inherited: true }) as object, {
      provider: 'cbe_birr',
      reference: 'VALIDREF1234',
      secrets,
    });
    expect(() =>
      protectDepositProofReference(
        nonPlainInput as Parameters<typeof protectDepositProofReference>[0],
      ),
    ).toThrow(DepositReferenceProtectionError);

    let accessorInvoked = false;
    const accessorSecrets = {
      get encryptionSecret() {
        accessorInvoked = true;
        throw new Error('HOSTILE_NESTED_ACCESSOR_DETAIL');
      },
      fingerprintSecret: secrets.fingerprintSecret,
    };
    expect(() =>
      protectDepositProofReference({
        provider: 'cbe_birr',
        reference: 'VALIDREF1234',
        secrets: accessorSecrets,
      } as unknown as Parameters<typeof protectDepositProofReference>[0]),
    ).toThrow('The deposit reference could not be protected.');
    expect(accessorInvoked).toBe(false);

    let proxyTrapInvoked = false;
    const proxySecrets = new Proxy(secrets, {
      ownKeys() {
        proxyTrapInvoked = true;
        throw new Error('HOSTILE_NESTED_PROXY_DETAIL');
      },
      get() {
        proxyTrapInvoked = true;
        throw new Error('HOSTILE_NESTED_PROXY_DETAIL');
      },
    });
    expect(() =>
      protectDepositProofReference({
        provider: 'telebirr',
        reference: 'VALIDREF1234',
        secrets: proxySecrets,
      }),
    ).toThrow('The deposit reference could not be protected.');
    expect(proxyTrapInvoked).toBe(false);
  });

  it.each([
    () => Buffer.alloc(11),
    () => Buffer.alloc(13),
    () => new Uint8Array(12) as unknown as Buffer,
  ])('rejects malformed nonce results', (nonce) => {
    expect(() =>
      protectDepositProofReference(
        { provider: 'telebirr', reference: 'NONCEREF1583', secrets },
        { nonce },
      ),
    ).toThrow(DepositReferenceProtectionError);
  });

  it('rejects ambiguous dependency shapes and redacts nonce-source failures', () => {
    const reference = 'NEVERECHOREFERENCE2490';
    expect(() =>
      protectDepositProofReference({ provider: 'telebirr', reference, secrets }, {
        nonce: () => Buffer.alloc(12),
        extra: true,
      } as never),
    ).toThrow(DepositReferenceProtectionError);

    let thrown: unknown;
    try {
      protectDepositProofReference(
        { provider: 'telebirr', reference, secrets },
        {
          nonce: () => {
            throw new Error(`HOSTILE_NONCE_DETAIL:${reference}:${secrets.encryptionSecret}`);
          },
        },
      );
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toBe(
      'DepositReferenceProtectionError: The deposit reference could not be protected.',
    );
    expect(String(thrown)).not.toContain(reference);
    expect(String(thrown)).not.toContain(secrets.encryptionSecret);
    expect(String(thrown)).not.toContain('HOSTILE_NONCE_DETAIL');
  });

  it('rejects accessor and proxy dependency shapes without invoking hostile code', () => {
    let accessorInvoked = false;
    const accessorDependencies = {
      get nonce() {
        accessorInvoked = true;
        throw new Error('HOSTILE_DEPENDENCY_ACCESSOR_DETAIL');
      },
    };
    expect(() =>
      protectDepositProofReference(
        { provider: 'cbe_birr', reference: 'DEPENDENCYREF3861', secrets },
        accessorDependencies as unknown as Parameters<typeof protectDepositProofReference>[1],
      ),
    ).toThrow('The deposit reference could not be protected.');
    expect(accessorInvoked).toBe(false);

    let proxyTrapInvoked = false;
    const proxyDependencies = new Proxy(
      { nonce: () => Buffer.alloc(12) },
      {
        ownKeys() {
          proxyTrapInvoked = true;
          throw new Error('HOSTILE_DEPENDENCY_PROXY_DETAIL');
        },
        get() {
          proxyTrapInvoked = true;
          throw new Error('HOSTILE_DEPENDENCY_PROXY_DETAIL');
        },
      },
    );
    expect(() =>
      protectDepositProofReference(
        { provider: 'cbe_birr', reference: 'DEPENDENCYREF3861', secrets },
        proxyDependencies,
      ),
    ).toThrow('The deposit reference could not be protected.');
    expect(proxyTrapInvoked).toBe(false);
  });

  it('exports no reference decryption or logging API', () => {
    expect(Object.isFrozen(depositReferenceProtection.DEPOSIT_PROOF_REFERENCE_PROVIDERS)).toBe(
      true,
    );
    expect(
      Object.keys(depositReferenceProtection).filter((name) => /decrypt|log/iu.test(name)),
    ).toEqual([]);
  });
});

describe('Owner receiver-account reference protection', () => {
  it('binds the provider and returns only an encrypted envelope, fingerprint, and mask', () => {
    const cbe = protectReceiverAccountReference(
      { provider: 'cbe_birr', reference: '0000000006789', secrets },
      { nonce: () => Buffer.alloc(12, 10) },
    );
    const telebirr = protectReceiverAccountReference(
      { provider: 'telebirr', reference: '0000003456', secrets },
      { nonce: () => Buffer.alloc(12, 10) },
    );

    expect(cbe).toEqual({
      ciphertext: expect.stringMatching(
        /^receiver-v1\.cbe_birr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
      ),
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      keyVersion: 1,
      masked: '***6789',
      profileVersion: 1,
      provider: 'cbe_birr',
    });
    expect(telebirr.masked).toBe('***3456');
    expect(telebirr.fingerprint).not.toBe(cbe.fingerprint);
    const envelopeSegments = telebirr.ciphertext.split('.');
    expect(envelopeSegments.map((segment) => segment.length)).toEqual([11, 8, 16, 22, 14]);
    expect(JSON.stringify(cbe)).not.toContain('0000000006789');
    expect(Object.isFrozen(cbe)).toBe(true);

    const sameDigitsUnderCbe = protectReceiverAccountReference(
      { provider: 'cbe_birr', reference: '0000003456', secrets },
      { nonce: () => Buffer.alloc(12, 10) },
    );
    expect(sameDigitsUnderCbe.fingerprint).not.toBe(telebirr.fingerprint);
    expect(sameDigitsUnderCbe.ciphertext).not.toBe(telebirr.ciphertext);
  });

  it('is stable for one provider across randomized encryption', () => {
    const first = protectReceiverAccountReference(
      { provider: 'telebirr', reference: '0000003456', secrets },
      { nonce: () => Buffer.alloc(12, 11) },
    );
    const second = protectReceiverAccountReference(
      { provider: 'telebirr', reference: '0000003456', secrets },
      { nonce: () => Buffer.alloc(12, 12) },
    );
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it.each([
    '',
    '00000034',
    '1'.repeat(25),
    '+0000003456',
    '0000 003 456',
    '0000-003-456',
    '0000003456\n',
  ])('rejects a non-canonical receiver account without echoing it: %j', (reference) => {
    let thrown: unknown;
    try {
      protectReceiverAccountReference({ provider: 'telebirr', reference, secrets });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DepositReferenceProtectionError);
    if (reference !== '') expect(String(thrown)).not.toContain(reference);
  });

  it('exports independent receiver profile and key versions', () => {
    expect(RECEIVER_ACCOUNT_REFERENCE_KEY_VERSION).toBe(1);
    expect(RECEIVER_ACCOUNT_REFERENCE_PROFILE_VERSION).toBe(1);
  });
});
