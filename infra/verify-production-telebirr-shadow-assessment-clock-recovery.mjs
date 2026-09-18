import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-telebirr-shadow-assessment-clock-recovery.yml',
    import.meta.url,
  ),
  'utf8',
);
const preflight = readFileSync(
  new URL('./sql/production-telebirr-shadow-assessment-clock-preflight.sql', import.meta.url),
  'utf8',
);
const operation = readFileSync(
  new URL('./sql/production-telebirr-shadow-assessment-clock-recovery.sql', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20260919090000_preserve_telebirr_shadow_assessment_submission_clock.sql',
    import.meta.url,
  ),
  'utf8',
);
const onceWorkflow = readFileSync(
  new URL('../.github/workflows/production-telebirr-shadow-once.yml', import.meta.url),
  'utf8',
);
const onceProvision = readFileSync(
  new URL('./sql/production-telebirr-shadow-verifier-once-provision.sql', import.meta.url),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /RECOVER TELEBIRR ASSESSMENT CLOCK - 12H NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /production-telebirr-shadow-assessment-clock-preflight\.sql/u);
assert.match(workflow, /production-telebirr-shadow-assessment-clock-recovery\.sql/u);
assert.ok(
  workflow.indexOf('production-telebirr-shadow-assessment-clock-preflight.sql') <
    workflow.indexOf('production-telebirr-shadow-assessment-clock-recovery.sql'),
  'The read-only assessment-clock preflight must run before recovery.',
);
assert.match(workflow, /\.minimumReviewWindowHours == 12/u);
assert.match(workflow, /\.reviewWindowHours == 12/u);
assert.match(workflow, /\.originalAssessmentClockPreserved == true/u);
assert.match(workflow, /\.financialBoundary == "dry_run"/u);
assert.match(workflow, /\.kemerBetExecutionEnabled == false/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(workflow, /update app\.feature_switches/u);

assert.match(preflight, /begin transaction isolation level repeatable read read only/u);
assert.match(preflight, /source_recovery_history_valid/u);
assert.match(preflight, /exact_receipt_too_old_outcome/u);
assert.match(preflight, /original_assessment_clock_available/u);
assert.match(preflight, /pilot_twelve_hours/u);
assert.match(preflight, /profile_twelve_hours/u);
assert.match(preflight, /enrollment_twelve_hours/u);
assert.match(preflight, /signer_twelve_hours/u);
assert.match(preflight, /interval '12 hours'/u);
assert.match(preflight, /'minimumReviewWindowHours', 12/u);
assert.match(preflight, /'kemerBetExecutionEnabled', false/u);
assert.match(preflight, /'moneyMoved', false/u);
assert.match(preflight, /rollback;/u);
assert.doesNotMatch(preflight, /^\s*(?:insert|update|delete|truncate|alter|create|drop)\s/imu);

assert.match(operation, /begin transaction isolation level read committed/u);
assert.match(operation, /retry_private_telebirr_shadow_after_assessment_clock_fix\(/u);
assert.match(operation, /source_recovery_assessment_clock_retry_no_credit/u);
assert.match(operation, /private_telebirr_shadow_assessment_clock_retry_is_valid\(/u);
assert.match(operation, /private_telebirr_shadow_assessment_submitted_at\(/u);
assert.match(operation, /retry\.retry_expires_at = retry\.authorized_at \+ interval '12 hours'/u);
assert.match(operation, /'reviewWindowHours', 12/u);
assert.match(operation, /'originalAssessmentClockPreserved', true/u);
assert.match(operation, /'financialBoundary', 'dry_run'/u);
assert.match(operation, /'kemerBetExecutionEnabled', false/u);
assert.match(operation, /'moneyMoved', false/u);
assert.doesNotMatch(operation, /update app\.feature_switches/u);
assert.doesNotMatch(operation, /delete from app\./u);

assert.match(migration, /add column assessment_clock_retry_source_id uuid/u);
assert.match(migration, /create table app\.private_telebirr_shadow_assessment_clock_retries/u);
assert.match(
  migration,
  /create function app\.retry_private_telebirr_shadow_after_assessment_clock_fix/u,
);
assert.match(
  migration,
  /create function app\.private_telebirr_shadow_assessment_clock_retry_history_is_valid/u,
);
assert.match(
  migration,
  /create function app\.private_telebirr_shadow_assessment_clock_retry_is_valid/u,
);
assert.match(migration, /create function app\.private_telebirr_shadow_assessment_submitted_at/u);
assert.match(migration, /source_outcome\.reason_code is distinct from 'receipt_too_old'/u);
assert.match(migration, /retry_expires_at = authorized_at \+ interval '12 hours'/u);
assert.match(migration, /enrollment\.valid_until >= retry_until/u);
assert.match(migration, /signer\.valid_until >= retry_until/u);
assert.match(migration, /'assessmentSubmittedAt'/u);
assert.match(migration, /''submittedAt'', pg_catalog\.to_jsonb\(/u);
assert.match(migration, /force row level security/u);
assert.match(migration, /revoke all on table/u);
assert.doesNotMatch(migration, /^\s*grant\s+/imu);
assert.doesNotMatch(migration, /update app\.feature_switches/u);
assert.doesNotMatch(
  migration,
  /(?:insert\s+into|update|delete\s+from|truncate)\s+app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
);

assert.match(onceWorkflow, /resolve-assessment-clock-child/u);
assert.match(onceWorkflow, /private_telebirr_shadow_assessment_clock_retries/u);
assert.match(onceWorkflow, /private_telebirr_shadow_assessment_clock_retry_is_valid/u);
assert.match(onceWorkflow, /::add-mask::\$resolved_target_shadow_proof_request_id/u);
assert.match(onceProvision, /private_telebirr_shadow_assessment_clock_retries/u);
assert.match(onceProvision, /private_telebirr_shadow_assessment_clock_retry_is_valid/u);

console.log('Production TeleBirr shadow assessment-clock recovery guard verified.');
