import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { prepareCbeBirrReceiverProvisioningCandidate } from '../../packages/cbe-birr-worker-key-provisioning-check/dist/index.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VERSION = /^[1-9][0-9]{0,9}$/u;
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

async function main() {
  if (process.platform !== 'linux') unavailable();
  const revisionId = process.env.CBE_APPROVED_RECEIVER_REVISION_ID;
  const version = process.env.CBE_APPROVED_RECEIVER_VERSION;
  const profileJson = process.env.OWNER_CBE_BIRR_LOOKUP_PROFILE_V2_JSON;
  const encryptionMasterSecret = process.env.OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_SECRET;
  const fingerprintMasterSecret = process.env.OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_SECRET;
  if (
    typeof revisionId !== 'string' ||
    !UUID_V4.test(revisionId) ||
    typeof version !== 'string' ||
    !VERSION.test(version) ||
    typeof profileJson !== 'string' ||
    typeof encryptionMasterSecret !== 'string' ||
    typeof fingerprintMasterSecret !== 'string' ||
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
  process.stdout.write(`production_cbe_receiver_key_pin_plan=sha256:${pinDigest}\n`);
}

main().catch(() => {
  process.stderr.write('Production CBE receiver key plan is unavailable.\n');
  process.exitCode = 1;
});
