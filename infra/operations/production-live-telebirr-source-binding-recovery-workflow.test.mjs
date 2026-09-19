import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const [workflow, migration, postEmergencyMigration, eligibility, arm, status, close, helper] =
  await Promise.all(
    [
      '.github/workflows/production-live-telebirr-source-binding-recovery.yml',
      'supabase/migrations/20260919173000_recover_reviewed_telebirr_source_binding.sql',
      'supabase/migrations/20260919181500_allow_post_emergency_telebirr_source_binding_recovery.sql',
      'infra/sql/production-live-telebirr-source-binding-recovery-eligibility.sql',
      'infra/sql/production-live-telebirr-source-binding-recovery-arm.sql',
      'infra/sql/production-live-telebirr-source-binding-recovery-status.sql',
      'infra/sql/production-live-telebirr-source-binding-recovery-close.sql',
      'infra/operations/fetanagent-production-trusted-telebirr-verifier-helper.sh',
    ].map((path) => readFile(new URL(path, root), 'utf8')),
  );

test('requires reviewed main, production protection, CI, and disabled KemerBet', () => {
  assert.match(workflow, /environment: production/u);
  assert.ok(workflow.includes('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]'));
  assert.ok(workflow.includes('node infra/operations/require-production-ci.mjs'));
  assert.ok(workflow.includes('RECOVER ONE REVIEWED TELEBIRR SOURCE BINDING - KEMERBET DISABLED'));
  assert.ok(workflow.includes('PGSSLMODE: verify-full'));
});

test('records one append-only 12-hour supersession without mutating the original binding', () => {
  for (const fragment of [
    'app.private_live_telebirr_source_binding_recovery_retries',
    'app.private_live_telebirr_source_binding_recovery_closures',
    "reason_code = 'source_binding_supersession_after_nonfinancial_review'",
    "expires_at >= authorized_at + interval '12 hours'",
    "armed_until := armed_at + interval '12 hours'",
    "prior_outcome.disposition <> 'review_required'",
    "prior_outcome.reason_code <> 'source_unavailable'",
    "authority_closure.reason_code <> 'operator_stop'",
    'prior_observation.normalized_facts_digest is distinct from',
    "'original_binding_preserved', true",
    "'execution_enabled', false",
  ]) {
    assert.ok(migration.includes(fragment));
  }
  assert.doesNotMatch(migration, /update\s+app\.private_live_telebirr_source_document_bindings/iu);
  assert.doesNotMatch(
    migration,
    /delete\s+from\s+app\.private_live_telebirr_source_document_bindings/iu,
  );
  assert.ok(!migration.includes('to fetanagent_deposit_executor;'));
  assert.ok(!migration.includes('to fetanagent_deposit_executor_runtime;'));
});

test('accepts only the exact all-disabled post-emergency source-binding boundary', () => {
  for (const fragment of [
    'app.is_private_live_telebirr_source_binding_post_emergency_ready',
    "activation_epoch.revocation_reason_code = 'execution_uncertainty'",
    'activation_epoch.revoked_at is not distinct from emergency_intent.requested_at',
    "pilot.status = 'stopped'",
    "feature_switch.mode = 'disabled'",
    "feature_switch.settings = '{}'::jsonb",
    ') = 7',
    'staged.observed_at < emergency_intent.requested_at',
    'staged.staged_at < emergency_intent.requested_at',
    "armed_until := armed_at + interval '12 hours'",
    'and not post_emergency_authority',
  ]) {
    assert.ok(postEmergencyMigration.includes(fragment), fragment);
  }
  assert.doesNotMatch(postEmergencyMigration, /update\s+app\.feature_switches/iu);
  assert.doesNotMatch(postEmergencyMigration, /alter\s+role\s+fetanagent_deposit_executor/iu);
  assert.ok(workflow.includes('.authorityBoundary == "post_emergency"'));
  assert.ok(workflow.includes('.financialSwitchesLive == 0'));
  assert.ok(workflow.includes('.financialSwitchesDisabled == 7'));
});

test('patches only source-exact reviewed predecessor function markers', () => {
  const markers = [...postEmergencyMigration.matchAll(/\$marker\$([\s\S]*?)\$marker\$/gu)].map(
    (match) => match[1],
  );
  expectExactMarkerCount(markers.length, 5);
  for (const marker of markers) {
    expectExactMarkerCount(migration.split(marker).length - 1, 1);
  }
});

function expectExactMarkerCount(actual, expected) {
  assert.equal(actual, expected);
}

test('requires the exact prior nonfinancial and current one-attempt shapes', () => {
  for (const fragment of [
    '.attempts == 1',
    '.assignmentTranscripts == 1',
    '.assignmentDeliveries == 1',
    '.deviceEvidence == 1',
    'priorAttempts',
    'priorAssignmentTranscripts',
    'priorAssignmentDeliveries',
    'priorDeviceEvidence',
    'priorObservations',
    'priorNonfinancialReviews',
    '.sourceBindingRetries == 1',
    '.authorityConsumptions == 1',
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
});

test('uses redacted read-only preflight and fail-closed cleanup', () => {
  for (const path of [
    'infra/sql/production-live-telebirr-source-binding-recovery-eligibility.sql',
    'infra/sql/production-live-telebirr-source-binding-recovery-arm.sql',
    'infra/sql/production-live-telebirr-source-binding-recovery-status.sql',
    'infra/sql/production-live-telebirr-source-binding-recovery-close.sql',
  ]) {
    assert.ok(workflow.includes(path));
  }
  assert.ok(workflow.includes('trap cleanup EXIT'));
  assert.ok(workflow.includes('close_database completed'));
  assert.ok(workflow.includes("reason='operator_stop'"));
  assert.ok(workflow.includes("sudo -n '$helper' emergency-stop"));
  assert.ok(workflow.includes("sudo -n '$helper' start-activated"));
  assert.ok(workflow.includes('.verifierLoginDisabled == true'));

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
});

test('host startup reports only the allowlisted redacted verifier failure stage', () => {
  assert.ok(helper.includes('report_redacted_verifier_failure_stage'));
  assert.ok(
    helper.includes(
      '^FetanAgent trusted TeleBirr verifier failed closed at stage: (load_staged_evidence|',
    ),
  );
  assert.ok(helper.includes('2>/dev/null'));
  assert.ok(!helper.includes('docker container logs --tail 80 "$container_id" >&2'));
});
