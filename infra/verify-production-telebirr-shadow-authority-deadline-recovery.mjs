import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-telebirr-shadow-authority-deadline-recovery.yml',
    import.meta.url,
  ),
  'utf8',
);
const operation = readFileSync(
  new URL('./sql/production-telebirr-shadow-authority-deadline-recovery.sql', import.meta.url),
  'utf8',
);
const preflight = readFileSync(
  new URL('./sql/production-telebirr-shadow-authority-deadline-preflight.sql', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20260918192428_recover_source_shadow_authority_deadline_quarantine.sql',
    import.meta.url,
  ),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /RECOVER TELEBIRR SHADOW AUTHORITY DEADLINE - 12H NO MONEY/u);
assert.doesNotMatch(workflow, /confirm_source_shadow_verification_job_id/u);
assert.doesNotMatch(workflow, /SOURCE_SHADOW_VERIFICATION_JOB_ID/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.PRODUCTION_PROJECT_REF \}\}/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /export PGSSLROOTCERT="\$ca_file"/u);
assert.match(workflow, /production-telebirr-shadow-authority-deadline-preflight\.sql/u);
assert.match(workflow, /production-telebirr-shadow-authority-deadline-recovery\.sql/u);
assert.ok(
  workflow.indexOf('production-telebirr-shadow-authority-deadline-preflight.sql') <
    workflow.indexOf('production-telebirr-shadow-authority-deadline-recovery.sql'),
  'The read-only readiness report must run before the recovery transaction.',
);
assert.match(workflow, /\.minimumReviewWindowHours == 12/u);
assert.match(workflow, /\.ready == true/u);
assert.match(workflow, /\.reviewWindowHours == 12/u);
assert.match(workflow, /\.financialBoundary == "dry_run"/u);
assert.match(workflow, /\.kemerBetExecutionEnabled == false/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(workflow, /update app\.feature_switches/u);

assert.match(operation, /begin transaction isolation level read committed/u);
assert.match(operation, /current_user = 'postgres' and session_user = 'postgres'/u);
assert.match(operation, /proof\.verification_job_id::text as source_shadow_verification_job_id/u);
assert.match(operation, /exact_source_proof_ready/u);
assert.doesNotMatch(operation, /\\getenv source_shadow_verification_job_id/u);
assert.match(operation, /retry_private_telebirr_shadow_after_authority_deadline_fix\(/u);
assert.match(operation, /source_recovery_authority_deadline_retry_no_credit/u);
assert.match(operation, /private_telebirr_shadow_authority_deadline_retry_is_valid\(/u);
assert.match(operation, /retry\.retry_expires_at = retry\.authorized_at \+ interval '12 hours'/u);
assert.match(operation, /quarantine\.reason_code = 'trusted_evidence_invalid'/u);
assert.match(operation, /'reviewWindowHours', 12/u);
assert.match(operation, /'financialBoundary', 'dry_run'/u);
assert.match(operation, /'kemerBetExecutionEnabled', false/u);
assert.match(operation, /'moneyMoved', false/u);
assert.doesNotMatch(operation, /update app\.feature_switches/u);
assert.doesNotMatch(operation, /delete from app\./u);

assert.match(preflight, /begin transaction isolation level repeatable read read only/u);
assert.match(preflight, /interval '12 hours'/u);
assert.match(preflight, /'minimumReviewWindowHours', 12/u);
assert.match(preflight, /proof_shape_exact/u);
assert.match(preflight, /source_recovery_valid/u);
assert.match(preflight, /source_recovery_shape_exact/u);
assert.match(preflight, /attempt_history_present/u);
assert.match(preflight, /quarantine_history_present/u);
assert.match(preflight, /staged_bindings_valid/u);
assert.match(preflight, /pilot_twelve_hours/u);
assert.match(preflight, /pilot_binding_valid/u);
assert.match(preflight, /profile_twelve_hours/u);
assert.match(preflight, /profile_binding_valid/u);
assert.match(preflight, /enrollment_twelve_hours/u);
assert.match(preflight, /signer_twelve_hours/u);
assert.match(preflight, /switches_safe/u);
assert.match(preflight, /companion_disabled/u);
assert.match(preflight, /trusted_authority_inactive/u);
assert.match(preflight, /private_trusted_telebirr_activation_control/u);
assert.match(preflight, /private_trusted_telebirr_activation_epochs/u);
assert.doesNotMatch(preflight, /current_private_trusted_telebirr_activation_epoch/u);
assert.match(preflight, /privileged_logins_disabled/u);
assert.match(preflight, /privileged_sessions_absent/u);
assert.match(preflight, /rollback;/u);
assert.doesNotMatch(preflight, /^\s*(?:insert|update|delete|truncate|alter|create|drop)\s/imu);

assert.match(migration, /add column authority_deadline_retry_source_id uuid/u);
assert.match(migration, /create table app\.private_telebirr_shadow_authority_deadline_retries/u);
assert.match(
  migration,
  /create function app\.retry_private_telebirr_shadow_after_authority_deadline_fix/u,
);
assert.match(
  migration,
  /create function app\.private_telebirr_shadow_authority_deadline_retry_is_valid/u,
);
assert.match(migration, /retry_expires_at = authorized_at \+ interval '12 hours'/u);
assert.match(migration, /prior_quarantine_count = prior_attempt_count/u);
assert.match(migration, /app\.private_live_telebirr_source_recovery_is_valid\(/u);
assert.match(migration, /quarantine\.reason_code <> 'trusted_evidence_invalid'/u);
assert.match(migration, /force row level security/u);
assert.match(migration, /revoke all on table/u);
assert.doesNotMatch(migration, /^\s*grant\s+/imu);
assert.doesNotMatch(migration, /update app\.feature_switches/u);
assert.doesNotMatch(
  migration,
  /(?:insert\s+into|update|delete\s+from|truncate)\s+app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
);

console.log('Production TeleBirr shadow authority-deadline recovery guard verified.');
