import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const [workflow, migration, eligibility, arm, status, close, stagingWorkflow] = await Promise.all(
  [
    '.github/workflows/production-live-telebirr-expired-evidence-recovery.yml',
    'supabase/migrations/20260918033000_recover_expired_live_telebirr_evidence.sql',
    'infra/sql/production-live-telebirr-expired-evidence-eligibility.sql',
    'infra/sql/production-live-telebirr-expired-evidence-arm.sql',
    'infra/sql/production-live-telebirr-expired-evidence-status.sql',
    'infra/sql/production-live-telebirr-expired-evidence-close.sql',
    '.github/workflows/production-trusted-telebirr-verifier.yml',
  ].map((path) => readFile(new URL(path, root), 'utf8')),
);

test('requires reviewed main, production protection, CI, and explicit KemerBet-disabled approval', () => {
  assert.match(workflow, /environment: production/u);
  assert.ok(workflow.includes('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]'));
  assert.ok(
    workflow.includes(
      '[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ && "$CONFIRMED_COMMIT" == "$GITHUB_SHA" ]]',
    ),
  );
  assert.ok(workflow.includes('RECOVER EXPIRED LIVE TELEBIRR EVIDENCE - KEMERBET DISABLED'));
  assert.ok(workflow.includes('node infra/operations/require-production-ci.mjs'));
  assert.ok(workflow.includes('SUPABASE_CA_CERTIFICATE_PEM'));
  assert.ok(workflow.includes('PGSSLMODE: verify-full'));
});

test('uses only the reviewed eligibility, one-use arm, status, and fail-closed operations', () => {
  for (const path of [
    'infra/sql/production-live-telebirr-expired-evidence-eligibility.sql',
    'infra/sql/production-live-telebirr-expired-evidence-arm.sql',
    'infra/sql/production-live-telebirr-expired-evidence-status.sql',
    'infra/sql/production-live-telebirr-expired-evidence-close.sql',
  ]) {
    assert.ok(workflow.includes(path));
  }
  assert.ok(workflow.includes('create-production-trusted-telebirr-runtime-credential.mjs'));
  assert.ok(workflow.includes('trap cleanup EXIT'));
  assert.ok(workflow.includes('close_database completed'));
  assert.ok(workflow.includes("reason='operator_stop'"));
  assert.ok(workflow.includes("if [[ \"$queue_observed\" == '1' ]]; then reason='completed'; fi"));
  assert.ok(workflow.includes("sudo -n '$helper' emergency-stop"));
  assert.ok(workflow.includes("sudo -n '$helper' prepare-activation"));
  assert.ok(workflow.includes("sudo -n '$helper' start-activated"));
  assert.ok(workflow.includes("sudo -n '$helper' discard-activation"));
  assert.ok(workflow.includes('.verifierLoginDisabled == true'));
});

test('stops at exactly one untouched queue item and never enables or invokes KemerBet', () => {
  for (const fragment of [
    '.attempts == 4',
    '.assignmentTranscripts == 2',
    '.assignmentDeliveries == 2',
    '.deviceEvidence == 2',
    '.observations == 1',
    '.outcomes == 1',
    '.authorityConsumptions == 1',
    '.authorityClosures == 1',
    '.reservations == 1',
    '.settlementReceipts == 1',
    '.settlementDocuments == 1',
    '.depositExecutionJobs == 1',
    '.queuedDepositJobs == 1',
    '.trustedVerifierSessions == 0',
    '.kemerBetLoginRoles == 0',
    '.kemerBetSessions == 0',
    '.executionEnabled == false',
  ]) {
    assert.ok(workflow.includes(fragment));
  }
  assert.doesNotMatch(workflow, /alter\s+role\s+fetanagent_deposit_executor/iu);
  assert.doesNotMatch(workflow, /update\s+app\.feature_switches/iu);
  assert.ok(!workflow.includes('production-runtime.yml'));
  assert.ok(!workflow.includes('fetanagent_deposit_executor_runtime='));
  assert.ok(!workflow.includes('sourceDocumentDigest'));
  assert.ok(!workflow.includes('transactionReference'));
});

test('database recovery is one-target, append-only, bounded, and verifier-only', () => {
  for (const fragment of [
    'create table app.private_live_telebirr_historical_completion_authorities',
    'create table app.private_live_telebirr_historical_completion_consumptions',
    'create table app.private_live_telebirr_historical_completion_closures',
    'before update or delete on app.private_live_telebirr_historical_completion_authorities',
    'before truncate on app.private_live_telebirr_historical_completion_authorities',
    "expires_at > authorized_at + interval '8 minutes'",
    "expires_at <= authorized_at + interval '20 minutes'",
    'app.is_private_live_telebirr_historical_attempt_authorized',
    'app.consume_private_live_telebirr_historical_completion',
    'app.disable_private_trusted_telebirr_verifier_login()',
    "'historicalCompletionRecovery', true",
    "'evidenceStagedAt', staged_at",
    "'or p_assessed_at >= attempt.expires_at'",
    'and role.rolpassword is not distinct from p_scram_verifier',
    'and job.attempt_count = 0',
    'and job.lease_token is null',
    'and job.leased_by is null',
    'and job.lease_expires_at is null',
    'and job.last_error_code is null',
    'and job.completed_at is null',
  ]) {
    assert.ok(migration.includes(fragment));
  }
  assert.ok(migration.includes('to fetanagent_trusted_telebirr_verifier;'));
  assert.ok(!migration.includes('to fetanagent_deposit_executor;'));
  assert.ok(!migration.includes('to fetanagent_deposit_executor_runtime;'));
  assert.ok(!migration.includes('grant execute on function app.arm_private_live'));
});

test('operation SQL emits redacted state only and checks an untouched queue', () => {
  for (const source of [eligibility, arm, status, close]) {
    assert.ok(source.includes("'deploymentTarget', 'production'"));
    assert.ok(source.includes('kemerBetLoginRoles'));
    assert.ok(source.includes('kemerBetSessions'));
    assert.ok(!source.includes("'verificationJobId',"));
    assert.ok(!source.includes("'sourceDocumentDigest',"));
    assert.ok(!source.includes("'requestKey',"));
  }
  for (const fragment of [
    "execution_job.status = 'queued'",
    'execution_job.attempt_count = 0',
    'execution_job.lease_token is null',
    'execution_job.leased_by is null',
    'execution_job.lease_expires_at is null',
    'execution_job.last_error_code is null',
    'execution_job.completed_at is null',
  ]) {
    assert.ok(status.includes(fragment));
  }
  assert.ok(eligibility.includes("'readOnly', true"));
  assert.ok(eligibility.includes("'moneyMoved', false"));
  assert.ok(arm.includes('app.arm_private_live_telebirr_historical_completion'));
  assert.ok(close.includes('app.close_private_live_telebirr_historical_completion'));
});

test('staging fences and stops any prior verifier before replacing its sealed release', () => {
  assert.ok(
    stagingWorkflow.includes(
      "sudo -n '$helper' verify '$HELPER_SHA' && sudo -n '$helper' emergency-stop && sudo -n '$helper' preflight '$bytes'",
    ),
  );
  assert.ok(
    stagingWorkflow.includes(
      'The prior verifier process was fenced and stopped, then the immutable production verifier release was staged',
    ),
  );
});
