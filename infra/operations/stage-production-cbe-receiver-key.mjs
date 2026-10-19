import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  prepareCbeBirrReceiverDeliveryBundle,
  prepareCbeBirrReceiverProvisioningCandidate,
} from '../../packages/cbe-birr-worker-key-provisioning-check/dist/index.js';
import {
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
} from '../../packages/cbe-birr-worker-key-custody/dist/index.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VERSION = /^[1-9][0-9]{0,9}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SNAPSHOT_SQL = `select row_to_json(snapshot)::text
from (
  select owner.auth_user_id as "actorAuthUserId",
         receiver.receiver_revision_id as "receiverRevisionId",
         receiver.receiver_version as "receiverVersion",
         receiver.protection_profile_version as "protectionProfileVersion",
         receiver.encryption_key_version as "encryptionKeyVersion",
         receiver.fingerprint_key_version as "fingerprintKeyVersion"
    from app.admin_users owner
    cross join lateral app.inspect_owner_cbe_birr_provisioning_snapshot(owner.auth_user_id) receiver
   where owner.role = 'owner' and owner.status = 'active'
     and (select mode from app.feature_switches
            where feature_key = 'cbe_birr_authoritative_verification') = 'disabled'
) snapshot`;

function unavailable() {
  throw new Error('Production CBE receiver key plan is unavailable.');
}

function readSnapshot() {
  const result = spawnSync(
    'psql',
    [
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
      '--command',
      SNAPSHOT_SQL,
    ],
    {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 8_192,
      env: {
        PATH: process.env.PATH,
        PGPASSWORD: process.env.PGPASSWORD,
        PGHOST: process.env.PGHOST,
        PGPORT: process.env.PGPORT,
        PGDATABASE: process.env.PGDATABASE,
        PGUSER: process.env.PGUSER,
        PGSSLROOTCERT: process.env.PGSSLROOTCERT,
        PGCONNECT_TIMEOUT: '5',
        PGAPPNAME: 'fetanagent_cbe_receiver_key_plan',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000',
        PGSSLMODE: 'verify-full',
        PGSERVICEFILE: '/dev/null',
        PGPASSFILE: '/dev/null',
      },
    },
  );
  if (result.error || result.status !== 0) unavailable();
  const lines = result.stdout.trim().split('\n');
  if (lines.length !== 1 || lines[0].length > 2_048) unavailable();
  let snapshot;
  try {
    snapshot = JSON.parse(lines[0]);
  } catch {
    unavailable();
  }
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    Object.keys(snapshot).sort().join(',') !==
      'actorAuthUserId,encryptionKeyVersion,fingerprintKeyVersion,protectionProfileVersion,receiverRevisionId,receiverVersion' ||
    typeof snapshot.actorAuthUserId !== 'string' ||
    typeof snapshot.receiverRevisionId !== 'string' ||
    !Number.isSafeInteger(snapshot.receiverVersion) ||
    snapshot.protectionProfileVersion !== 2 ||
    snapshot.encryptionKeyVersion !== 2 ||
    snapshot.fingerprintKeyVersion !== 2
  )
    unavailable();
  return snapshot;
}

function runHost(mode, pinArgs, payload) {
  const host = process.env.PRODUCTION_VM_HOST;
  const keyFile = process.env.PRODUCTION_VM_SSH_KEY_FILE;
  const knownHosts = process.env.PRODUCTION_VM_KNOWN_HOSTS_FILE;
  const helperSha = process.env.CBE_HOST_HELPER_SHA256;
  if (
    typeof host !== 'string' ||
    !/^[a-zA-Z0-9.-]{1,253}$/u.test(host) ||
    typeof keyFile !== 'string' ||
    !isAbsolute(keyFile) ||
    typeof knownHosts !== 'string' ||
    !isAbsolute(knownHosts) ||
    typeof helperSha !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(helperSha)
  )
    unavailable();
  for (const path of [keyFile, knownHosts]) {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o600 ||
      realpathSync(path) !== path ||
      stat.size < 1 ||
      stat.size > 8192
    )
      unavailable();
  }
  const remote = `sudo -n /usr/local/sbin/fetanagent-cbe-receiver-key-installer ${mode} ${helperSha} ${pinArgs.join(' ')}`;
  const result = spawnSync(
    'ssh',
    [
      '-F',
      '/dev/null',
      '-i',
      keyFile,
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      `UserKnownHostsFile=${knownHosts}`,
      `fetanagent-admin@${host}`,
      remote,
    ],
    {
      input: payload,
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 4_096,
      env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' },
    },
  );
  if (result.error || result.status !== 0) unavailable();
  const expected =
    mode === 'preflight'
      ? 'CBE receiver key host preflight passed.\n'
      : 'CBE receiver key staged without worker or switch change.\n';
  if (result.stdout !== expected) unavailable();
}

async function main() {
  if (process.platform !== 'linux') unavailable();
  const revisionId = process.env.CBE_APPROVED_RECEIVER_REVISION_ID;
  const version = process.env.CBE_APPROVED_RECEIVER_VERSION;
  const profileJson = process.env.OWNER_CBE_BIRR_LOOKUP_PROFILE_V2_JSON;
  const encryptionMasterSecret = process.env.OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_SECRET;
  const fingerprintMasterSecret = process.env.OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_SECRET;
  const planDigest = process.env.CBE_APPROVED_PIN_PLAN_DIGEST;
  const deployedSha = process.env.CBE_EXPECTED_DEPLOYED_RELEASE_SHA;
  if (
    typeof revisionId !== 'string' ||
    !UUID_V4.test(revisionId) ||
    typeof version !== 'string' ||
    !VERSION.test(version) ||
    typeof profileJson !== 'string' ||
    typeof encryptionMasterSecret !== 'string' ||
    typeof fingerprintMasterSecret !== 'string' ||
    typeof planDigest !== 'string' ||
    !DIGEST.test(planDigest) ||
    typeof deployedSha !== 'string' ||
    !SHA.test(deployedSha) ||
    process.env.PGHOST !== 'aws-0-eu-west-1.pooler.supabase.com' ||
    process.env.PGPORT !== '6543' ||
    process.env.PGDATABASE !== 'postgres' ||
    process.env.PGUSER !== 'postgres.xzztugbgtulptnbpoelr' ||
    !process.env.PGSSLROOTCERT ||
    !process.env.PGPASSWORD
  )
    unavailable();
  let approvedRootProfile;
  try {
    approvedRootProfile = JSON.parse(profileJson);
  } catch {
    unavailable();
  }
  const approvedReceiverRevision = Object.freeze({
    receiverRevisionId: revisionId,
    receiverVersion: Number(version),
  });
  const first = readSnapshot();
  if (
    first.receiverRevisionId !== revisionId ||
    first.receiverVersion !== approvedReceiverRevision.receiverVersion
  )
    unavailable();
  const actorAuthUserId = first.actorAuthUserId;
  const readActiveSnapshot = async (actor, approved) => {
    const snapshot = readSnapshot();
    if (
      actor !== actorAuthUserId ||
      snapshot.actorAuthUserId !== actorAuthUserId ||
      snapshot.receiverRevisionId !== approved.receiverRevisionId ||
      snapshot.receiverVersion !== approved.receiverVersion
    )
      unavailable();
    return {
      receiverRevisionId: snapshot.receiverRevisionId,
      receiverVersion: snapshot.receiverVersion,
      protectionProfileVersion: snapshot.protectionProfileVersion,
      encryptionKeyVersion: snapshot.encryptionKeyVersion,
      fingerprintKeyVersion: snapshot.fingerprintKeyVersion,
    };
  };
  // No Owner key is derived until the exact deployed release and empty custody target pass.
  const initialHostArgs = [
    deployedSha,
    revisionId,
    version,
    'sha256:' + '0'.repeat(64),
    'sha256:' + '0'.repeat(64),
    'sha256:' + '0'.repeat(64),
    planDigest,
  ];
  runHost('preflight', initialHostArgs);
  const candidate = await prepareCbeBirrReceiverProvisioningCandidate({
    actorAuthUserId,
    approvedReceiverRevision,
    approvedRootProfile,
    ownerSecrets: { encryptionMasterSecret, fingerprintMasterSecret },
    deploymentTarget: 'production',
    readActiveSnapshot,
  });
  const pinDigest = createHash('sha256')
    .update(JSON.stringify(candidate.proposedPins), 'utf8')
    .digest('hex');
  if (`sha256:${pinDigest}` !== planDigest) unavailable();
  const pins = candidate.proposedPins;
  const pinArgs = [
    deployedSha,
    revisionId,
    version,
    pins.rootProfileSha256,
    pins.workerProfileSha256,
    pins.workerKeyId,
    planDigest,
  ];
  let payload;
  let bundle;
  try {
    bundle = await prepareCbeBirrReceiverDeliveryBundle({
      candidate,
      actorAuthUserId,
      approvedPins: pins,
      readActiveSnapshot,
    });
    const paths = [
      CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
      CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
      CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
    ];
    const files = paths.map((path) => bundle.files.find((file) => file.path === path));
    if (files.some((file) => !file || !/^[^\r\n]{1,4095}\n$/u.test(file.bytes.toString('utf8'))))
      unavailable();
    payload = Buffer.concat(files.map((file) => file.bytes));
    if (payload.length > 12_288) unavailable();
    runHost('stage', pinArgs, payload);
    await readActiveSnapshot(actorAuthUserId, approvedReceiverRevision);
    process.stdout.write(
      'Production CBE receiver key staged; no worker or payment switch changed.\n',
    );
  } finally {
    payload?.fill(0);
    for (const file of bundle?.files ?? []) file.bytes.fill(0);
  }
}

main().catch(() => {
  process.stderr.write('Production CBE receiver key staging is unavailable.\n');
  process.exitCode = 1;
});
