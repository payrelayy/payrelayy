import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const workflow = read('../.github/workflows/production-live-telebirr-provider-origin-retry.yml');
const operation = read('./sql/production-live-telebirr-provider-origin-retry.sql');
const migration = read(
  '../supabase/migrations/20260922003500_retry_reviewed_receipt_provider_origin.sql',
);
const digestHelperFix = read(
  '../supabase/migrations/20260922023000_fix_provider_origin_retry_digest_helper.sql',
);
const verifierWorkflow = read('../.github/workflows/production-telebirr-shadow-once.yml');
const verifierProvision = read('./sql/production-telebirr-shadow-verifier-once-provision.sql');

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR PROVIDER ORIGIN RETRY - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /originRetryCount == 1/u);
assert.match(workflow, /sourceProviderIdentityReviewCount == \.sourceShadowAttemptCount/u);
assert.match(workflow, /readyEnrollmentCount == 1/u);
assert.match(workflow, /disabledFinancialSwitches == 6/u);
assert.match(workflow, /executionLoginRoles == 0/u);
assert.match(workflow, /executionSessions == 0/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.match(workflow, /identifiersRedacted == true/u);

assert.match(operation, /begin isolation level read committed/u);
assert.match(operation, /retry_reviewed_private_telebirr_receipt_provider_origin/u);
assert.match(operation, /configured_window_seconds = 43200/u);
assert.match(operation, /remaining_seconds between 42601 and 43205/u);
assert.match(operation, /source_provider_identity_review_count/u);
assert.match(operation, /replacement_shadow_attempt_count = 0/u);
assert.match(operation, /replacement_shadow_outcome_count = 0/u);
assert.match(operation, /private_telebirr_shadow_provider_origin_retry_is_valid/u);
assert.match(operation, /'identifiersRedacted', true/u);

assert.match(migration, /private_telebirr_shadow_provider_origin_retries/u);
assert.match(migration, /reviewed_receipt_provider_origin_retry_no_credit/u);
assert.match(migration, /unknown_layout_provider_identity/u);
assert.match(migration, /protocol_reason_code = 'receipt_requires_review'/u);
assert.match(migration, /disposition = 'review_required'/u);
assert.match(migration, /reason_code = 'parser_uncertain'/u);
assert.match(migration, /retry_expires_at = authorized_at \+ interval '12 hours'/u);
assert.match(migration, /heartbeat\.app_version = '0\.5\.5-evidence-only'/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_boundary_is_ready/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_enrollment_is_ready/u);
assert.match(migration, /force row level security/u);
assert.match(migration, /71a3d77371c4cd9e27fad0beba66192d4ae8af0cd7690a0646592b263fced9b2/u);
assert.match(migration, /c15fd6369905488f65fd9ea7dc0f6d65bd727ecf796c9ce4f61fe1d3dbcbb91c/u);
assert.match(migration, /4a6605b54274354f9f2fb84802bfe2d586ca604ceb5a19fc52ca34e8f20ab2fa/u);
assert.equal((migration.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(
  migration,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);
assert.doesNotMatch(migration, /update app\.feature_switches/iu);
assert.doesNotMatch(migration, /grant execute/iu);

assert.match(digestHelperFix, /expected_source_sha256 constant text/u);
assert.match(digestHelperFix, /app\.private_live_deposit_pilot_digest\(/u);
assert.match(digestHelperFix, /app\.private_live_deposit_pilot_sha256\(/u);
assert.match(digestHelperFix, /routine\.prosrc = corrected_source/u);
assert.match(digestHelperFix, /routine\.proacl is not distinct from original_acl/u);
assert.match(digestHelperFix, /routine\.prosecdef = original_security_definer/u);
assert.equal((digestHelperFix.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(digestHelperFix, /insert into|update app\.|delete from|grant execute/iu);

assert.match(verifierWorkflow, /private_telebirr_shadow_provider_origin_retries/u);
assert.match(verifierWorkflow, /private_telebirr_shadow_provider_origin_retry_is_valid/u);
assert.match(verifierWorkflow, /0 as priority/u);
assert.match(verifierProvision, /private_telebirr_shadow_provider_origin_retries/u);
assert.match(verifierProvision, /private_telebirr_shadow_provider_origin_retry_is_valid/u);
assert.doesNotMatch(verifierProvision, /update app\.feature_switches/u);
assert.doesNotMatch(verifierProvision, /insert into app\./u);

console.log('Production reviewed provider-origin retry contract verified.');
