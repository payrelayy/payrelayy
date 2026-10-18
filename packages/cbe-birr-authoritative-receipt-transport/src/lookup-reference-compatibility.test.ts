import {
  protectCbeBirrDepositReference,
  protectDepositProofReference,
} from '../../../packages/deposit-reference-protection/dist/index.js';
import { openCbeBirrDepositProofReference } from '../../../packages/deposit-reference-protection/dist/cbe-birr-proof-open.js';
import {
  isCanonicalCbeBirrReferenceCandidate,
  normalizeCbeBirrSubmittedReferenceCandidate,
} from '../../../packages/cbe-birr-normalization-candidate/dist/index.js';
import { describe, expect, it } from 'vitest';

import { compileSensitiveRequestPlan, parseLookupInput } from './shared.js';

// Built local artifacts keep this cross-package review out of all application/runtime imports.
const secrets = Object.freeze({
  encryptionSecret: 'a'.repeat(64),
  fingerprintSecret: 'b'.repeat(64),
});
const nonce = () => Buffer.alloc(12, 7);
const receiverLookupPhone = '251900000001';

function protectCbeProof(reference: string) {
  return protectDepositProofReference({ provider: 'cbe_birr', reference, secrets }, { nonce });
}

function lookupInput(requestedReference: string) {
  return {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
    requestedReference,
    receiverLookupPhone,
  };
}

describe('offline CBE Birr proof-to-TID reference compatibility', () => {
  it.each(['abcdefgh', 'SyNtHeTiC123', 'Z'.repeat(32)])(
    'uses one exact canonical value from v2 proof capture through the local TID plan: %s',
    (submitted) => {
      const canonical = normalizeCbeBirrSubmittedReferenceCandidate(submitted);
      expect(canonical).not.toBeNull();
      expect(isCanonicalCbeBirrReferenceCandidate(canonical)).toBe(true);

      // Fixed synthetic nonce/keys make the protected outputs comparable. The internal open
      // candidate then proves the exact canonical bytes handed to the unwired TID validator.
      expect(protectCbeProof(submitted)).toEqual(protectCbeProof(canonical!));
      const protectedProof = protectCbeProof(submitted);
      const opened = openCbeBirrDepositProofReference({
        provider: 'cbe_birr',
        ciphertext: protectedProof.ciphertext,
        masked: protectedProof.masked,
        referenceProfileVersion: 2,
        encryptionKeyVersion: protectedProof.keyVersion,
        encryptionSecret: secrets.encryptionSecret,
      });
      expect(opened).toBe(canonical);
      const parsed = parseLookupInput(lookupInput(opened));
      expect(parsed?.requestedReference).toBe(canonical);
      expect(compileSensitiveRequestPlan(parsed!).pathAndQuery).toBe(
        `/aureceipt?TID=${canonical}&PH=900000001`,
      );
    },
  );

  it('requires canonical input at the lookup boundary and never upgrades the legacy format', () => {
    expect(parseLookupInput(lookupInput('synthetic123'))).toBeUndefined();
    expect(protectCbeBirrDepositReference('SYNTH-1234', secrets, { nonce })).toMatchObject({
      keyVersion: 1,
    });

    for (const invalid of [
      'a'.repeat(7),
      'a'.repeat(33),
      ' SYNTHETIC123',
      'SYNTHETIC123 ',
      'SYNTH-1234',
      'SYNTH_1234',
      'SYNTH.1234',
      'SYNTHETİC123',
      'ＳＹＮＴＨ１２３',
    ]) {
      expect(normalizeCbeBirrSubmittedReferenceCandidate(invalid)).toBeNull();
      expect(() => protectCbeProof(invalid)).toThrow();
      expect(parseLookupInput(lookupInput(invalid))).toBeUndefined();
    }
    expect(
      parseLookupInput({ ...lookupInput('SYNTHETIC123'), providerCode: 'telebirr' }),
    ).toBeUndefined();
  });
});
