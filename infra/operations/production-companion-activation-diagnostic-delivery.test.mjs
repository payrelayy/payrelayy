import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderProductionOperatorLaunch } from './render-production-operator-launch.mjs';
import { renderActivationDiagnosticDelivery } from './render-activation-diagnostic-delivery.mjs';

const root = new URL('../../', import.meta.url);
const [workflow, sql, poolerSql, receiver, coordinator] = await Promise.all([
  readFile(
    new URL('.github/workflows/production-companion-activation-diagnostic-delivery.yml', root),
    'utf8',
  ),
  readFile(
    new URL('infra/sql/production-companion-activation-diagnostic-request.sql', root),
    'utf8',
  ),
  readFile(
    new URL('infra/sql/production-companion-activation-diagnostic-pooler-request.sql', root),
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
  assert.match(workflow, /pooler_selected/u);
  assert.match(workflow, /selected" == "\$pooler_selected/u);
  assert.match(workflow, /repair-diagnostic-database-ban\.py/u);
  assert.match(workflow, /read-diagnostic-database-source\.py/u);
  assert.match(workflow, /network-bans remove --help/u);
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

const deliveryRun = workflow
  .split("      - name: Repair only this host's database ban and deliver private stdin once")[1]
  .split('        run: |\n')[1]
  .replace(/^ {10}/gmu, '');
const reporter = deliveryRun.match(
  /# Report only fixed public categories, never a failing command or its data\.\n([\s\S]+?)# Begin the unchanged protected delivery; reporting adds no authority\./u,
)?.[1];
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';

test('pooler and direct selectors have identical non-TLS boundaries; direct TLS is unchanged', () => {
  const withoutComments = (source) => source.replace(/^--.*\n/gmu, '').trim();
  const directBackendTls =
    /\n  AND EXISTS \(SELECT 1 FROM pg_catalog\.pg_stat_ssl\n    WHERE pid = pg_catalog\.pg_backend_pid\(\) AND ssl\);/u;
  assert.match(sql, directBackendTls);
  assert.equal(withoutComments(sql).replace(directBackendTls, ';'), withoutComments(poolerSql));
  assert.doesNotMatch(poolerSql, /\b(?:insert|update|delete|grant|alter|create)\b/iu);
  const directRun = deliveryRun.slice(deliveryRun.indexOf('diagnostic_stage=direct_select'));
  assert.match(
    directRun,
    /--file=infra\/sql\/production-companion-activation-diagnostic-request\.sql/u,
  );
  assert.match(directRun, /selected" == "\$pooler_selected/u);
});

test('the actual pooler invocation explicitly requires CA and hostname verification', () => {
  const poolerRun = deliveryRun.slice(
    deliveryRun.indexOf('unset PGHOSTADDR PGSERVICE'),
    deliveryRun.indexOf('diagnostic_stage=pooler_shape'),
  );
  assert.match(poolerRun, /sslmode=verify-full sslrootcert='\$PGSSLROOTCERT'/u);
  assert.match(
    poolerRun,
    /--file=infra\/sql\/production-companion-activation-diagnostic-pooler-request\.sql/u,
  );
  const result = spawnSync(bash, ['--noprofile', '--norc', '-s'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    input: [
      'set -euo pipefail',
      'project_ref=syntheticonlynotprivate',
      'protected=/synthetic-only',
      'SUPABASE_DB_PASSWORD=synthetic-private-password',
      'PGHOSTADDR=unwanted-override PGSERVICE=unwanted-service',
      'timeout() { shift; "$@"; }',
      `psql() {
        [[ -z "\${PGHOSTADDR+x}" && -z "\${PGSERVICE+x}" ]]
        [[ "$PGSSLMODE" == verify-full && "$PGOPTIONS" == '-c default_transaction_read_only=on' ]]
        [[ "$*" == *"sslmode=verify-full sslrootcert='/synthetic-only/supabase-ca.crt'"* ]]
        [[ "$*" == *'host=aws-0-eu-west-1.pooler.supabase.com port=5432 user=postgres.syntheticonlynotprivate dbname=postgres'* ]]
        [[ "$*" == *'--file=infra/sql/production-companion-activation-diagnostic-pooler-request.sql'* ]]
        printf '%s' '{"requestKey":"synthetic-only","companionReleaseSha":"synthetic-only"}'
      }`,
      poolerRun,
      `[[ "$pooler_selected" == '{"requestKey":"synthetic-only","companionReleaseSha":"synthetic-only"}' ]]`,
    ].join('\n'),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

function runReporter(body, { protectedFiles = false, leftover = false } = {}) {
  assert.ok(reporter);
  const temporary = mkdtempSync(join(tmpdir(), 'fetanagent-delivery-report-test-'));
  const protectedDirectory = join(temporary, 'activation-diagnostic-delivery.fixture');
  if (protectedFiles) {
    mkdirSync(protectedDirectory);
    for (const name of ['deploy-key', 'known-hosts', 'supabase-ca.crt']) {
      writeFileSync(join(protectedDirectory, name), 'synthetic-private-material', { mode: 0o600 });
    }
    if (leftover) writeFileSync(join(protectedDirectory, 'unexpected'), 'synthetic-only');
  }
  try {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-s'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      env: {
        ...process.env,
        TEST_RUNNER_TEMP: temporary.replaceAll('\\', '/'),
        TEST_PROTECTED: protectedDirectory.replaceAll('\\', '/'),
        PRIVATE_TEST_MATERIAL: 'synthetic-private-reference-cookie-signature',
      },
      input: [
        'set -euo pipefail',
        'RUNNER_TEMP="$(cd "$TEST_RUNNER_TEMP" && pwd -P)"',
        reporter,
        protectedFiles ? 'protected="$(cd "$TEST_PROTECTED" && pwd -P)"' : '',
        body,
      ].join('\n'),
    });
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, '');
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.ok(!result.stdout.includes('synthetic-private'));
    return {
      status: result.status,
      report: JSON.parse(lines[0]),
      protectedRemoved: protectedFiles && !existsSync(protectedDirectory),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

test('the full delivery shell parses and every fixed failure stage produces only public JSON', () => {
  const syntax = spawnSync(bash, ['--noprofile', '--norc', '-n'], {
    input: deliveryRun,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(syntax.status, 0, syntax.stderr);
  const stages = [
    ...new Set([...deliveryRun.matchAll(/diagnostic_stage=([a-z_]+)/gu)].map((m) => m[1])),
  ];
  assert.ok(stages.includes('host_input') && stages.includes('pooler_shape'));
  assert.ok(stages.includes('source_inspection') && stages.includes('cleanup'));
  for (const stage of stages) {
    const result = runReporter(`diagnostic_stage=${stage}\nfalse`);
    assert.equal(result.status, 1, stage);
    assert.deepEqual(result.report, {
      component: 'fetanagent_activation_diagnostic_delivery',
      result: 'stopped',
      stage,
      deliveryAttempted: false,
      deliveryConfirmed: false,
      moneyMoved: false,
      identifiersRedacted: true,
    });
  }
  assert.doesNotMatch(reporter, /BASH_COMMAND|set -x|SUPABASE_DB_PASSWORD|PRODUCTION_VM_HOST/u);
  assert.ok(
    deliveryRun.indexOf('trap cleanup EXIT') < deliveryRun.indexOf('[[ "$PRODUCTION_VM_HOST"'),
  );
});

test('unknown stage data is redacted and private-delivery acknowledgement is not guessed', () => {
  const unknown = runReporter('diagnostic_stage="$PRIVATE_TEST_MATERIAL"\nfalse');
  assert.equal(unknown.report.stage, 'unknown_guard');
  const attempted = runReporter(
    'diagnostic_stage=private_delivery\ndelivery_attempted=true\nfalse',
  );
  assert.equal(attempted.report.deliveryAttempted, true);
  assert.equal(attempted.report.deliveryConfirmed, false);
  const zeroExit = runReporter('diagnostic_stage=pooler_shape\nexit 0');
  assert.equal(zeroExit.status, 1);
  assert.equal(zeroExit.report.result, 'stopped');
});

test('cleanup runs before the report and uncertainty overrides a confirmed delivery', () => {
  const body =
    'diagnostic_stage=delivered\ndelivery_attempted=true\ndelivery_confirmed=true\nexit 0';
  const clean = runReporter(body, { protectedFiles: true });
  assert.equal(clean.status, 0);
  assert.equal(clean.report.result, 'passed');
  assert.equal(clean.report.stage, 'delivered');
  assert.equal(clean.protectedRemoved, true);
  const uncertain = runReporter(body, { protectedFiles: true, leftover: true });
  assert.equal(uncertain.status, 1);
  assert.equal(uncertain.report.result, 'stopped');
  assert.equal(uncertain.report.stage, 'cleanup');
  assert.equal(uncertain.report.deliveryConfirmed, true);
  assert.equal(uncertain.protectedRemoved, false);
});
