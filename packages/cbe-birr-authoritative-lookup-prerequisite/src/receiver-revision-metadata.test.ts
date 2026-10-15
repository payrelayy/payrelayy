import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  inspectCbeBirrReceiverRevisionMetadata,
  type CbeBirrReceiverRevisionMetadataResult,
} from './receiver-revision-metadata.js';

const freshMetadata = () => ({
  contractVersion: 1,
  providerCode: 'cbe_birr',
  revision: 1,
  status: 'active',
  protectionProfileVersion: 1,
  encryptionKeyVersion: 1,
  fingerprintKeyVersion: 1,
});

describe('CBE Birr receiver revision metadata-only preflight', () => {
  it('recognizes a v1 metadata shape but grants no lookup or financial authority', () => {
    const result = inspectCbeBirrReceiverRevisionMetadata(freshMetadata());
    expect(result).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'blocked',
      reasonCode: 'v1_metadata_shape_only',
      keyProvenanceAttested: false,
      protectedMaterialAllowed: false,
      decryptionAllowed: false,
      leaseAllowed: false,
      runtimeWiringAllowed: false,
      providerRequestAllowed: false,
      financialClaimAllowed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expectTypeOf<
      CbeBirrReceiverRevisionMetadataResult['financialClaimAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrReceiverRevisionMetadataResult['providerRequestAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrReceiverRevisionMetadataResult['leaseAllowed']>().toEqualTypeOf<false>();
  });

  it('keeps legacy, unsupported, and inactive revisions blocked', () => {
    for (const metadata of [
      { ...freshMetadata(), protectionProfileVersion: null },
      { ...freshMetadata(), encryptionKeyVersion: 2 },
      { ...freshMetadata(), fingerprintKeyVersion: null },
    ]) {
      expect(inspectCbeBirrReceiverRevisionMetadata(metadata)).toMatchObject({
        disposition: 'blocked',
        reasonCode: 'receiver_metadata_missing_or_unsupported',
      });
    }
    expect(
      inspectCbeBirrReceiverRevisionMetadata({ ...freshMetadata(), status: 'inactive' }),
    ).toMatchObject({ disposition: 'blocked', reasonCode: 'receiver_revision_inactive' });
  });

  it('rejects malformed or sensitive extra fields without reflecting them', () => {
    const accessor = freshMetadata();
    Object.defineProperty(accessor, 'revision', { get: () => 1, enumerable: true });
    for (const candidate of [
      null,
      { ...freshMetadata(), revision: 0 },
      { ...freshMetadata(), providerCode: 'telebirr' },
      { ...freshMetadata(), accountReferenceCiphertext: 'SYNTHETIC-SECRET' },
      accessor,
      new Proxy(freshMetadata(), {}),
    ]) {
      const result = inspectCbeBirrReceiverRevisionMetadata(candidate);
      expect(result).toMatchObject({
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        protectedMaterialAllowed: false,
      });
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC-SECRET');
    }
  });
});
