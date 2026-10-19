import { createHash } from 'node:crypto';

import {
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
  loadCbeBirrReceiverLookupKeyCustody,
  type CbeBirrGuardedFileStat,
  type CbeBirrWorkerKeyCustodyDependencies,
} from '@fetanagent/cbe-birr-worker-key-custody';
import { describe, expect, it, vi } from 'vitest';

import {
  CbeBirrReceiverDeliveryBundleError,
  prepareCbeBirrReceiverDeliveryBundle,
  prepareCbeBirrReceiverProvisioningCandidate,
  type CbeBirrReceiverDeliveryBundle,
  type CbeBirrReceiverProvisioningCandidate,
  type CbeBirrReceiverProvisioningCandidateInput,
  type CbeBirrReceiverProvisioningSnapshot,
} from './index.js';

const encryptionMasterSecret = 'a'.repeat(64);
const fingerprintMasterSecret = 'b'.repeat(64);
const receiverRevisionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const receiverVersion = 3;
const actorAuthUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef';

function sha256(bytes: Buffer): string {
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

async function candidate(): Promise<CbeBirrReceiverProvisioningCandidate> {
  return prepareCbeBirrReceiverProvisioningCandidate({
    actorAuthUserId,
    approvedReceiverRevision: { receiverRevisionId, receiverVersion },
    approvedRootProfile: {
      version: 2,
      purpose: 'cbe_birr_receiver_lookup',
      encryptionMasterFingerprint: sha256(Buffer.from(encryptionMasterSecret, 'hex')),
      fingerprintMasterFingerprint: sha256(Buffer.from(fingerprintMasterSecret, 'hex')),
    },
    ownerSecrets: { encryptionMasterSecret, fingerprintMasterSecret },
    deploymentTarget: 'production',
    readActiveSnapshot: async () => snapshot(),
  });
}

function loaderDependencies(
  bundle: CbeBirrReceiverDeliveryBundle,
): CbeBirrWorkerKeyCustodyDependencies {
  const files = new Map(bundle.files.map((file) => [file.path, file]));
  const stat = (path: string): CbeBirrGuardedFileStat => {
    const file = files.get(path);
    if (!file) throw new Error('Unexpected synthetic path');
    return {
      dev: 7,
      ino: path.length,
      mode: 0o100000 | file.mode,
      mtimeMs: 1_700_000_000_000,
      nlink: 1,
      size: file.bytes.length,
      uid: 10_001,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
  };
  return {
    effectiveUserId: 10_001,
    platform: 'linux',
    fileSystem: {
      noFollowFlag: 0o400000,
      lstat: stat,
      realpath: (path) => path,
      open: (path) => ({
        close: () => undefined,
        read: () => Buffer.from(files.get(path)!.bytes),
        stat: () => stat(path),
      }),
    },
  };
}

describe('offline CBE Birr receiver delivery bundle', () => {
  it('rechecks the approved revision and produces exactly the guarded loader files', async () => {
    const prepared = await candidate();
    const readActiveSnapshot = vi.fn<
      CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot']
    >(async () => snapshot());
    const bundle = await prepareCbeBirrReceiverDeliveryBundle({
      candidate: prepared,
      actorAuthUserId,
      approvedPins: { ...prepared.proposedPins },
      readActiveSnapshot,
    });
    expect(readActiveSnapshot).toHaveBeenCalledExactlyOnceWith(actorAuthUserId, {
      receiverRevisionId,
      receiverVersion,
    });
    expect(Object.isFrozen(readActiveSnapshot.mock.calls[0]?.[1])).toBe(true);
    expect(bundle.files.map(({ path, mode }) => ({ path, mode }))).toEqual([
      { path: CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE, mode: 0o400 },
      { path: CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE, mode: 0o444 },
      { path: CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE, mode: 0o444 },
    ]);
    expect(bundle.files.every((file) => !Object.keys(file).includes('bytes'))).toBe(true);
    expect(JSON.stringify(bundle)).not.toContain(prepared.workerKey.keyHex);
    expect(JSON.stringify(bundle)).not.toContain(encryptionMasterSecret);
    expect(JSON.stringify(bundle)).not.toContain(fingerprintMasterSecret);

    const config = loadCbeBirrReceiverLookupKeyCustody(
      {
        NODE_ENV: 'production',
        FINANCIAL_ACTIONS_MODE: 'dry_run',
        INTERNAL_CBE_BIRR_RECEIVER_KEY_CUSTODY_CANDIDATE_ENABLED: 'true',
        CBE_BIRR_RECEIVER_KEY_DEPLOYMENT_TARGET: 'production',
        CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
        CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
        CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
      },
      bundle.approvedPins,
      loaderDependencies(bundle),
    );
    expect(config.enabled).toBe(true);
    if (config.enabled) expect(config.key.keyId).toBe(prepared.workerKey.keyId);
    for (const file of bundle.files) file.bytes.fill(0);
  });

  it('fails closed for changed approval, forged candidates, or retired revisions', async () => {
    const prepared = await candidate();
    const readActiveSnapshot = vi.fn<
      CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot']
    >(async () => snapshot());
    const base = {
      candidate: prepared,
      actorAuthUserId,
      approvedPins: { ...prepared.proposedPins },
      readActiveSnapshot,
    };
    for (const changed of [
      { ...base, approvedPins: { ...base.approvedPins, workerKeyId: `sha256:${'0'.repeat(64)}` } },
      { ...base, approvedPins: { ...base.approvedPins, receiverVersion: receiverVersion + 1 } },
      { ...base, approvedPins: { ...base.approvedPins, deploymentTarget: 'staging' as const } },
      { ...base, candidate: { ...prepared } as CbeBirrReceiverProvisioningCandidate },
      { ...base, actorAuthUserId: 'not-an-owner-id' },
    ]) {
      await expect(prepareCbeBirrReceiverDeliveryBundle(changed)).rejects.toThrow(
        CbeBirrReceiverDeliveryBundleError,
      );
    }
    expect(readActiveSnapshot).not.toHaveBeenCalled();

    for (const stale of [
      { ...snapshot(), receiverVersion: receiverVersion + 1 },
      { ...snapshot(), protectionProfileVersion: 1 },
      { ...snapshot(), receiverPhone: '251900000001' },
      new Proxy(snapshot(), {}),
    ]) {
      await expect(
        prepareCbeBirrReceiverDeliveryBundle({
          ...base,
          readActiveSnapshot: async () => stale,
        }),
      ).rejects.toThrow(CbeBirrReceiverDeliveryBundleError);
    }
  });
});
