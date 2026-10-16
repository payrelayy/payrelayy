import { describe, expect, it } from 'vitest';

import * as publicProtection from './index.js';
import {
  CbeBirrReceiverLookupProtectionError,
  openCbeBirrReceiverLookup,
} from './cbe-birr-receiver-lookup.js';
import { prepareCbeBirrReceiverRotation } from './cbe-birr-receiver-rotation.js';

const receiverRevisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const receiverPhone = '251000000123';
const referenceSecrets = Object.freeze({
  encryptionSecret: 'a'.repeat(64),
  fingerprintSecret: 'b'.repeat(64),
});
const lookupSecrets = Object.freeze({
  encryptionSecret: 'c'.repeat(64),
  fingerprintSecret: 'd'.repeat(64),
});

function prepare(override: Record<string, unknown> = {}) {
  return prepareCbeBirrReceiverRotation({
    receiverRevisionId,
    receiverVersion: 3,
    receiverPhone,
    referenceSecrets,
    lookupSecrets,
    ...override,
  });
}

describe('offline CBE Birr Owner rotation preparation', () => {
  it('keeps this candidate absent from the application package entry point', () => {
    expect(publicProtection).not.toHaveProperty('prepareCbeBirrReceiverRotation');
  });

  it('prepares matching v1 display and revision-bound v2 lookup envelopes without plaintext', () => {
    const prepared = prepare();
    expect(prepared.reference).toMatchObject({
      provider: 'cbe_birr',
      masked: '***0123',
      profileVersion: 1,
      keyVersion: 1,
    });
    expect(prepared.lookup).toMatchObject({
      masked: '***0123',
      protectionProfileVersion: 2,
      encryptionKeyVersion: 2,
      fingerprintKeyVersion: 2,
    });
    expect(prepared.reference.ciphertext).toMatch(/^receiver-v1\.cbe_birr\./u);
    expect(prepared.lookup.ciphertext).toMatch(/^cbe-receiver-v2\./u);
    expect(prepared.reference.fingerprint).not.toBe(prepared.lookup.fingerprint);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(JSON.stringify(prepared)).not.toContain(receiverPhone);
    expect(
      openCbeBirrReceiverLookup({
        receiverRevisionId,
        receiverVersion: 3,
        ciphertext: prepared.lookup.ciphertext,
        masked: prepared.lookup.masked,
        protectionProfileVersion: 2,
        encryptionKeyVersion: 2,
        encryptionSecret: lookupSecrets.encryptionSecret,
      }),
    ).toBe(receiverPhone);
  });

  it('rejects reused masters even across the two protection domains', () => {
    for (const override of [
      { lookupSecrets: { ...lookupSecrets, encryptionSecret: referenceSecrets.encryptionSecret } },
      {
        lookupSecrets: { ...lookupSecrets, fingerprintSecret: referenceSecrets.fingerprintSecret },
      },
      { lookupSecrets: { ...lookupSecrets, encryptionSecret: referenceSecrets.fingerprintSecret } },
      {
        referenceSecrets: {
          ...referenceSecrets,
          fingerprintSecret: lookupSecrets.encryptionSecret,
        },
      },
    ]) {
      expect(() => prepare(override)).toThrow(CbeBirrReceiverLookupProtectionError);
    }
  });

  it('rejects invalid identity, phone, extra fields, and accessor or proxy inputs', () => {
    for (const override of [
      { receiverRevisionId: 'not-a-uuid' },
      { receiverVersion: 0 },
      { receiverPhone: '000000123' },
      { receiverPhone: '+251000000123' },
      { extra: true },
    ]) {
      expect(() => prepare(override)).toThrow(CbeBirrReceiverLookupProtectionError);
    }
    let reads = 0;
    const accessor = {
      receiverRevisionId,
      receiverVersion: 3,
      get receiverPhone() {
        reads += 1;
        return receiverPhone;
      },
      referenceSecrets,
      lookupSecrets,
    };
    expect(() => prepareCbeBirrReceiverRotation(accessor)).toThrow(
      CbeBirrReceiverLookupProtectionError,
    );
    expect(reads).toBe(0);
    expect(() => prepareCbeBirrReceiverRotation(new Proxy(accessor, {}))).toThrow(
      CbeBirrReceiverLookupProtectionError,
    );
    expect(() => prepare({ lookupSecrets: { ...lookupSecrets, unexpected: 'value' } })).toThrow(
      CbeBirrReceiverLookupProtectionError,
    );
  });

  it('uses a fixed error without echoing a receiver phone or key', () => {
    let thrown: unknown;
    try {
      prepare({ receiverPhone: `${receiverPhone}9` });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toBe(
      'CbeBirrReceiverLookupProtectionError: CBE Birr receiver lookup material is unavailable.',
    );
    expect(String(thrown)).not.toContain(receiverPhone);
    expect(String(thrown)).not.toContain(referenceSecrets.encryptionSecret);
  });
});
