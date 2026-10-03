import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderProductionOperatorLaunch } from './render-production-operator-launch.mjs';
import { renderActivationDiagnosticDelivery } from './render-activation-diagnostic-delivery.mjs';

const root = new URL('../../', import.meta.url);
const [workflow, sql, receiver, coordinator] = await Promise.all([
  readFile(
    new URL('.github/workflows/production-companion-activation-diagnostic-delivery.yml', root),
    'utf8',
  ),
  readFile(
    new URL('infra/sql/production-companion-activation-diagnostic-request.sql', root),
    'utf8',
  ),
  readFile(new URL('infra/operations/operator-activation-diagnostic-receiver.py', root), 'utf8'),
  readFile(new URL('infra/operations/start-activation-diagnostic-receiver.mjs', root), 'utf8'),
]);

function syntheticDocument() {
  return renderProductionOperatorLaunch({
    PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY: '00000000-0000-4000-8000-000000000001',
    SUPABASE_DB_PASSWORD: 'synthetic:private@credential',
    SUPABASE_CA_CERTIFICATE_PEM:
      '-----BEGIN CERTIFICATE-----\n' + 'A'.repeat(64) + '\n-----END CERTIFICATE-----\n',
    PRODUCTION_COMPANION_RELEASE_TAG: 'windows-companion-v0.1.17',
  });
}

test('private launch document becomes data in a fixed stdin-only program', async () => {
  const raw = Buffer.from(syntheticDocument());
  const source = await renderActivationDiagnosticDelivery(raw);
  const encoded = source.match(/document_bytes=base64\.b64decode\('([A-Za-z0-9+/=]+)'\)/u)?.[1];
  assert.ok(encoded);
  assert.deepEqual(Buffer.from(encoded, 'base64'), raw);
  assert.ok(!source.includes('synthetic:private@credential'));
  assert.match(source, /os\.O_WRONLY \| os\.O_NONBLOCK \| os\.O_NOFOLLOW/u);
  assert.match(source, /stat\.S_ISFIFO/u);
});

test('empty, oversized, malformed, alternate-release, and extra-field documents are rejected', async () => {
  const doc = JSON.parse(syntheticDocument());
  for (const raw of [
    Buffer.alloc(0),
    Buffer.alloc(16 * 1024 + 1),
    Buffer.from('{private-invalid'),
    Buffer.from(JSON.stringify({ ...doc, releaseTag: 'windows-companion-v0.1.18' })),
    Buffer.from(JSON.stringify({ ...doc, requestKey: 'not-an-existing-request' })),
    Buffer.from(JSON.stringify({ ...doc, extra: 'unwanted' })),
    Buffer.from(JSON.stringify({ ...doc, databaseUrl: 'postgresql://wrong.invalid/postgres' })),
  ]) {
    await assert.rejects(
      renderActivationDiagnosticDelivery(raw),
      /Read-only diagnostic delivery unavailable/u,
    );
  }
});

test('CLI errors are fixed and never echo private stdin', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./render-activation-diagnostic-delivery.mjs', import.meta.url))],
    {
      input: 'private-malformed-material',
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Read-only diagnostic delivery unavailable.\n');
});

test('delivery requires exact passing main and never prepares, consumes, activates, or approves', () => {
  assert.match(workflow, /CONFIRMED_COMMIT.*inputs\.confirm_main_commit_sha/u);
  assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA/u);
  assert.match(workflow, /require-production-ci\.mjs/u);
  assert.match(workflow, /Build and smoke dormant protected operator host/u);
  assert.match(workflow, /Build and smoke ingress-free trusted TeleBirr verifier/u);
  assert.match(workflow, /Build and smoke ingress-free no-money TeleBirr shadow verifier/u);
  assert.match(workflow, /default_transaction_read_only=on/u);
  assert.match(workflow, /stored_release/u);
  assert.match(workflow, /render-production-operator-launch\.mjs/u);
  assert.match(workflow, /render-activation-diagnostic-delivery\.mjs/u);
  assert.match(workflow, /ConnectionAttempts=1/u);
  assert.doesNotMatch(
    workflow,
    /operator-session-prepare|randomUUID|workflow run|apply_migration|sudo|docker run|\bretry\b/u,
  );
  assert.match(sql, /BEGIN READ ONLY;/u);
  assert.match(sql, /ROLLBACK;/u);
  assert.match(sql, /j\.attempt_count = 0/u);
  assert.match(sql, /lease_token IS NULL/u);
  assert.match(sql, /deposit_execution_owner_approvals/u);
  assert.match(sql, /AND mode::text = 'disabled'\) = 7/u);
  assert.match(sql, /transaction_read_only/u);
  assert.doesNotMatch(
    sql,
    /\b(?:insert|update|delete|grant|alter|create)\b|pg_read_file|pg_ls_dir|for update|pg_advisory/iu,
  );
});

test('one non-executing image invocation is separate from the unchanged live launcher', () => {
  assert.equal((receiver.match(/"docker", "run"/gu) ?? []).length, 1);
  assert.match(receiver, /IMAGE, "--diagnose-activation"/u);
  assert.match(receiver, /"--read-only", "--log-driver", "none"/u);
  assert.match(receiver, /fcntl\.LOCK_EX \| fcntl\.LOCK_NB/u);
  assert.match(receiver, /credentialDocumentPersisted": False/u);
  assert.match(receiver, /frame\[:\] = b"\\0" \* len\(frame\)/u);
  assert.match(receiver, /signer_copy\.unlink\(\)/u);
  assert.match(receiver, /DELIVERY\.rmdir\(\)/u);
  assert.doesNotMatch(
    receiver,
    /createServer|signHandoff|activate_companion|chmod\(0o777|LAUNCHER\.write|SIGNER\.unlink/u,
  );
  assert.match(coordinator, /run-one-readonly-diagnostic/u);
  assert.match(coordinator, /child\.stderr\.resume\(\)/u);
  assert.match(coordinator, /report\.liveReadinessProven === false/u);
});
