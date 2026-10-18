import { createHash } from 'node:crypto';
import {
  deriveCbeBirrReceiverLookupChildKey,
  protectCbeBirrReceiverLookup,
  withOpenedCbeBirrReceiverLookup,
} from '../../../packages/deposit-reference-protection/dist/cbe-birr-receiver-lookup.js';
import {
  deriveCbeBirrReceiptPhSelectorCandidate,
  isCbeBirrConfiguredReceiverPhoneCandidate,
} from '../../../packages/cbe-birr-normalization-candidate/dist/index.js';
import { describe, expect, it } from 'vitest';

import { compileSensitiveRequestPlan, parseLookupInput } from './shared.js';

// This is a synthetic, unwired review of the exact v2 revision-to-PH format boundary.
const receiverRevisionId = '123e4567-e89b-42d3-a456-426614174000';
const receiverVersion = 4;
const receiverPhone = '251900000001';
const encryptionSecret = 'c'.repeat(64);
const fingerprintSecret = 'd'.repeat(64);
const nonce = () => Buffer.alloc(12, 8);
const fingerprint = (secret: string) =>
  `sha256:${createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex')}`;

function openingMaterial() {
  const key = deriveCbeBirrReceiverLookupChildKey({
    receiverRevisionId,
    receiverVersion,
    encryptionSecret,
  });
  const root = {
    encryptionMasterFingerprint: fingerprint(encryptionSecret),
    fingerprintMasterFingerprint: fingerprint(fingerprintSecret),
    purpose: 'cbe_birr_receiver_lookup' as const,
    version: 2 as const,
  };
  const profile = {
    version: 1 as const,
    providerCode: 'cbe_birr' as const,
    purpose: 'receiver-lookup-opening' as const,
    receiverRevisionId,
    receiverVersion,
    keyId: key.keyId,
    rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
    rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
  };
  return { key, profile, root };
}

function lookupInput(phone: string) {
  return {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
    requestedReference: 'SYNTHETIC123',
    receiverLookupPhone: phone,
  };
}

describe('offline CBE Birr v2 receiver revision-to-PH compatibility', () => {
  it('preserves the exact full phone through revision-bound protection and derives PH only in the request plan', () => {
    const protectedReceiver = protectCbeBirrReceiverLookup(
      {
        receiverRevisionId,
        receiverVersion,
        receiverPhone,
        secrets: { encryptionSecret, fingerprintSecret },
      },
      { nonce },
    );
    const { key, profile, root } = openingMaterial();
    const protectedInput = {
      receiverRevisionId,
      receiverVersion,
      ciphertext: protectedReceiver.ciphertext,
      masked: protectedReceiver.masked,
      protectionProfileVersion: protectedReceiver.protectionProfileVersion,
      encryptionKeyVersion: protectedReceiver.encryptionKeyVersion,
    };
    const pathAndQuery = withOpenedCbeBirrReceiverLookup(
      protectedInput,
      key,
      profile,
      root,
      (phone) => {
        expect(phone).toBe(receiverPhone);
        expect(isCbeBirrConfiguredReceiverPhoneCandidate(phone)).toBe(true);
        expect(deriveCbeBirrReceiptPhSelectorCandidate(phone)).toBe('900000001');
        const parsed = parseLookupInput(lookupInput(phone));
        expect(parsed?.receiverLookupPhone).toBe(receiverPhone);
        return compileSensitiveRequestPlan(parsed!).pathAndQuery;
      },
    );
    expect(pathAndQuery).toBe('/aureceipt?TID=SYNTHETIC123&PH=900000001');

    expect(() =>
      withOpenedCbeBirrReceiverLookup(
        { ...protectedInput, receiverRevisionId: '123e4567-e89b-42d3-a456-426614174001' },
        key,
        profile,
        root,
        (phone) => phone.slice(-4),
      ),
    ).toThrow();
  });

  it.each(['900000001', '25190000001', '251900000001 ', '+251900000001', '251９00000001'])(
    'rejects missing prefix, changed length, whitespace, punctuation, and Unicode: %s',
    (invalid) => {
      expect(isCbeBirrConfiguredReceiverPhoneCandidate(invalid)).toBe(false);
      expect(deriveCbeBirrReceiptPhSelectorCandidate(invalid)).toBeNull();
      expect(parseLookupInput(lookupInput(invalid))).toBeUndefined();
      expect(() =>
        protectCbeBirrReceiverLookup(
          {
            receiverRevisionId,
            receiverVersion,
            receiverPhone: invalid,
            secrets: { encryptionSecret, fingerprintSecret },
          },
          { nonce },
        ),
      ).toThrow();
    },
  );
});
