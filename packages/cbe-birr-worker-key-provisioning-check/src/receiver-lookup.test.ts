import { createHash } from 'node:crypto';

import {
  withOpenedCbeBirrReceiverLookup,
  type CbeBirrApprovedReceiverLookupRootProfile,
  type CbeBirrReceiverLookupChildKey,
  type CbeBirrReceiverLookupOpeningProfile,
} from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-opening';
import { deriveCbeBirrReceiverLookupChildKey } from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-provisioning';
import { prepareCbeBirrReceiverRotation } from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-rotation';
import { describe, expect, it } from 'vitest';

import {
  CbeBirrReceiverKeyProvisioningCheckError,
  checkCbeBirrReceiverKeyProvisioning,
  type CbeBirrReceiverKeyProvisioningCheckInput,
} from './index.js';

const encryptionMasterSecret = 'a'.repeat(64);
const fingerprintMasterSecret = 'b'.repeat(64);
const receiverRevisionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const receiverVersion = 3;

function keyId(secret: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex')}`;
}

function rootProfile(): CbeBirrApprovedReceiverLookupRootProfile {
  return {
    encryptionMasterFingerprint: keyId(encryptionMasterSecret),
    fingerprintMasterFingerprint: keyId(fingerprintMasterSecret),
    purpose: 'cbe_birr_receiver_lookup',
    version: 2,
  };
}

function workerProfile(
  key: CbeBirrReceiverLookupChildKey,
  root: CbeBirrApprovedReceiverLookupRootProfile = rootProfile(),
): CbeBirrReceiverLookupOpeningProfile {
  return {
    version: 1,
    providerCode: 'cbe_birr',
    purpose: 'receiver-lookup-opening',
    receiverRevisionId: key.receiverRevisionId,
    receiverVersion: key.receiverVersion,
    keyId: key.keyId,
    rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
    rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
  };
}

function checkInput(): CbeBirrReceiverKeyProvisioningCheckInput {
  const key = deriveCbeBirrReceiverLookupChildKey({
    receiverRevisionId,
    receiverVersion,
    encryptionSecret: encryptionMasterSecret,
  });
  return {
    approvedReceiverRevision: { receiverRevisionId, receiverVersion },
    approvedRootProfile: rootProfile(),
    ownerSecrets: { encryptionMasterSecret, fingerprintMasterSecret },
    workerKey: key,
    workerProfile: workerProfile(key),
  };
}

