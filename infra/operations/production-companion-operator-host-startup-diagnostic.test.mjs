import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { assertDormantStartupBoundary } from './operator-startup-diagnostic-boundary.mjs';

const root = new URL('../../', import.meta.url);
const [workflow, host] = await Promise.all([
  readFile(
    new URL('.github/workflows/production-companion-operator-host-startup-diagnostic.yml', root),
    'utf8',
  ),
  readFile(new URL('packages/agent-platform-companion-operator-host/src/index.ts', root), 'utf8'),
]);

test('startup diagnostic is exact-main, read-only, and never opens an execution session', () => {
  assert.match(workflow, /require-production-ci\.mjs/u);
  assert.match(workflow, /default_transaction_read_only=on/u);
  assert.match(workflow, /operator-startup-diagnostic-boundary\.mjs/u);
  assert.match(workflow, /PRODUCTION_OPERATOR_IMAGE_REVISION: \(\[0-9a-f\]\{40\}\)/u);
  assert.match(workflow, /inspect '\$revision'/u);
  assert.match(workflow, /diagnose '\$revision'/u);
  assert.match(workflow, /stop '\$revision'/u);
  assert.doesNotMatch(workflow, /(?:inspect|diagnose|stop) '\$GITHUB_SHA'/u);
  assert.match(workflow, /protected_operator_diagnostic=ready/u);
  assert.doesNotMatch(workflow, /operator-session-prepare|\bactivate\b|deposit-job-execute/u);

  const diagnostic = host.slice(
    host.indexOf('export async function diagnoseOperatorHost('),
    host.indexOf(
      '/** A container-private, one-shot process:',
      host.indexOf('diagnoseOperatorHost('),
    ),
  );
  assert.match(diagnostic, /begin read only/u);
  assert.match(diagnostic, /runPsql\('probe'/u);
  assert.match(diagnostic, /createServer\(\)/u);
  assert.doesNotMatch(
    diagnostic,
    /runPsql\('disable'|openProtectedOperatorQueryHost|createProtectedOperatorBootstrapRequestHandler|signHandoff/u,
  );
});

const dormant = {
  readOnly: true,
  identifiersRedacted: true,
  readinessOnly: true,
  activationAvailable: false,
  allFinancialSwitchesDisabled: true,
  companionExecutionControlDisabled: true,
  executionCapabilityDormant: true,
  companionExecutionRecords: 0,
  openJobs: 0,
};
const preserved = {
  ...dormant,
  openJobs: 1,
  untouchedQueuedJobs: 1,
  stoppedPilotUntouchedJob: true,
  pilotState: 'stopped',
  effectiveTrustedEpochAvailable: false,
  openExecutionReviewCases: 0,
  customerResolutionPending: false,
};

test('preserves the empty-queue default and requires explicit stopped-job scope', () => {
  assert.match(workflow, /default: empty_queue/u);
  assert.doesNotThrow(() => assertDormantStartupBoundary(dormant, 'empty_queue'));
  assert.doesNotThrow(() =>
    assertDormantStartupBoundary(preserved, 'preserve_one_stopped_pilot_job'),
  );
  assert.throws(() => assertDormantStartupBoundary(preserved, 'empty_queue'));
  assert.throws(() => assertDormantStartupBoundary(dormant, 'preserve_one_stopped_pilot_job'));
  assert.throws(() => assertDormantStartupBoundary(preserved, 'anything_else'));
});

test('rejects financial authority, execution records, and malformed guard values', () => {
  for (const change of [
    { readOnly: false },
    { identifiersRedacted: false },
    { readinessOnly: false },
    { activationAvailable: true },
    { allFinancialSwitchesDisabled: false },
    { companionExecutionControlDisabled: false },
    { executionCapabilityDormant: false },
    { companionExecutionRecords: 1 },
    { allFinancialSwitchesDisabled: 'true' },
    { companionExecutionRecords: '0' },
    { readOnly: undefined },
  ]) {
    for (const [status, scope] of [
      [dormant, 'empty_queue'],
      [preserved, 'preserve_one_stopped_pilot_job'],
    ]) {
      assert.throws(() => assertDormantStartupBoundary({ ...status, ...change }, scope));
    }
  }
  for (const status of [null, undefined, [], true]) {
    assert.throws(() => assertDormantStartupBoundary(status, 'empty_queue'));
  }
});

test('rejects touched, competing, active-pilot, and unresolved jobs', () => {
  for (const change of [
    { openJobs: 2 },
    { openJobs: 0 },
    { untouchedQueuedJobs: 0 },
    { untouchedQueuedJobs: 2 },
    { stoppedPilotUntouchedJob: false },
    { pilotState: 'armed' },
    { effectiveTrustedEpochAvailable: true },
    { openExecutionReviewCases: 1 },
    { customerResolutionPending: true },
    { stoppedPilotUntouchedJob: undefined },
  ]) {
    assert.throws(() =>
      assertDormantStartupBoundary({ ...preserved, ...change }, 'preserve_one_stopped_pilot_job'),
    );
  }
});

test('checks the same no-money and private queue fingerprint boundary before and after the probe', () => {
  const probe = workflow.indexOf('attempted=1');
  assert.ok(workflow.indexOf('before_queue="$(queue_fingerprint)"') < probe);
  assert.ok(workflow.indexOf('assert_boundary\n') < probe);
  assert.ok(workflow.lastIndexOf('assert_boundary\n') > probe);
  assert.ok(workflow.indexOf('[[ "$(queue_fingerprint)" == "$before_queue" ]]') > probe);
  assert.match(workflow, /pg_catalog\.sha256\(pg_catalog\.convert_to\(job::text,'UTF8'\)\)/u);
  assert.match(workflow, /app\.deposit_execution_owner_approvals/u);
  assert.match(workflow, /app\.deposit_execution_attempts/u);
  assert.match(workflow, /fetanagent_companion_execution_bridge/u);
  assert.match(workflow, /pg_catalog\.pg_stat_activity/u);
  assert.match(workflow, /port=5432.*sslmode=verify-full.*sslrootcert=/u);
  assert.match(workflow, /unset PGHOSTADDR PGSERVICE/u);
  assert.doesNotMatch(workflow, /\b(?:insert|update|delete|truncate)\s+(?:into\s+)?app\./iu);
  assert.doesNotMatch(workflow, /\$launcher' run /u);
  assert.doesNotMatch(workflow, /production-companion-operator-session-prepare\.sql/u);
  assert.match(workflow, /liveExecutionReadinessProven\\?":false/u);
  assert.match(workflow, /requestCreated\\?":false/u);
});

test('CLI emits only fixed categories and never the private input', () => {
  const secret = 'private-diagnostic-input-must-not-be-printed';
  const run = (input, scope = 'preserve_one_stopped_pilot_job') =>
    spawnSync(
      process.execPath,
      ['infra/operations/operator-startup-diagnostic-boundary.mjs', scope],
      {
        cwd: root,
        input,
        encoding: 'utf8',
      },
    );
  const passed = run(JSON.stringify({ ...preserved, privateValue: secret }));
  assert.equal(passed.status, 0);
  assert.equal(passed.stdout, 'dormant_startup_boundary=ready\n');
  assert.equal(passed.stderr, '');
  for (const input of [
    secret,
    JSON.stringify({ ...preserved, allFinancialSwitchesDisabled: false, privateValue: secret }),
    JSON.stringify({ ...preserved, privateValue: secret.repeat(1000) }),
  ]) {
    const failed = run(input);
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.equal(failed.stderr, 'The dormant startup boundary is unavailable.\n');
    assert.equal((failed.stdout + failed.stderr).includes(secret), false);
  }
});

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/usr/bin/bash';
const startupRun = workflow
  .slice(workflow.indexOf('      - name: Classify existing host startup'))
  .split('        run: |\n')[1]
  ?.replace(/^          /gmu, '');

test('the real startup shell parses and fingerprint failures cannot escape a command substitution', () => {
  assert.ok(startupRun);
  const syntax = spawnSync(bash, ['--noprofile', '--norc', '-n'], {
    input: startupRun,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(syntax.status, 0, syntax.stderr);
  const fingerprintFunction = startupRun.slice(
    startupRun.indexOf('queue_fingerprint() {'),
    startupRun.indexOf('\nassert_boundary\n'),
  );
  for (const [scope, response, queryStatus, expectedStatus] of [
    ['preserve_one_stopped_pilot_job', 'a'.repeat(64), 0, 0],
    ['preserve_one_stopped_pilot_job', '', 0, 1],
    ['preserve_one_stopped_pilot_job', 'private-malformed-input', 0, 1],
    ['preserve_one_stopped_pilot_job', 'a'.repeat(64) + '\n' + 'b'.repeat(64), 0, 1],
    ['preserve_one_stopped_pilot_job', '', 1, 1],
    ['empty_queue', '', 0, 0],
    ['empty_queue', 'a'.repeat(64), 0, 1],
  ]) {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-s'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      env: {
        ...process.env,
        TEST_QUERY_RESPONSE: response,
        TEST_QUERY_STATUS: String(queryStatus),
        DIAGNOSTIC_JOB_SCOPE: scope,
      },
      input: [
        'set -euo pipefail',
        'pooler_query() { printf "%s" "$TEST_QUERY_RESPONSE"; return "$TEST_QUERY_STATUS"; }',
        fingerprintFunction,
        'private_fingerprint="$(queue_fingerprint)"',
      ].join('\n'),
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('the real reporter redacts unknown failures and cleanup uncertainty overrides readiness', () => {
  assert.ok(startupRun);
  const reporter = startupRun.slice(
    startupRun.indexOf('diagnostic_stage=host_input'),
    startupRun.indexOf('[[ "$PRODUCTION_VM_HOST"'),
  );
  const stages = [
    ...new Set([...startupRun.matchAll(/diagnostic_stage=([a-z_]+)/gu)].map((match) => match[1])),
  ];
  const run = (body, cleanupStatus = '0') => {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-s'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      env: {
        ...process.env,
        PRODUCTION_VM_HOST: 'synthetic-private-host',
        TEST_CLEANUP_STATUS: cleanupStatus,
        PRIVATE_TEST_INPUT: 'private-input-must-not-appear',
      },
      input: [
        'set -euo pipefail',
        'ssh_opts=()',
        'timeout() { return "$TEST_CLEANUP_STATUS"; }',
        reporter,
        body,
      ].join('\n'),
    });
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes('private-'), false);
    return { status: result.status, report: JSON.parse(result.stdout.trim()) };
  };
  for (const stage of stages) {
    const result = run(`diagnostic_stage=${stage}\nfalse`);
    assert.equal(result.status, 1);
    assert.equal(result.report.result, 'stopped');
    assert.equal(result.report.stage, stage);
    assert.equal(result.report.moneyMoved, false);
    assert.equal(result.report.requestCreated, false);
    assert.equal(result.report.diagnosisAttempted, false);
  }
  assert.equal(run('diagnostic_stage="$PRIVATE_TEST_INPUT"\nfalse').report.stage, 'unknown_guard');
  assert.equal(run('diagnostic_stage=pooler_status\nexit 0').status, 1);
  const ready =
    'diagnostic_stage=ready\nattempted=1\ndependencies_ready=true\nqueue_unchanged=true\nexit 0';
  const passed = run(ready);
  assert.equal(passed.status, 0);
  assert.equal(passed.report.result, 'passed');
  assert.equal(passed.report.liveExecutionReadinessProven, false);
  assert.equal(passed.report.cleanupConfirmed, true);
  const uncertain = run(ready, '1');
  assert.equal(uncertain.status, 1);
  assert.equal(uncertain.report.stage, 'cleanup');
  assert.equal(uncertain.report.cleanupConfirmed, false);
});
