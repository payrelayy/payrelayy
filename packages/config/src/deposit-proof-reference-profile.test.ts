import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  DEPOSIT_PROOF_REFERENCE_PRODUCTION_PROFILE_FILE,
  loadAndVerifyDepositProofReferenceProfile,
} from './deposit-proof-reference-profile.js';

const encryptionMasterSecret = 'a'.repeat(64);
const fingerprintMasterSecret = 'b'.repeat(64);

function fingerprint(secret: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex')}`;
}

function profile(
  encryption = encryptionMasterSecret,
  fingerprintRoot = fingerprintMasterSecret,
): string {
  return JSON.stringify({
    encryptionMasterFingerprint: fingerprint(encryption),
    fingerprintMasterFingerprint: fingerprint(fingerprintRoot),
    version: 2,
  });
}

describe('provider-neutral deposit proof-reference profile', () => {
  it('verifies both master identities against the immutable production v2 profile', () => {
    const readFile = vi.fn(() => profile());
    const result = loadAndVerifyDepositProofReferenceProfile(
      { DEPOSIT_PROOF_REFERENCE_PROFILE_FILE: DEPOSIT_PROOF_REFERENCE_PRODUCTION_PROFILE_FILE },
      'production',
      { encryptionMasterSecret, fingerprintMasterSecret },
      { readFile },
    );

    expect(result).toEqual({
      encryptionMasterFingerprint: fingerprint(encryptionMasterSecret),
      fingerprintMasterFingerprint: fingerprint(fingerprintMasterSecret),
      version: 2,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(readFile).toHaveBeenCalledWith(DEPOSIT_PROOF_REFERENCE_PRODUCTION_PROFILE_FILE);
  });

  it('rejects wrong master bytes, duplicate masters, extra fields, and other versions', () => {
    expect(() =>
      loadAndVerifyDepositProofReferenceProfile(
        { DEPOSIT_PROOF_REFERENCE_PROFILE: profile('c'.repeat(64)) },
        'test',
        { encryptionMasterSecret, fingerprintMasterSecret },
      ),
    ).toThrow('do not match');
    expect(() =>
      loadAndVerifyDepositProofReferenceProfile(
        {
          DEPOSIT_PROOF_REFERENCE_PROFILE: profile(encryptionMasterSecret, encryptionMasterSecret),
        },
        'test',
        {
          encryptionMasterSecret,
          fingerprintMasterSecret: encryptionMasterSecret,
        },
      ),
    ).toThrow('valid and distinct');
    expect(() =>
      loadAndVerifyDepositProofReferenceProfile(
        {
          DEPOSIT_PROOF_REFERENCE_PROFILE: JSON.stringify({
            ...JSON.parse(profile()),
            unexpected: true,
          }),
        },
        'test',
        { encryptionMasterSecret, fingerprintMasterSecret },
      ),
    ).toThrow('invalid shape');
    expect(() =>
      loadAndVerifyDepositProofReferenceProfile(
        {
          DEPOSIT_PROOF_REFERENCE_PROFILE: JSON.stringify({
            ...JSON.parse(profile()),
            version: 1,
          }),
        },
        'test',
        { encryptionMasterSecret, fingerprintMasterSecret },
      ),
    ).toThrow('profile is invalid');
  });

  it('requires the exact v2 file path and rejects inline production profiles', () => {
    expect(() =>
      loadAndVerifyDepositProofReferenceProfile(
        { DEPOSIT_PROOF_REFERENCE_PROFILE: profile() },
        'production',
        { encryptionMasterSecret, fingerprintMasterSecret },
      ),
    ).toThrow('required in production');
    expect(() =>
      loadAndVerifyDepositProofReferenceProfile(
        { DEPOSIT_PROOF_REFERENCE_PROFILE_FILE: '/tmp/wrong.json' },
        'production',
        { encryptionMasterSecret, fingerprintMasterSecret },
      ),
    ).toThrow('approved immutable v2 path');
  });

  it('does not expose master material in errors', () => {
    let thrown: unknown;
    try {
      loadAndVerifyDepositProofReferenceProfile(
        { DEPOSIT_PROOF_REFERENCE_PROFILE: profile('c'.repeat(64)) },
        'test',
        { encryptionMasterSecret, fingerprintMasterSecret },
      );
    } catch (error) {
      thrown = error;
    }
    const message = String(thrown);
    expect(message).not.toContain(encryptionMasterSecret);
    expect(message).not.toContain(fingerprintMasterSecret);
  });
});
