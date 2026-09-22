import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const workflow = read(
  '../.github/workflows/production-live-telebirr-receipt-cell-opening-retry.yml',
);
const operation = read('./sql/production-live-telebirr-receipt-cell-opening-retry.sql');
const migration = read(
  '../supabase/migrations/20260922090000_retry_reviewed_receipt_cell_opening.sql',
);
const verifierWorkflow = read('../.github/workflows/production-telebirr-shadow-once.yml');
const verifierProvision = read('./sql/production-telebirr-shadow-verifier-once-provision.sql');

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR RECEIPT CELL OPENING RETRY - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /cellOpeningRetryCount == 1/u);
assert.match(workflow, /sourceReceiptCellOpeningReviewCount == \.sourceShadowAttemptCount/u);
assert.match(workflow, /readyEnrollmentCount == 1/u);
assert.match(workflow, /disabledFinancialSwitches == 6/u);
assert.match(workflow, /executionLoginRoles == 0/u);
assert.match(workflow, /executionSessions == 0/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.match(workflow, /identifiersRedacted == true/u);

assert.match(operation, /begin isolation level read committed/u);
assert.match(operation, /retry_reviewed_private_telebirr_receipt_cell_opening/u);
assert.match(operation, /configured_window_seconds = 43200/u);
assert.match(operation, /remaining_seconds between 42601 and 43205/u);
assert.match(operation, /source_receipt_cell_opening_review_count/u);
assert.match(operation, /replacement_shadow_attempt_count = 0/u);
assert.match(operation, /replacement_shadow_outcome_count = 0/u);
assert.match(operation, /private_telebirr_shadow_receipt_cell_opening_retry_is_valid/u);
assert.match(operation, /'identifiersRedacted', true/u);

assert.match(migration, /private_telebirr_shadow_receipt_cell_opening_retries/u);
assert.match(migration, /reviewed_receipt_cell_opening_retry_no_credit/u);
assert.match(migration, /unknown_layout_invoice_number/u);
assert.match(migration, /protocol_reason_code = 'receipt_requires_review'/u);
assert.match(migration, /disposition = 'review_required'/u);
assert.match(migration, /reason_code = 'parser_uncertain'/u);
assert.match(migration, /retry_expires_at = authorized_at \+ interval '12 hours'/u);
assert.match(migration, /heartbeat\.app_version = '0\.5\.9-evidence-only'/u);
assert.match(migration, /reviewed_receipt_cell_binding_retry_no_credit/u);
assert.match(migration, /private_telebirr_shadow_receipt_cell_binding_retry_is_valid/u);
assert.match(
  migration,
  /current_setting\(''app\.private_telebirr_shadow_receipt_cell_binding_retry''/u,
);
assert.doesNotMatch(migration, /reviewed_receipt_alias_retry_no_credit/u);
assert.doesNotMatch(migration, /private_telebirr_shadow_receipt_alias_retry_is_valid/u);
assert.doesNotMatch(migration, /source_alias/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_boundary_is_ready/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_enrollment_is_ready/u);
assert.match(migration, /force row level security/u);
assert.match(migration, /expected_source_sha256 constant text/u);
assert.match(migration, /routine\.prosrc = rewritten_source/u);
assert.match(migration, /routine\.proacl is not distinct from original_acl/u);
assert.match(migration, /routine\.prosecdef = original_security_definer/u);
assert.equal((migration.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(
  migration,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);
assert.doesNotMatch(migration, /update app\.feature_switches/iu);
assert.doesNotMatch(migration, /grant execute/iu);

assert.match(verifierWorkflow, /private_telebirr_shadow_receipt_cell_opening_retries/u);
assert.match(verifierWorkflow, /private_telebirr_shadow_receipt_cell_opening_retry_is_valid/u);
assert.match(verifierWorkflow, /-4 as priority/u);
assert.match(verifierProvision, /private_telebirr_shadow_receipt_cell_opening_retries/u);
assert.match(verifierProvision, /private_telebirr_shadow_receipt_cell_opening_retry_is_valid/u);
assert.equal(
  (verifierProvision.match(/private_telebirr_shadow_receipt_cell_opening_retries/gmu) ?? []).length,
  3,
);
assert.equal(
  (verifierProvision.match(/private_telebirr_shadow_receipt_cell_opening_retry_is_valid/gmu) ?? [])
    .length,
  10,
);
assert.doesNotMatch(verifierProvision, /update app\.feature_switches/u);
assert.doesNotMatch(verifierProvision, /insert into app\./u);

console.log('Production reviewed receipt-cell-opening retry contract verified.');
