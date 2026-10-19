import { createHash } from 'node:crypto';

import {
  withOpenedCbeBirrReceiverLookup,
  type CbeBirrApprovedReceiverLookupRootProfile,
} from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-opening';
import { prepareCbeBirrReceiverRotation } from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-rotation';
import { describe, expect, it, vi } from 'vitest';

import {
  CbeBirrReceiverProvisioningCandidateError,
  prepareCbeBirrReceiverProvisioningCandidate,
  type CbeBirrReceiverProvisioningCandidateInput,
  type CbeBirrReceiverProvisioningSnapshot,
} from './index.js';

const encryptionMasterSecret = 'a'.repeat(64);
const fingerprintMasterSecret = 'b'.repeat(64);
const receiverRevisionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const receiverVersion = 3;
const actorAuthUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef';

function sha256(bytes: string | Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function snapshot(): CbeBirrReceiverProvisioningSnapshot {
  return {
    receiverRevisionId,
    receiverVersion,
    protectionProfileVersion: 2,
    encryptionKeyVersion: 2,
    fingerprintKeyVersion: 2,
  };
}

function input(
  readActiveSnapshot: CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot'] = async () =>
    snapshot(),
): CbeBirrReceiverProvisioningCandidateInput {
  const approvedRootProfile: CbeBirrApprovedReceiverLookupRootProfile = {
    encryptionMasterFingerprint: sha256(Buffer.from(encryptionMasterSecret, 'hex')),
    fingerprintMasterFingerprint: sha256(Buffer.from(fingerprintMasterSecret, 'hex')),
    purpose: 'cbe_birr_receiver_lookup',
    version: 2,
  };
  return {
    actorAuthUserId,
    approvedReceiverRevision: { receiverRevisionId, receiverVersion },
    approvedRootProfile,
    ownerSecrets: { encryptionMasterSecret, fingerprintMasterSecret },
    deploymentTarget: 'production',
    readActiveSnapshot,
  };
}

async function expectUnavailable(
  candidate: CbeBirrReceiverProvisioningCandidateInput,
): Promise<void> {
  try {
    await prepareCbeBirrReceiverProvisioningCandidate(candidate);
    throw new Error('Expected a failed candidate');
  } catch (error) {
    expect(error).toBeInstanceOf(CbeBirrReceiverProvisioningCandidateError);
    expect(String(error)).not.toContain(encryptionMasterSecret);
    expect(String(error)).not.toContain(fingerprintMasterSecret);
  }
}

describe('offline CBE Birr receiver-revision provisioning candidate', () => {
  it('checks the exact active revision twice and opens a synthetic Owner envelope', async () => {
    const readActiveSnapshot = vi.fn<
      CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot']
    >(async () => snapshot());
    const candidate = await prepareCbeBirrReceiverProvisioningCandidate(input(readActiveSnapshot));
    expect(readActiveSnapshot).toHaveBeenCalledTimes(2);
    expect(readActiveSnapshot).toHaveBeenNthCalledWith(1, actorAuthUserId, {
      receiverRevisionId,
      receiverVersion,
    });
    expect(readActiveSnapshot.mock.calls[0]?.[1]).toBe(readActiveSnapshot.mock.calls[1]?.[1]);
    expect(Object.isFrozen(readActiveSnapshot.mock.calls[0]?.[1])).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(candidate.disposition).toBe('offline_candidate_only');
    expect(candidate.witness.disposition).toBe('offline_consistency_only');
    expect(candidate.proposedPins).toEqual({
      deploymentTarget: 'production',
      receiverRevisionId,
      receiverVersion,
      rootProfileSha256: sha256(candidate.rootProfileUtf8),
      workerProfileSha256: sha256(candidate.workerProfileUtf8),
      workerKeyId: candidate.workerKey.keyId,
    });
    expect(JSON.parse(candidate.rootProfileUtf8)).toEqual(input().approvedRootProfile);
    expect(JSON.parse(candidate.workerProfileUtf8)).toEqual(candidate.workerProfile);
    expect(candidate.rootProfileUtf8.endsWith('\n')).toBe(true);
    expect(candidate.workerProfileUtf8.endsWith('\n')).toBe(true);
    expect(Object.keys(candidate)).not.toContain('workerKey');
    const serialized = JSON.stringify(candidate);
    expect(serialized).not.toContain(candidate.workerKey.keyHex);
    expect(serialized).not.toContain(encryptionMasterSecret);
    expect(serialized).not.toContain(fingerprintMasterSecret);

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
        candidate.workerKey,
        candidate.workerProfile,
        input().approvedRootProfile,
        (opened) => opened === phone,
      ),
    ).toBe(true);
  });

  it('rejects missing, stale, malformed, or drifting active snapshots', async () => {
    for (const value of [
      undefined,
      { ...snapshot(), receiverRevisionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeea' },
      { ...snapshot(), receiverVersion: receiverVersion + 1 },
      { ...snapshot(), protectionProfileVersion: 1 },
      { ...snapshot(), encryptionKeyVersion: 1 },
      { ...snapshot(), fingerprintKeyVersion: 1 },
      { ...snapshot(), receiverPhone: '251900000001' },
      new Proxy(snapshot(), {}),
    ]) {
      await expectUnavailable(input(async () => value));
    }
    const readActiveSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce({ ...snapshot(), receiverVersion: receiverVersion + 1 });
    await expectUnavailable(input(readActiveSnapshot));
    expect(readActiveSnapshot).toHaveBeenCalledTimes(2);
  });

  it('rejects wrong roots, malformed approvals, and dangerous data properties', async () => {
    const valid = input();
    const candidates = [
      { ...valid, actorAuthUserId: 'not-a-uuid' },
      { ...valid, approvedReceiverRevision: { receiverRevisionId, receiverVersion: 0 } },
      { ...valid, approvedReceiverRevision: { receiverRevisionId, receiverVersion: 4 } },
      { ...valid, ownerSecrets: { ...valid.ownerSecrets, encryptionMasterSecret: 'e'.repeat(64) } },
      {
        ...valid,
        approvedRootProfile: {
          ...valid.approvedRootProfile,
          encryptionMasterFingerprint: `sha256:${'e'.repeat(64)}`,
        },
      },
      { ...valid, deploymentTarget: 'unknown' },
      { ...valid, readActiveSnapshot: () => undefined },
      new Proxy(valid, {}),
    ];
    const accessor = { ...valid };
    Object.defineProperty(accessor, 'ownerSecrets', {
      enumerable: true,
      get: () => valid.ownerSecrets,
    });
    for (const candidate of [accessor, ...candidates]) {
      await expectUnavailable(candidate as CbeBirrReceiverProvisioningCandidateInput);
    }
  });

  it('captures approved revision values before the asynchronous snapshot read', async () => {
    const values = input();
    const revision = { receiverRevisionId, receiverVersion };
    const candidate = await prepareCbeBirrReceiverProvisioningCandidate({
      ...values,
      approvedReceiverRevision: revision,
      readActiveSnapshot: async () => {
        revision.receiverVersion = receiverVersion + 1;
        return snapshot();
      },
    });
    expect(candidate.proposedPins.receiverVersion).toBe(receiverVersion);
    expect(revision.receiverVersion).toBe(receiverVersion + 1);
  });
});
