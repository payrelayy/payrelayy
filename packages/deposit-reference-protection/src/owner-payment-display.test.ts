import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { protectDepositProofReference } from './index.js';
import {
  openOwnerDepositProofReference,
  openReceiverSmsDisplayReference,
  OwnerPaymentDisplayUnavailableError,
  protectReceiverSmsDisplayReference,
} from './owner-payment-display.js';

const proofSecrets = {
  encryptionSecret: '1'.repeat(64),
  fingerprintSecret: '2'.repeat(64),
};
const displaySecret = '3'.repeat(64);

describe('Owner payment identifier opening', () => {
  it.each([
    ['telebirr', 'DJR3D808TP'],
    ['cbe_birr', 'DJR41T3QX7U'],
  ] as const)('opens a protected %s submission reference', (provider, reference) => {
    const protectedReference = protectDepositProofReference({
      provider,
      reference,
      secrets: proofSecrets,
    });
    expect(
      openOwnerDepositProofReference({
        provider,
        ciphertext: protectedReference.ciphertext,
        fingerprint: protectedReference.fingerprint,
        masked: protectedReference.masked,
        secrets: proofSecrets,
      }),
    ).toBe(reference);
    expect(() =>
      openOwnerDepositProofReference({
        provider,
        ciphertext: protectedReference.ciphertext,
        fingerprint: protectedReference.fingerprint,
        masked: protectedReference.masked,
        secrets: {
          ...proofSecrets,
          encryptionSecret: '4'.repeat(64),
        },
      }),
    ).toThrow(OwnerPaymentDisplayUnavailableError);
  });

  it.each([
    ['telebirr', 'DJR3D808TP'],
    ['cbe_birr', 'DJR41T3QX7U'],
  ] as const)('opens a signed %s SMS reference with its event digest', (provider, reference) => {
    const protectedReference = protectReceiverSmsDisplayReference(
      {
        provider,
        reference,
        encryptionSecret: displaySecret,
      },
      () => Buffer.alloc(12, 7),
    );
    const input = {
      provider,
      ...protectedReference,
      referenceDigest: 'sha256:' + createHash('sha256').update(reference).digest('hex'),
      encryptionSecret: displaySecret,
    };
    expect(openReceiverSmsDisplayReference(input)).toBe(reference);
    expect(() =>
      openReceiverSmsDisplayReference({
        ...input,
        referenceDigest: 'sha256:' + '0'.repeat(64),
      }),
    ).toThrow(OwnerPaymentDisplayUnavailableError);
    expect(() =>
      openReceiverSmsDisplayReference({
        ...input,
        encryptionSecret: '4'.repeat(64),
      }),
    ).toThrow(OwnerPaymentDisplayUnavailableError);
  });
});
