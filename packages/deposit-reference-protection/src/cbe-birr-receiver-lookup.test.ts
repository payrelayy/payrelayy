import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import * as publicProtection from './index.js';
import { protectReceiverAccountReference } from './index.js';
import {
  CBE_BIRR_RECEIVER_LOOKUP_ENCRYPTION_KEY_VERSION,
  CBE_BIRR_RECEIVER_LOOKUP_FINGERPRINT_KEY_VERSION,
  CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION,
  CbeBirrReceiverLookupProtectionError,
  deriveCbeBirrReceiverLookupChildKey,
  protectCbeBirrReceiverLookup,
  withOpenedCbeBirrReceiverLookup,
} from './cbe-birr-receiver-lookup.js';

const REVISION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_REVISION_ID = '22222222-2222-4222-8222-222222222222';
const PHONE = '251000000123';
const SECRETS = Object.freeze({
  encryptionSecret: 'a'.repeat(64),
  fingerprintSecret: 'b'.repeat(64),
});

function protect(override: Record<string, unknown> = {}, nonce = Buffer.alloc(12, 1)) {
  return protectCbeBirrReceiverLookup(
    {
      receiverRevisionId: REVISION_ID,
      receiverVersion: 1,
      receiverPhone: PHONE,
      secrets: SECRETS,
      ...override,
    },
    { nonce: () => nonce },
  );
}

function fingerprint(secret: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex')}`;
}

function rootProfile() {
  return {
    encryptionMasterFingerprint: fingerprint(SECRETS.encryptionSecret),
    fingerprintMasterFingerprint: fingerprint(SECRETS.fingerprintSecret),
    purpose: 'cbe_birr_receiver_lookup' as const,
    version: 2 as const,
  };
}

function childKey(receiverRevisionId = REVISION_ID, receiverVersion = 1) {
  return deriveCbeBirrReceiverLookupChildKey({
    receiverRevisionId,
    receiverVersion,
    encryptionSecret: SECRETS.encryptionSecret,
  });
}

function openingProfile(key = childKey()) {
  return {
    version: 1 as const,
    providerCode: 'cbe_birr' as const,
    purpose: 'receiver-lookup-opening' as const,
    receiverRevisionId: key.receiverRevisionId,
    receiverVersion: key.receiverVersion,
    keyId: key.keyId,
    rootEncryptionMasterFingerprint: rootProfile().encryptionMasterFingerprint,
    rootFingerprintMasterFingerprint: rootProfile().fingerprintMasterFingerprint,
  };
}

function open(
  override: Record<string, unknown> = {},
  key = childKey(),
  profile = openingProfile(key),
  root = rootProfile(),
  callback: (phone: string) => unknown = (phone) => phone === PHONE,
) {
  const protectedReceiver = protect();
  return withOpenedCbeBirrReceiverLookup(
    {
      receiverRevisionId: REVISION_ID,
      receiverVersion: 1,
      ciphertext: protectedReceiver.ciphertext,
      masked: protectedReceiver.masked,
      protectionProfileVersion: protectedReceiver.protectionProfileVersion,
      encryptionKeyVersion: protectedReceiver.encryptionKeyVersion,
      ...override,
    },
    key,
    profile,
    root,
    callback,
  );
}

