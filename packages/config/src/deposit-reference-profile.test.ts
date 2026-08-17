import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE,
  loadAndVerifyCbeDepositReferenceKeyProfile,
} from './deposit-reference-profile.js';

const encryptionSecret = 'a'.repeat(64);
const fingerprintSecret = 'b'.repeat(64);

function fingerprint(secret: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex')}`;
}

function profile(encryption = encryptionSecret, blindIndex = fingerprintSecret): string {
  return JSON.stringify({
    encryptionKeyFingerprint: fingerprint(encryption),
    fingerprintKeyFingerprint: fingerprint(blindIndex),
    version: 1,
  });
}

describe('CBE deposit-reference key profile', () => {
  it('verifies both key identities against the immutable production profile', () => {
    const readFile = vi.fn(() => profile());
    const result = loadAndVerifyCbeDepositReferenceKeyProfile(
      {
        CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE: CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE,
      },
      'production',
      { encryptionSecret, fingerprintSecret },
      { readFile },
    );

    expect(result).toEqual({
      encryptionKeyFingerprint: fingerprint(encryptionSecret),
      fingerprintKeyFingerprint: fingerprint(fingerprintSecret),
      version: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(readFile).toHaveBeenCalledWith(CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE);
  });

  it('rejects wrong key bytes, duplicate roots, extra fields, and a new version', () => {
    expect(() =>
      loadAndVerifyCbeDepositReferenceKeyProfile(
        { CBE_DEPOSIT_REFERENCE_KEY_PROFILE: profile('c'.repeat(64)) },
        'test',
        { encryptionSecret, fingerprintSecret },
      ),
    ).toThrow('do not match');
    expect(() =>
      loadAndVerifyCbeDepositReferenceKeyProfile(
        { CBE_DEPOSIT_REFERENCE_KEY_PROFILE: profile(encryptionSecret, encryptionSecret) },
        'test',
        { encryptionSecret, fingerprintSecret: encryptionSecret },
      ),
    ).toThrow('valid and distinct');
    expect(() =>
      loadAndVerifyCbeDepositReferenceKeyProfile(
        {
          CBE_DEPOSIT_REFERENCE_KEY_PROFILE: JSON.stringify({
            ...JSON.parse(profile()),
            unexpected: true,
          }),
        },
        'test',
        { encryptionSecret, fingerprintSecret },
      ),
    ).toThrow('invalid shape');
    expect(() =>
      loadAndVerifyCbeDepositReferenceKeyProfile(
        {
          CBE_DEPOSIT_REFERENCE_KEY_PROFILE: JSON.stringify({
            ...JSON.parse(profile()),
            version: 2,
          }),
        },
        'test',
        { encryptionSecret, fingerprintSecret },
      ),
    ).toThrow('profile is invalid');
  });

  it('requires the exact file path and rejects inline production manifests', () => {
    expect(() =>
      loadAndVerifyCbeDepositReferenceKeyProfile(
        { CBE_DEPOSIT_REFERENCE_KEY_PROFILE: profile() },
        'production',
        { encryptionSecret, fingerprintSecret },
      ),
    ).toThrow('required in production');
    expect(() =>
      loadAndVerifyCbeDepositReferenceKeyProfile(
        { CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE: '/tmp/wrong.json' },
        'production',
        { encryptionSecret, fingerprintSecret },
      ),
    ).toThrow('approved immutable path');
  });

  it('never includes key material in errors', () => {
    let thrown: unknown;
    try {
      loadAndVerifyCbeDepositReferenceKeyProfile(
        { CBE_DEPOSIT_REFERENCE_KEY_PROFILE: profile('c'.repeat(64)) },
        'test',
        { encryptionSecret, fingerprintSecret },
      );
    } catch (error) {
      thrown = error;
    }
    const message = String(thrown);
    expect(message).not.toContain(encryptionSecret);
    expect(message).not.toContain(fingerprintSecret);
  });
});
