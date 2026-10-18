import { createHash, createHmac } from 'node:crypto';

import {
  withOpenedCbeBirrDepositProofReference,
  type CbeBirrApprovedProofRootProfile,
  type CbeBirrReferenceOpeningProfile,
  type CbeBirrScopedReferenceOpeningKey,
} from '@fetanagent/cbe-birr-reference-opening';
import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';
import { describe, expect, it } from 'vitest';

import {
  CbeBirrWorkerKeyProvisioningCheckError,
  checkCbeBirrWorkerKeyProvisioning,
  type CbeBirrWorkerKeyProvisioningCheckInput,
} from './index.js';

const encryptionMasterSecret = 'a'.repeat(64);
const fingerprintMasterSecret = 'b'.repeat(64);

function keyId(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function rootProfile(): CbeBirrApprovedProofRootProfile {
  return {
    encryptionMasterFingerprint: keyId(Buffer.from(encryptionMasterSecret, 'hex')),
    fingerprintMasterFingerprint: keyId(Buffer.from(fingerprintMasterSecret, 'hex')),
    version: 2,
  };
}

function childKey(provider: 'cbe_birr' | 'telebirr' = 'cbe_birr'): Buffer {
  const master = Buffer.from(encryptionMasterSecret, 'hex');
  try {
    return createHmac('sha256', master)
      .update(`fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:${provider}`, 'utf8')
      .digest();
  } finally {
    master.fill(0);
  }
}

function workerKey(child: Buffer = childKey()): CbeBirrScopedReferenceOpeningKey {
  return {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    purpose: 'deposit-proof-reference-opening',
    keyVersion: 2,
    keyId: keyId(child),
    keyHex: child.toString('hex'),
  };
}

function workerProfile(
  key: CbeBirrScopedReferenceOpeningKey,
  root: CbeBirrApprovedProofRootProfile = rootProfile(),
): CbeBirrReferenceOpeningProfile {
  return {
    version: 1,
    providerCode: 'cbe_birr',
    purpose: 'deposit-proof-reference-opening',
    sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
    ciphertextProfileVersion: 2,
    encryptionKeyVersion: 2,
    keyId: key.keyId,
    rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
    rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
  };
}

function checkInput(): CbeBirrWorkerKeyProvisioningCheckInput {
  const root = rootProfile();
  const key = workerKey();
  return {
    approvedRootProfile: root,
    producerSecrets: { encryptionMasterSecret, fingerprintMasterSecret },
    workerKey: key,
    workerProfile: workerProfile(key, root),
  };
}

describe('offline CBE Birr worker-key provisioning check', () => {
  it('returns only a frozen nonsecret consistency witness for the matching producer roots and child', () => {
    const result = checkCbeBirrWorkerKeyProvisioning(checkInput());
    expect(result).toEqual({
      disposition: 'offline_consistency_only',
      keyId: workerKey().keyId,
      providerCode: 'cbe_birr',
      rootEncryptionMasterFingerprint: rootProfile().encryptionMasterFingerprint,
      rootFingerprintMasterFingerprint: rootProfile().fingerprintMasterFingerprint,
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      workerProfileVersion: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(encryptionMasterSecret);
    expect(JSON.stringify(result)).not.toContain(fingerprintMasterSecret);
    expect(JSON.stringify(result)).not.toContain(workerKey().keyHex);
  });

  it('matches the producer envelope and the scoped runtime opener with synthetic material', () => {
    const input = checkInput();
    checkCbeBirrWorkerKeyProvisioning(input);
    const protectedReference = protectDepositProofReference(
      {
        provider: 'cbe_birr',
        reference: 'ftan12345678',
        secrets: {
          encryptionSecret: encryptionMasterSecret,
          fingerprintSecret: fingerprintMasterSecret,
        },
      },
      { nonce: () => Buffer.from('000102030405060708090a0b', 'hex') },
    );
    const observed = withOpenedCbeBirrDepositProofReference(
      {
        ciphertext: protectedReference.ciphertext,
        masked: protectedReference.masked,
        ciphertextProfileVersion: 2,
        encryptionKeyVersion: 2,
        providerCode: 'cbe_birr',
      },
      input.workerKey,
      input.workerProfile,
      input.approvedRootProfile,
      (reference) => reference === 'FTAN12345678',
    );
    expect(observed).toBe(true);
  });

  it.each([
    { encryptionMasterSecret: 'c'.repeat(64), fingerprintMasterSecret },
    { encryptionMasterSecret, fingerprintMasterSecret: 'c'.repeat(64) },
    { encryptionMasterSecret, fingerprintMasterSecret: encryptionMasterSecret },
  ])('rejects producer master drift %#', (producerSecrets) => {
    expect(() => checkCbeBirrWorkerKeyProvisioning({ ...checkInput(), producerSecrets })).toThrow(
      CbeBirrWorkerKeyProvisioningCheckError,
    );
  });

  it.each([childKey('telebirr'), Buffer.alloc(32, 0xc)])(
    'rejects a self-consistent but non-CBE or unrelated child %#',
    (child) => {
      const proposedKey = workerKey(child);
      const input = checkInput();
      expect(() =>
        checkCbeBirrWorkerKeyProvisioning({
          ...input,
          workerKey: proposedKey,
          workerProfile: workerProfile(proposedKey),
        }),
      ).toThrow(CbeBirrWorkerKeyProvisioningCheckError);
      child.fill(0);
    },
  );

  it('rejects an internally consistent profile tied to another producer root identity', () => {
    const input = checkInput();
    const otherRoot: CbeBirrApprovedProofRootProfile = {
      ...rootProfile(),
      encryptionMasterFingerprint: `sha256:${'c'.repeat(64)}`,
    };
    expect(() =>
      checkCbeBirrWorkerKeyProvisioning({
        ...input,
        approvedRootProfile: otherRoot,
        workerProfile: workerProfile(input.workerKey, otherRoot),
      }),
    ).toThrow(CbeBirrWorkerKeyProvisioningCheckError);
  });

  it('rejects a false child ID even when the worker profile repeats it', () => {
    const input = checkInput();
    const proposedKey: CbeBirrScopedReferenceOpeningKey = {
      ...input.workerKey,
      keyId: `sha256:${'c'.repeat(64)}`,
    };
    expect(() =>
      checkCbeBirrWorkerKeyProvisioning({
        ...input,
        workerKey: proposedKey,
        workerProfile: workerProfile(proposedKey),
      }),
    ).toThrow(CbeBirrWorkerKeyProvisioningCheckError);
  });

  it('does not accept the producer master-pair shape as a worker child key', () => {
    const input = checkInput();
    expect(() =>
      checkCbeBirrWorkerKeyProvisioning({
        ...input,
        workerKey: {
          encryptionSecret: encryptionMasterSecret,
          fingerprintSecret: fingerprintMasterSecret,
        } as unknown as CbeBirrScopedReferenceOpeningKey,
      }),
    ).toThrow(CbeBirrWorkerKeyProvisioningCheckError);
  });

  it.each([
    (profile: CbeBirrReferenceOpeningProfile) => ({ ...profile, providerCode: 'telebirr' }),
    (profile: CbeBirrReferenceOpeningProfile) => ({ ...profile, purpose: 'receiver-opening' }),
    (profile: CbeBirrReferenceOpeningProfile) => ({ ...profile, sourceProfile: 'other' }),
    (profile: CbeBirrReferenceOpeningProfile) => ({ ...profile, encryptionKeyVersion: 1 }),
    (profile: CbeBirrReferenceOpeningProfile) => ({ ...profile, extra: true }),
  ])('rejects worker profile drift %#', (alter) => {
    const input = checkInput();
    expect(() =>
      checkCbeBirrWorkerKeyProvisioning({
        ...input,
        workerProfile: alter(input.workerProfile) as CbeBirrReferenceOpeningProfile,
      }),
    ).toThrow(CbeBirrWorkerKeyProvisioningCheckError);
  });

  it('rejects accessor and proxy inputs without returning secrets in an error', () => {
    const input = checkInput();
    const accessor = { ...input };
    Object.defineProperty(accessor, 'workerKey', {
      enumerable: true,
      get: () => input.workerKey,
    });
    for (const candidate of [accessor, new Proxy(input, {})]) {
      let message = '';
      try {
        checkCbeBirrWorkerKeyProvisioning(candidate);
      } catch (error) {
        expect(error).toBeInstanceOf(CbeBirrWorkerKeyProvisioningCheckError);
        message = String(error);
      }
      expect(message).not.toContain(encryptionMasterSecret);
      expect(message).not.toContain(fingerprintMasterSecret);
      expect(message).not.toContain(input.workerKey.keyHex);
    }
  });
});
