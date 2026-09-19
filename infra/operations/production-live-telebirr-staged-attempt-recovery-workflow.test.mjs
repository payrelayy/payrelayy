import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const [workflow, migration, eligibility, arm, status, close, application] = await Promise.all(
  [
    '.github/workflows/production-live-telebirr-staged-attempt-recovery.yml',
    'supabase/migrations/20260919160000_recover_single_expired_live_telebirr_attempt.sql',
    'infra/sql/production-live-telebirr-staged-attempt-eligibility.sql',
    'infra/sql/production-live-telebirr-staged-attempt-arm.sql',
    'infra/sql/production-live-telebirr-staged-attempt-status.sql',
    'infra/sql/production-live-telebirr-staged-attempt-close.sql',
    'apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-application.ts',
  ].map((path) => readFile(new URL(path, root), 'utf8')),
);

test('requires reviewed main, production protection, CI, and KemerBet-disabled approval', () => {
  assert.match(workflow, /environment: production/u);
  assert.ok(workflow.includes('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]'));
  assert.ok(workflow.includes('node infra/operations/require-production-ci.mjs'));
  assert.ok(workflow.includes('RECOVER ONE STAGED TELEBIRR ATTEMPT - KEMERBET DISABLED'));
  assert.ok(workflow.includes('PGSSLMODE: verify-full'));
});

test('uses one exact 12-hour, append-only, verifier-only authority', () => {
  for (const fragment of [
    "'expired_attempt_staged_evidence_completion'",
    "expires_at >= authorized_at + interval '12 hours'",
    "armed_until := armed_at + interval '12 hours'",
    'app.arm_private_live_telebirr_staged_attempt_completion',
    'app.disable_private_trusted_telebirr_verifier_login()',
    "job.recovery_reason_code = 'assignment_runtime_unavailable'",
    'and role.rolpassword is not distinct from p_scram_verifier',
    "'execution_enabled', false",
  ]) {
    assert.ok(migration.includes(fragment));
  }
  assert.ok(migration.includes('to fetanagent_trusted_telebirr_verifier;'));
  assert.ok(!migration.includes('to fetanagent_deposit_executor;'));
  assert.ok(!migration.includes('to fetanagent_deposit_executor_runtime;'));
  assert.ok(!migration.includes('grant execute on function app.arm_private_live'));
});

test('requires the exact one-attempt shape and stops at one untouched queue item', () => {
  for (const fragment of [
    '.attempts == 1',
    '.assignmentTranscripts == 1',
    '.assignmentDeliveries == 1',
    '.deviceEvidence == 1',
    '.authorityConsumptions == 1',
    '.authorityClosures == 1',
    '.reservations == 1',
    '.settlementReceipts == 1',
    '.settlementDocuments == 1',
    '.depositExecutionJobs == 1',
    '.queuedDepositJobs == 1',
    '.kemerBetLoginRoles == 0',
    '.kemerBetSessions == 0',
    '.executionEnabled == false',
  ]) {
    assert.ok(workflow.includes(fragment));
  }
  assert.ok(workflow.includes('.remainingSeconds | type == "number" and . >= 43140'));
  assert.doesNotMatch(workflow, /alter\s+role\s+fetanagent_deposit_executor/iu);
  assert.doesNotMatch(workflow, /update\s+app\.feature_switches/iu);
  assert.ok(!workflow.includes('sourceDocumentDigest'));
  assert.ok(!workflow.includes('transactionReference'));
});

test('uses reviewed preflight, arm, status, close, and fail-closed cleanup', () => {
  for (const path of [
    'infra/sql/production-live-telebirr-staged-attempt-eligibility.sql',
    'infra/sql/production-live-telebirr-staged-attempt-arm.sql',
    'infra/sql/production-live-telebirr-staged-attempt-status.sql',
    'infra/sql/production-live-telebirr-staged-attempt-close.sql',
  ]) {
    assert.ok(workflow.includes(path));
  }
  assert.ok(workflow.includes('trap cleanup EXIT'));
  assert.ok(workflow.includes('close_database completed'));
  assert.ok(workflow.includes("reason='operator_stop'"));
  assert.ok(workflow.includes("sudo -n '$helper' emergency-stop"));
  assert.ok(workflow.includes("sudo -n '$helper' start-activated"));
  assert.ok(workflow.includes('.verifierLoginDisabled == true'));
});

test('operation SQL is redacted and eligibility remains read-only', () => {
  for (const source of [eligibility, arm, status, close]) {
    assert.ok(source.includes("'deploymentTarget', 'production'"));
    assert.ok(source.includes('kemerBetLoginRoles'));
    assert.ok(source.includes('kemerBetSessions'));
    assert.ok(!source.includes("'verificationJobId',"));
    assert.ok(!source.includes("'sourceDocumentDigest',"));
    assert.ok(!source.includes("'requestKey',"));
  }
  assert.ok(eligibility.includes('begin transaction isolation level read committed read only;'));
  assert.ok(eligibility.includes("'readOnly', true"));
  assert.ok(eligibility.includes("'moneyMoved', false"));
  assert.doesNotMatch(eligibility, /\bfor\s+(?:share|update)\b/iu);
  assert.ok(status.includes("execution_job.status = 'queued'"));
});

test('production verifier emits only an enum-like redacted failure stage', () => {
  assert.ok(application.includes('onFailureStage:'));
  assert.ok(
    application.includes('FetanAgent trusted TeleBirr verifier failed closed at stage: ${stage}.'),
  );
  assert.ok(!application.includes('${error}'));
  assert.ok(!application.includes('${error.message}'));
});
