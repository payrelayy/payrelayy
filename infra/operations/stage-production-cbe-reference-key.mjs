import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { prepareCbeReferenceWorkerDelivery } from './cbe-reference-worker-delivery.mjs';

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SWITCH_SQL = `select mode from app.feature_switches
  where feature_key = 'cbe_birr_authoritative_verification'`;

function unavailable() {
  throw new Error('Production CBE reference key staging is unavailable.');
}

function requireCbeStopped() {
  if (
    process.env.PGHOST !== 'aws-0-eu-west-1.pooler.supabase.com' ||
    process.env.PGPORT !== '6543' ||
    process.env.PGDATABASE !== 'postgres' ||
    process.env.PGUSER !== 'postgres.xzztugbgtulptnbpoelr' ||
    !process.env.PGPASSWORD ||
    !process.env.PGSSLROOTCERT
  )
    unavailable();
  const result = spawnSync(
    'psql',
    [
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
      '--command',
      SWITCH_SQL,
    ],
    {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 256,
      env: {
        PATH: process.env.PATH,
        PGPASSWORD: process.env.PGPASSWORD,
        PGHOST: process.env.PGHOST,
        PGPORT: process.env.PGPORT,
        PGDATABASE: process.env.PGDATABASE,
        PGUSER: process.env.PGUSER,
        PGSSLROOTCERT: process.env.PGSSLROOTCERT,
        PGCONNECT_TIMEOUT: '5',
        PGAPPNAME: 'fetanagent_cbe_reference_key_stage',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000',
        PGSSLMODE: 'verify-full',
        PGSERVICEFILE: '/dev/null',
        PGPASSFILE: '/dev/null',
      },
    },
  );
  if (result.error || result.status !== 0 || result.stdout !== 'disabled\n') unavailable();
}

function requirePrivateFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) unavailable();
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o600 ||
    realpathSync(path) !== path ||
    stat.size < 1 ||
    stat.size > 8192
  )
    unavailable();
}

function runHost(mode, pins, payload) {
  const host = process.env.PRODUCTION_VM_HOST;
  const keyFile = process.env.PRODUCTION_VM_SSH_KEY_FILE;
  const knownHosts = process.env.PRODUCTION_VM_KNOWN_HOSTS_FILE;
  const helperSha = process.env.CBE_REFERENCE_HOST_HELPER_SHA256;
  const releaseSha = process.env.CBE_EXPECTED_DEPLOYED_RELEASE_SHA;
  if (
    typeof host !== 'string' ||
    !/^[a-zA-Z0-9.-]{1,253}$/u.test(host) ||
    typeof helperSha !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(helperSha) ||
    typeof releaseSha !== 'string' ||
    !SHA.test(releaseSha)
  )
    unavailable();
  requirePrivateFile(keyFile);
  requirePrivateFile(knownHosts);
  const args = [
    releaseSha,
    pins.rootProfileSha256,
    pins.workerProfileSha256,
    pins.workerKeyId,
    process.env.CBE_APPROVED_PIN_PLAN_DIGEST,
  ];
  const remote = `sudo -n /usr/local/sbin/fetanagent-cbe-reference-key-installer ${mode} ${helperSha} ${args.join(' ')}`;
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
      maxBuffer: 512,
      env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' },
    },
  );
  const expected =
    mode === 'preflight'
      ? 'CBE reference key host preflight passed.\n'
      : 'CBE reference key staged without worker or switch change.\n';
  if (result.error || result.status !== 0 || result.stdout !== expected) unavailable();
}

try {
  if (process.platform !== 'linux') unavailable();
  const approvedDigest = process.env.CBE_APPROVED_PIN_PLAN_DIGEST;
  if (typeof approvedDigest !== 'string' || !DIGEST.test(approvedDigest)) unavailable();
  requireCbeStopped();
  // Host release and empty target are checked before deriving the worker child.
  // The preflight uses an approved digest but dummy profile digests; the helper checks shape only.
  const placeholder = `sha256:${'0'.repeat(64)}`;
  runHost('preflight', {
    rootProfileSha256: placeholder,
    workerProfileSha256: placeholder,
    workerKeyId: placeholder,
  });
  const delivery = prepareCbeReferenceWorkerDelivery({
    rootProfileJson: process.env.DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON,
    encryptionMasterSecret: process.env.DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET,
    fingerprintMasterSecret: process.env.DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET,
  });
  try {
    if (delivery.planDigest !== approvedDigest) unavailable();
    runHost('preflight', delivery.pins);
    requireCbeStopped();
    runHost('stage', delivery.pins, delivery.payload);
    requireCbeStopped();
    process.stdout.write(
      'Production CBE reference key staged; no worker or payment switch changed.\n',
    );
  } finally {
    delivery.payload.fill(0);
  }
} catch {
  process.stderr.write('Production CBE reference key staging is unavailable.\n');
  process.exitCode = 1;
}