describe('offline CBE Birr receiver-revision key provisioning check', () => {
  it('returns a nonsecret consistency witness and opens a synthetic Owner envelope', () => {
    const input = checkInput();
    const witness = checkCbeBirrReceiverKeyProvisioning(input);
    expect(witness).toEqual({
      disposition: 'offline_consistency_only',
      receiverRevisionId,
      receiverVersion,
      keyId: input.workerKey.keyId,
      rootEncryptionMasterFingerprint: input.approvedRootProfile.encryptionMasterFingerprint,
      rootFingerprintMasterFingerprint: input.approvedRootProfile.fingerprintMasterFingerprint,
      workerProfileVersion: 1,
    });
    expect(Object.isFrozen(witness)).toBe(true);
    expect(JSON.stringify(witness)).not.toContain(input.workerKey.keyHex);
    expect(JSON.stringify(witness)).not.toContain(encryptionMasterSecret);
    expect(JSON.stringify(witness)).not.toContain(fingerprintMasterSecret);

    const phone = '251900000001';
    const prepared = prepareCbeBirrReceiverRotation({
      receiverRevisionId,
      receiverVersion,
      receiverPhone: phone,
      referenceSecrets: { encryptionSecret: 'c'.repeat(64), fingerprintSecret: 'd'.repeat(64) },
      lookupSecrets: {
        encryptionSecret: encryptionMasterSecret,
        fingerprintSecret: fingerprintMasterSecret,
      },
    });
    expect(
      withOpenedCbeBirrReceiverLookup(
        {
          receiverRevisionId,
          receiverVersion,
          ciphertext: prepared.lookup.ciphertext,
          masked: prepared.lookup.masked,
          protectionProfileVersion: prepared.lookup.protectionProfileVersion,
          encryptionKeyVersion: prepared.lookup.encryptionKeyVersion,
        },
        input.workerKey,
        input.workerProfile,
        input.approvedRootProfile,
        (opened) => opened === phone,
      ),
    ).toBe(true);
  });

  it('rejects a self-consistent child and manifest for a different revision', () => {
    const input = checkInput();
    const other = deriveCbeBirrReceiverLookupChildKey({
      receiverRevisionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef',
      receiverVersion,
      encryptionSecret: encryptionMasterSecret,
    });
    expect(() =>
      checkCbeBirrReceiverKeyProvisioning({
        ...input,
        workerKey: other,
        workerProfile: workerProfile(other),
      }),
    ).toThrow(CbeBirrReceiverKeyProvisioningCheckError);
    const later = deriveCbeBirrReceiverLookupChildKey({
      receiverRevisionId,
      receiverVersion: receiverVersion + 1,
      encryptionSecret: encryptionMasterSecret,
    });
    expect(() =>
      checkCbeBirrReceiverKeyProvisioning({
        ...input,
        workerKey: later,
        workerProfile: workerProfile(later),
      }),
    ).toThrow(CbeBirrReceiverKeyProvisioningCheckError);
  });

  it('rejects master drift and a proposed child unrelated to the approved root', () => {
    const input = checkInput();
    for (const ownerSecrets of [
      { encryptionMasterSecret: 'e'.repeat(64), fingerprintMasterSecret },
      { encryptionMasterSecret, fingerprintMasterSecret: 'e'.repeat(64) },
      { encryptionMasterSecret, fingerprintMasterSecret: encryptionMasterSecret },
    ]) {
      expect(() => checkCbeBirrReceiverKeyProvisioning({ ...input, ownerSecrets })).toThrow(
        CbeBirrReceiverKeyProvisioningCheckError,
      );
    }
    const unrelated = deriveCbeBirrReceiverLookupChildKey({
      receiverRevisionId,
      receiverVersion,
      encryptionSecret: 'e'.repeat(64),
    });
    expect(() =>
      checkCbeBirrReceiverKeyProvisioning({
        ...input,
        workerKey: unrelated,
        workerProfile: workerProfile(unrelated),
      }),
    ).toThrow(CbeBirrReceiverKeyProvisioningCheckError);
  });

  it('rejects profile or root drift and malformed inputs without exposing secrets', () => {
    const input = checkInput();
    const otherRoot = {
      ...input.approvedRootProfile,
      encryptionMasterFingerprint: `sha256:${'f'.repeat(64)}`,
    };
    const candidates = [
      {
        ...input,
        approvedRootProfile: otherRoot,
        workerProfile: workerProfile(input.workerKey, otherRoot),
      },
      {
        ...input,
        workerProfile: { ...input.workerProfile, purpose: 'deposit-proof-reference-opening' },
      },
      { ...input, workerKey: { ...input.workerKey, keyId: `sha256:${'f'.repeat(64)}` } },
      {
        ...input,
        approvedReceiverRevision: { ...input.approvedReceiverRevision, receiverVersion: 0 },
      },
    ];
    const accessor = { ...input };
    Object.defineProperty(accessor, 'workerKey', {
      enumerable: true,
      get: () => input.workerKey,
    });
    for (const candidate of [accessor, new Proxy(input, {}), ...candidates]) {
      let message = '';
      try {
        checkCbeBirrReceiverKeyProvisioning(candidate as CbeBirrReceiverKeyProvisioningCheckInput);
      } catch (error) {
        expect(error).toBeInstanceOf(CbeBirrReceiverKeyProvisioningCheckError);
        message = String(error);
      }
      expect(message).toContain('CBE Birr receiver key provisioning check failed.');
      expect(message).not.toContain(encryptionMasterSecret);
      expect(message).not.toContain(fingerprintMasterSecret);
      expect(message).not.toContain(input.workerKey.keyHex);
    }
  });
});