describe('offline CBE Birr receiver revision protection candidate', () => {
  it('is absent from the package public entry point', () => {
    expect(publicProtection).not.toHaveProperty('protectCbeBirrReceiverLookup');
    expect(publicProtection).not.toHaveProperty('withOpenedCbeBirrReceiverLookup');
    expect(publicProtection).not.toHaveProperty('deriveCbeBirrReceiverLookupChildKey');
  });

  it('binds one full phone to the exact revision and protects it without returning the digits', () => {
    const protectedReceiver = protect();
    expect(protectedReceiver).toEqual({
      ciphertext: expect.stringMatching(
        /^cbe-receiver-v2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}$/u,
      ),
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      masked: '***0123',
      protectionProfileVersion: CBE_BIRR_RECEIVER_LOOKUP_PROFILE_VERSION,
      encryptionKeyVersion: CBE_BIRR_RECEIVER_LOOKUP_ENCRYPTION_KEY_VERSION,
      fingerprintKeyVersion: CBE_BIRR_RECEIVER_LOOKUP_FINGERPRINT_KEY_VERSION,
    });
    expect(Object.isFrozen(protectedReceiver)).toBe(true);
    expect(JSON.stringify(protectedReceiver)).not.toContain(PHONE);
    expect(open()).toBe(true);
  });

  it('uses independent encryption and fingerprint masters and randomized encryption', () => {
    const first = protect();
    const second = protect({}, Buffer.alloc(12, 2));
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.ciphertext).not.toBe(second.ciphertext);

    const otherRevision = protect({ receiverRevisionId: OTHER_REVISION_ID });
    const otherVersion = protect({ receiverVersion: 2 });
    expect(otherRevision.ciphertext).not.toBe(first.ciphertext);
    expect(otherVersion.ciphertext).not.toBe(first.ciphertext);
    expect(otherRevision.fingerprint).not.toBe(first.fingerprint);
    expect(otherVersion.fingerprint).not.toBe(first.fingerprint);
    expect(() => open({ receiverRevisionId: OTHER_REVISION_ID })).toThrow(
      CbeBirrReceiverLookupProtectionError,
    );
    expect(() => open({ receiverVersion: 2 })).toThrow(CbeBirrReceiverLookupProtectionError);
    expect(() => open({}, childKey(OTHER_REVISION_ID))).toThrow(
      CbeBirrReceiverLookupProtectionError,
    );
    expect(() => open({}, childKey(REVISION_ID, 2))).toThrow(CbeBirrReceiverLookupProtectionError);
    expect(() =>
      open(
        {},
        deriveCbeBirrReceiverLookupChildKey({
          receiverRevisionId: REVISION_ID,
          receiverVersion: 1,
          encryptionSecret: 'c'.repeat(64),
        }),
      ),
    ).toThrow(CbeBirrReceiverLookupProtectionError);
  });

  it.each([
    '',
    '000000123',
    '0910000123',
    '25100000012',
    '2510000001234',
    '+251000000123',
    '251000000123 ',
    '25100000012٣',
  ])('rejects malformed receiver phone %j without echoing it', (receiverPhone) => {
    let thrown: unknown;
    try {
      protect({ receiverPhone });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CbeBirrReceiverLookupProtectionError);
    if (receiverPhone) expect(String(thrown)).not.toContain(receiverPhone);
  });

  it('rejects wrong revision shape, equal masters, and caller-supplied nonces of the wrong size', () => {
    for (const override of [
      { receiverRevisionId: REVISION_ID.toUpperCase() },
      { receiverRevisionId: 'not-a-revision' },
      { receiverVersion: 0 },
      { receiverVersion: 2_147_483_648 },
      { receiverVersion: 1.5 },
      { secrets: { ...SECRETS, fingerprintSecret: SECRETS.encryptionSecret } },
    ]) {
      expect(() => protect(override)).toThrow(CbeBirrReceiverLookupProtectionError);
    }
    expect(() => protect({}, Buffer.alloc(11))).toThrow(CbeBirrReceiverLookupProtectionError);
  });

  it('rejects forged versions, masks, ciphertexts, and noncanonical envelope encodings', () => {
    const protectedReceiver = protect();
    const parts = protectedReceiver.ciphertext.split('.');
    const encrypted = parts[3]!;
    const changedCiphertext = `${parts[0]}.${parts[1]}.${parts[2]}.${encrypted.startsWith('A') ? 'B' : 'A'}${encrypted.slice(1)}`;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const tag = parts[2]!;
    const lastTagDigit = alphabet.indexOf(tag.at(-1)!);
    const alternateDigit = alphabet[(lastTagDigit & ~15) + ((lastTagDigit + 1) & 15)]!;
    const noncanonicalTag = `${tag.slice(0, -1)}${alternateDigit}`;
    expect(Buffer.from(noncanonicalTag, 'base64url')).toEqual(Buffer.from(tag, 'base64url'));
    for (const override of [
      { protectionProfileVersion: 1 },
      { encryptionKeyVersion: 1 },
      { masked: '***9999' },
      { ciphertext: changedCiphertext },
      { ciphertext: `cbe-receiver-v2.${parts[1]}.${noncanonicalTag}.${parts[3]}` },
      { ciphertext: protectedReceiver.ciphertext + '.extra' },
    ]) {
      expect(() => open(override)).toThrow(CbeBirrReceiverLookupProtectionError);
    }
  });

  it('will not silently open the existing v1 Owner ciphertext', () => {
    const existing = protectReceiverAccountReference(
      { provider: 'cbe_birr', reference: PHONE, secrets: SECRETS },
      { nonce: () => Buffer.alloc(12, 3) },
    );
    expect(() => open({ ciphertext: existing.ciphertext })).toThrow(
      CbeBirrReceiverLookupProtectionError,
    );
  });

  it('checks the child-key identity and independently approved root before exposing a phone', () => {
    const key = childKey();
    const callback = (phone: string) => phone === PHONE;
    for (const changedKey of [
      { ...key, keyHex: 'c'.repeat(64) },
      { ...key, keyId: `sha256:${'c'.repeat(64)}` },
      { ...key, receiverVersion: 2 },
      { ...key, purpose: 'deposit-proof-reference-opening' },
      { ...key, encryptionSecret: SECRETS.encryptionSecret },
    ]) {
      expect(() =>
        open({}, changedKey as typeof key, openingProfile(), rootProfile(), callback),
      ).toThrow(CbeBirrReceiverLookupProtectionError);
    }
    for (const changedProfile of [
      { ...openingProfile(), receiverRevisionId: OTHER_REVISION_ID },
      { ...openingProfile(), keyId: `sha256:${'c'.repeat(64)}` },
      { ...openingProfile(), rootEncryptionMasterFingerprint: fingerprint('c'.repeat(64)) },
    ]) {
      expect(() => open({}, key, changedProfile, rootProfile(), callback)).toThrow(
        CbeBirrReceiverLookupProtectionError,
      );
    }
    expect(() =>
      open(
        {},
        key,
        openingProfile(),
        {
          ...rootProfile(),
          encryptionMasterFingerprint: fingerprint('c'.repeat(64)),
        },
        callback,
      ),
    ).toThrow(CbeBirrReceiverLookupProtectionError);
  });

  it('authenticates the ciphertext against a different valid revision before invoking the callback', () => {
    const callback = vi.fn(() => true);
    const otherKey = childKey(OTHER_REVISION_ID);
    expect(() =>
      open(
        { receiverRevisionId: OTHER_REVISION_ID },
        otherKey,
        openingProfile(otherKey),
        rootProfile(),
        callback,
      ),
    ).toThrow(CbeBirrReceiverLookupProtectionError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('permits only a synchronous callback that does not return the raw phone', () => {
    expect(open({}, childKey(), openingProfile(), rootProfile(), (phone) => phone.slice(-4))).toBe(
      '0123',
    );
    for (const callback of [
      (phone: string) => phone,
      async (phone: string) => phone.slice(-4),
      () => ({ then: () => undefined }),
    ]) {
      expect(() => open({}, childKey(), openingProfile(), rootProfile(), callback)).toThrow(
        CbeBirrReceiverLookupProtectionError,
      );
    }
  });

  it('does not reflect plaintext, ciphertext, or malformed input in errors', () => {
    const ciphertext = protect().ciphertext;
    let thrown: unknown;
    try {
      open({ ciphertext: ciphertext.slice(0, -1) + '!' });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toBe(
      'CbeBirrReceiverLookupProtectionError: CBE Birr receiver lookup material is unavailable.',
    );
    expect(String(thrown)).not.toContain(PHONE);
    expect(String(thrown)).not.toContain(ciphertext);
  });

  it('rejects accessors, proxies, and extra fields before reading sensitive values', () => {
    let reads = 0;
    const accessorInput = {
      receiverRevisionId: REVISION_ID,
      receiverVersion: 1,
      get receiverPhone() {
        reads += 1;
        return PHONE;
      },
      secrets: SECRETS,
    };
    expect(() => protectCbeBirrReceiverLookup(accessorInput)).toThrow(
      CbeBirrReceiverLookupProtectionError,
    );
    expect(reads).toBe(0);
    expect(() => protect({ extra: 'unexpected' })).toThrow(CbeBirrReceiverLookupProtectionError);
    expect(() => protectCbeBirrReceiverLookup(new Proxy(accessorInput, {}))).toThrow(
      CbeBirrReceiverLookupProtectionError,
    );
    expect(() => open({ extra: 'unexpected' })).toThrow(CbeBirrReceiverLookupProtectionError);
    expect(() =>
      deriveCbeBirrReceiverLookupChildKey(
        new Proxy(
          {
            receiverRevisionId: REVISION_ID,
            receiverVersion: 1,
            encryptionSecret: SECRETS.encryptionSecret,
          },
          {},
        ),
      ),
    ).toThrow(CbeBirrReceiverLookupProtectionError);
  });
});
