import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-live-telebirr-source-binding-shadow-window-retry.yml',
    import.meta.url,
  ),
  'utf8',
);
const operation = readFileSync(
  new URL('./sql/production-live-telebirr-source-binding-shadow-window-retry.sql', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20260920090000_retry_reviewed_source_binding_shadow_window.sql',
    import.meta.url,
  ),
  'utf8',
);
const verifierWorkflow = readFileSync(
  new URL('../.github/workflows/production-telebirr-shadow-once.yml', import.meta.url),
  'utf8',
);
const verifierProvision = readFileSync(
  new URL('./sql/production-telebirr-shadow-verifier-once-provision.sql', import.meta.url),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR SHADOW WINDOW RETRY - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /REVIEWED_MAIN_COMMIT_SHA: \$\{\{ github\.sha \}\}/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /PGSERVICEFILE: \/dev\/null/u);
assert.match(workflow, /PGPASSFILE: \/dev\/null/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /windowRetryCount == 1/u);
assert.match(workflow, /readyEnrollmentCount == 1/u);
assert.match(workflow, /disabledFinancialSwitches == 6/u);
assert.match(workflow, /dryRunPilotSwitches == 1/u);
assert.match(workflow, /kemerBetLoginRoles == 0/u);
assert.match(workflow, /verifierLoginRoles == 0/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.match(workflow, /identifiersRedacted == true/u);
assert.doesNotMatch(workflow, /::set-output/u);

assert.match(operation, /begin isolation level read committed/u);
assert.match(operation, /retry_reviewed_private_telebirr_source_binding_shadow_window/u);
assert.match(operation, /configured_window_seconds = 43200/u);
assert.match(operation, /remaining_seconds between 42601 and 43205/u);
assert.match(operation, /source_shadow_attempt_count = 0/u);
assert.match(operation, /source_shadow_outcome_count = 0/u);
assert.match(operation, /replacement_shadow_attempt_count = 0/u);
assert.match(operation, /replacement_shadow_outcome_count = 0/u);
assert.match(operation, /private_telebirr_shadow_source_binding_window_retry_is_valid/u);
assert.match(operation, /private_live_deposit_pilot_reservations/u);
assert.match(operation, /private_live_telebirr_settlement_receipts/u);
assert.match(operation, /app\.deposit_jobs/u);
assert.match(operation, /'identifiersRedacted', true/u);

assert.match(migration, /source_binding_window_retry_source_id/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_retries/u);
assert.match(migration, /retry_expires_at = authorized_at \+ interval '12 hours'/u);
assert.match(migration, /private_live_telebirr_source_binding_shadow_recovery_history_is_valid/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_enrollment_is_ready/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_boundary_is_ready/u);
assert.match(migration, /force row level security/u);
assert.doesNotMatch(
  migration,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
);

assert.match(verifierWorkflow, /private_telebirr_shadow_source_binding_window_retries/u);
assert.match(verifierWorkflow, /private_telebirr_shadow_source_binding_window_retry_is_valid/u);
assert.match(verifierWorkflow, /'not-applicable'::text as source_live_verification_job_id/u);
assert.match(verifierProvision, /review_source_binding_window_retry/u);
assert.match(verifierProvision, /private_telebirr_shadow_source_binding_window_retry_is_valid/u);
assert.match(verifierProvision, /private_telebirr_shadow_source_binding_window_retries/u);
assert.doesNotMatch(verifierProvision, /update app\.feature_switches/u);
assert.doesNotMatch(verifierProvision, /insert into app\./u);

console.log('Production reviewed source-binding shadow window retry contract verified.');
