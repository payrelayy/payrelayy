import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const planScript = fileURLToPath(
  new URL('./plan-production-cbe-receiver-key.mjs', import.meta.url),
);
const stageScript = fileURLToPath(
  new URL('./stage-production-cbe-receiver-key.mjs', import.meta.url),
);
const revision = 'b70a1fe4-420b-4e66-9b04-ec706cd87be3';
const actor = 'f32441c2-510c-4e28-9843-95dbe06612fe';
const encryptionMaster = '11'.repeat(32);
const fingerprintMaster = '22'.repeat(32);
const shaOfHex = (hex) =>
  `sha256:${createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')}`;
const rootProfile = JSON.stringify({
  version: 2,
  purpose: 'cbe_birr_receiver_lookup',
  encryptionMasterFingerprint: shaOfHex(encryptionMaster),
  fingerprintMasterFingerprint: shaOfHex(fingerprintMaster),
});
const snapshot = {
  actorAuthUserId: actor,
  receiverRevisionId: revision,
  receiverVersion: 3,
  protectionProfileVersion: 2,
  encryptionKeyVersion: 2,
  fingerprintKeyVersion: 2,
};

function exercise(wrongDigest) {
  const directory = mkdtempSync(join(tmpdir(), 'fetanagent-cbe-key-stage-'));
  try {
    const psql = join(directory, 'psql');
    const ssh = join(directory, 'ssh');
    const marker = join(directory, 'stage-used');
    const privateKeyFile = join(directory, 'deploy-key');
    const knownHostsFile = join(directory, 'known-hosts');
    writeFileSync(
      psql,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(snapshot) + '\n')});\n`,
      { mode: 0o700 },
    );
    writeFileSync(
      ssh,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.join(' ');
if (process.env.OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_SECRET ||
    process.env.OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_SECRET ||
    args.includes(${JSON.stringify(encryptionMaster)}) ||
    args.includes(${JSON.stringify(fingerprintMaster)})) process.exit(3);
if (args.includes(' preflight ')) {
  process.stdout.write('CBE receiver key host preflight passed.\\n');
} else if (args.includes(' stage ')) {
  const lines = fs.readFileSync(0, 'utf8').trimEnd().split('\\n');
  if (lines.length !== 3) process.exit(4);
  const [root, worker, key] = lines.map(JSON.parse);
  if (root.purpose !== 'cbe_birr_receiver_lookup' ||
      worker.receiverRevisionId !== ${JSON.stringify(revision)} ||
      key.receiverRevisionId !== ${JSON.stringify(revision)} ||
      !/^[0-9a-f]{64}$/.test(key.keyHex)) process.exit(5);
  fs.writeFileSync(${JSON.stringify(marker)}, 'yes');
  process.stdout.write('CBE receiver key staged without worker or switch change.\\n');
} else process.exit(6);
`,
      { mode: 0o700 },
    );
    chmodSync(psql, 0o700);
    chmodSync(ssh, 0o700);
    writeFileSync(privateKeyFile, 'synthetic-key', { mode: 0o600 });
    writeFileSync(knownHostsFile, 'synthetic-known-host', { mode: 0o600 });
    chmodSync(privateKeyFile, 0o600);
    chmodSync(knownHostsFile, 0o600);
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CBE_APPROVED_RECEIVER_REVISION_ID: revision,
      CBE_APPROVED_RECEIVER_VERSION: '3',
      OWNER_CBE_BIRR_LOOKUP_PROFILE_V2_JSON: rootProfile,
      OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_SECRET: encryptionMaster,
      OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_SECRET: fingerprintMaster,
      PGSSLROOTCERT: join(directory, 'synthetic-ca'),
      PGPASSWORD: 'synthetic-only-password',
      PGHOST: 'aws-0-eu-west-1.pooler.supabase.com',
      PGPORT: '6543',
      PGDATABASE: 'postgres',
      PGUSER: 'postgres.xzztugbgtulptnbpoelr',
      CBE_EXPECTED_DEPLOYED_RELEASE_SHA: 'a'.repeat(40),
      CBE_HOST_HELPER_SHA256: 'b'.repeat(64),
      PRODUCTION_VM_HOST: 'example.test',
      PRODUCTION_VM_SSH_KEY_FILE: privateKeyFile,
      PRODUCTION_VM_KNOWN_HOSTS_FILE: knownHostsFile,
    };
    const plan = spawnSync(process.execPath, [planScript], {
      encoding: 'utf8',
      timeout: 20_000,
      env,
    });
    assert.equal(plan.status, 0, plan.stderr);
    const digest = plan.stdout.match(/sha256:[0-9a-f]{64}/u)?.[0];
    assert.ok(digest);
    const result = spawnSync(process.execPath, [stageScript], {
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...env,
        CBE_APPROVED_PIN_PLAN_DIGEST: wrongDigest ? `sha256:${'0'.repeat(64)}` : digest,
      },
    });
    return { result, staged: existsSync(marker) && readFileSync(marker, 'utf8') === 'yes' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test(
  'approved production child travels only on protected SSH stdin',
  { skip: process.platform !== 'linux' },
  () => {
    const { result, staged } = exercise(false);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(staged, true);
    assert.equal(
      result.stdout,
      'Production CBE receiver key staged; no worker or payment switch changed.\n',
    );
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, new RegExp(revision, 'u'));
    assert.doesNotMatch(result.stdout, new RegExp(encryptionMaster, 'u'));
  },
);

test('a changed plan digest blocks host staging', { skip: process.platform !== 'linux' }, () => {
  const { result, staged } = exercise(true);
  assert.equal(result.status, 1);
  assert.equal(staged, false);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Production CBE receiver key staging is unavailable.\n');
});
