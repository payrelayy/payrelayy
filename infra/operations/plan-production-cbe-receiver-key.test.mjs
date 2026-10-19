import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./plan-production-cbe-receiver-key.mjs', import.meta.url));
const receiverRevisionId = 'b70a1fe4-420b-4e66-9b04-ec706cd87be3';
const actorAuthUserId = 'f32441c2-510c-4e28-9843-95dbe06612fe';
const encryptionMasterSecret = '11'.repeat(32);
const fingerprintMasterSecret = '22'.repeat(32);
const digest = (hex) =>
  `sha256:${createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')}`;
const profile = JSON.stringify({
  version: 2,
  purpose: 'cbe_birr_receiver_lookup',
  encryptionMasterFingerprint: digest(encryptionMasterSecret),
  fingerprintMasterFingerprint: digest(fingerprintMasterSecret),
});
const snapshot = {
  actorAuthUserId,
  receiverRevisionId,
  receiverVersion: 3,
  protectionProfileVersion: 2,
  encryptionKeyVersion: 2,
  fingerprintKeyVersion: 2,
};

function runPlan(drift = false) {
  const directory = mkdtempSync(join(tmpdir(), 'fetanagent-cbe-key-plan-'));
  try {
    const fakePsql = join(directory, 'psql');
    writeFileSync(
      fakePsql,
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = ${JSON.stringify(join(directory, 'count'))};
const count = fs.existsSync(path) ? Number(fs.readFileSync(path, 'utf8')) + 1 : 1;
fs.writeFileSync(path, String(count));
const snapshot = ${JSON.stringify(snapshot)};
if (${drift} && count > 1) snapshot.receiverVersion++;
process.stdout.write(JSON.stringify(snapshot) + '\\n');
`,
      { mode: 0o700 },
    );
    chmodSync(fakePsql, 0o700);
    return spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        CBE_APPROVED_RECEIVER_REVISION_ID: receiverRevisionId,
        CBE_APPROVED_RECEIVER_VERSION: '3',
        OWNER_CBE_BIRR_LOOKUP_PROFILE_V2_JSON: profile,
        OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_SECRET: encryptionMasterSecret,
        OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_SECRET: fingerprintMasterSecret,
        PGSSLROOTCERT: join(directory, 'synthetic-ca'),
        PGPASSWORD: 'synthetic-only-password',
        PGHOST: 'aws-0-eu-west-1.pooler.supabase.com',
        PGPORT: '6543',
        PGDATABASE: 'postgres',
        PGUSER: 'postgres.xzztugbgtulptnbpoelr',
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test(
  'production plan emits only a nonsecret pin digest',
  { skip: process.platform !== 'linux' },
  () => {
    const result = runPlan();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^production_cbe_receiver_key_pin_plan=sha256:[0-9a-f]{64}\n$/u);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, new RegExp(encryptionMasterSecret, 'u'));
    assert.doesNotMatch(result.stdout, new RegExp(receiverRevisionId, 'u'));
  },
);

test(
  'production plan fails closed when the active revision drifts',
  { skip: process.platform !== 'linux' },
  () => {
    const result = runPlan(true);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Production CBE receiver key plan is unavailable.\n');
  },
);
