import { createHash } from 'node:crypto';
import { chownSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';

import {
  CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT,
  prepareCbeBirrReceiverDeliveryBundle,
  prepareCbeBirrReceiverProvisioningCandidate,
  stageCbeBirrReceiverDeliveryBundle,
} from '../../packages/cbe-birr-worker-key-provisioning-check/dist/index.js';
import {
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
  loadCbeBirrReceiverLookupKeyCustody,
  redactedCbeBirrReceiverLookupKeyCustodyForLog,
} from '../../packages/cbe-birr-worker-key-custody/dist/index.js';

const actorAuthUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef';
const receiverRevisionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const receiverVersion = 3;
const workerUid = 10_001;

function fingerprint(secret) {
  const bytes = Buffer.from(secret, 'hex');
  try {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  } finally {
    bytes.fill(0);
  }
}

function snapshot() {
  return {
    receiverRevisionId,
    receiverVersion,
    protectionProfileVersion: 2,
    encryptionKeyVersion: 2,
    fingerprintKeyVersion: 2,
  };
}

async function stageSyntheticFiles() {
  if (process.geteuid?.() !== 0) throw new Error('root required for synthetic staging');
  chownSync(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT, 0, 0);
  chmodSync(CBE_BIRR_RECEIVER_PRIVATE_STAGE_ROOT, 0o700);

  const encryptionMasterSecret = 'a'.repeat(64);
  const fingerprintMasterSecret = 'b'.repeat(64);
  const candidate = await prepareCbeBirrReceiverProvisioningCandidate({
    actorAuthUserId,
    approvedReceiverRevision: { receiverRevisionId, receiverVersion },
    approvedRootProfile: {
      version: 2,
      purpose: 'cbe_birr_receiver_lookup',
      encryptionMasterFingerprint: fingerprint(encryptionMasterSecret),
      fingerprintMasterFingerprint: fingerprint(fingerprintMasterSecret),
    },
    ownerSecrets: { encryptionMasterSecret, fingerprintMasterSecret },
    deploymentTarget: 'production',
    readActiveSnapshot: async () => snapshot(),
  });
  const bundle = await prepareCbeBirrReceiverDeliveryBundle({
    candidate,
    actorAuthUserId,
    approvedPins: { ...candidate.proposedPins },
    readActiveSnapshot: async () => snapshot(),
  });
  const approvedPins = { ...bundle.approvedPins };
  await stageCbeBirrReceiverDeliveryBundle({
    bundle,
    approvedPins,
    approvedWorkerUserId: workerUid,
    actorAuthUserId,
    readActiveSnapshot: async () => snapshot(),
  });
  writeFileSync('/pins/approved.json', `${JSON.stringify(approvedPins)}\n`, {
    flag: 'wx',
    mode: 0o444,
  });
  writeFileSync(
    '/pins/stale.json',
    `${JSON.stringify({ ...approvedPins, receiverVersion: receiverVersion + 1 })}\n`,
    { flag: 'wx', mode: 0o444 },
  );
  console.log('Synthetic CBE receiver files staged.');
}

function probeMountedFiles() {
  if (process.geteuid?.() !== workerUid) throw new Error('worker UID required');
  const approvedPins = JSON.parse(readFileSync('/run/configs/approved-pins.json', 'utf8'));
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
    approvedPins,
  );
  if (!config.enabled) throw new Error('mounted custody disabled');
  const redacted = redactedCbeBirrReceiverLookupKeyCustodyForLog(config);
  if (redacted.keyId !== approvedPins.workerKeyId) throw new Error('pin mismatch');
  console.log('Synthetic mounted CBE receiver custody verified.');
}

try {
  if (process.argv.length !== 3) throw new Error('one mode required');
  if (process.argv[2] === 'stage') await stageSyntheticFiles();
  else if (process.argv[2] === 'probe') probeMountedFiles();
  else throw new Error('unknown mode');
} catch {
  console.error('Synthetic CBE receiver custody smoke unavailable.');
  process.exitCode = 1;
}
