import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertOnlyScopedShadowAssignmentInsert } from './verify-shadow-provision-insert-boundary.mjs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const workflow = read(
  '../.github/workflows/production-live-telebirr-receipt-shape-diagnostic-retry.yml',
);
const operation = read('./sql/production-live-telebirr-receipt-shape-diagnostic-retry.sql');
const migration = read(
  '../supabase/migrations/20260922224000_retry_reviewed_receipt_shape_diagnostic.sql',
);
const terminalReviewMigration = read(
  '../supabase/migrations/20260922224100_bind_receipt_shape_diagnostic_to_terminal_witness.sql',
);
const historicalSourceMigration = read(
  '../supabase/migrations/20260922120000_fix_receipt_cell_opening_historical_source.sql',
);
const verifierWorkflow = read('../.github/workflows/production-telebirr-shadow-once.yml');
const verifierProvision = read('./sql/production-telebirr-shadow-verifier-once-provision.sql');

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR RECEIPT SHAPE DIAGNOSTIC RETRY - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /shapeDiagnosticRetryCount == 1/u);
assert.match(workflow, /sourceReceiptShapeDiagnosticReviewCount >= 1/u);
assert.match(workflow, /sourceReceiptShapeDiagnosticReviewCount <= \.sourceShadowAttemptCount/u);
assert.match(workflow, /readyEnrollmentCount == 1/u);
assert.match(workflow, /\.remainingSeconds \| type == "number" and \. >= 3601 and \. <= 43205/u);
assert.match(workflow, /disabledFinancialSwitches == 6/u);
assert.match(workflow, /executionLoginRoles == 0/u);
assert.match(workflow, /executionSessions == 0/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.match(workflow, /identifiersRedacted == true/u);

assert.match(operation, /begin isolation level read committed/u);
assert.match(operation, /retry_reviewed_private_telebirr_receipt_shape_diag/u);
assert.match(operation, /configured_window_seconds = 43200/u);
assert.match(operation, /remaining_seconds between 3601 and 43205/u);
assert.match(operation, /source_receipt_shape_diag_review_count/u);
assert.match(operation, /replacement_shadow_attempt_count = 0/u);
assert.match(operation, /replacement_shadow_outcome_count = 0/u);
assert.match(operation, /private_telebirr_shadow_receipt_shape_diag_retry_is_valid/u);
assert.match(operation, /'identifiersRedacted', true/u);

assert.match(migration, /private_telebirr_shadow_receipt_shape_diag_retries/u);
assert.match(migration, /reviewed_receipt_shape_diag_retry_no_credit/u);
assert.match(migration, /unknown_layout_invoice_number/u);
assert.match(migration, /protocol_reason_code = 'receipt_requires_review'/u);
assert.match(migration, /disposition = 'review_required'/u);
assert.match(migration, /reason_code = 'parser_uncertain'/u);
assert.match(
  migration,
  /staged\.observation_body_digest = source_outcome\.observation_body_digest/u,
);
assert.match(migration, /source_attempt_history_digest/u);
assert.match(migration, /source_evidence_history_digest/u);
assert.match(migration, /retry_expires_at = authorized_at \+ interval '12 hours'/u);
assert.match(migration, /heartbeat\.app_version = '0\.5\.9-evidence-only'/u);
assert.match(migration, /reviewed_receipt_cell_opening_retry_no_credit/u);
assert.match(migration, /private_telebirr_shadow_receipt_cell_opening_retry_is_valid/u);
assert.match(
  migration,
  /current_setting\(''app\.private_telebirr_shadow_receipt_cell_opening_retry''/u,
);
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

const sourcePins = [
  ...terminalReviewMigration.matchAll(/expected_source_sha256 constant text := '([0-9a-f]{64})'/gu),
].map((match) => match[1]);
assert.equal(sourcePins.length, 2);
for (const [index, functionName] of [
  'private_telebirr_shadow_receipt_shape_diag_retry_digest',
  'retry_reviewed_private_telebirr_receipt_shape_diag',
].entries()) {
  const source = migration.match(
    new RegExp(
      `create function app\\.${functionName}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
      'u',
    ),
  );
  assert.ok(source, `The original ${functionName} source must remain frozen`);
  assert.equal(createHash('sha256').update(source[1]).digest('hex'), sourcePins[index]);
}
assert.match(
  terminalReviewMigration,
  /source_receipt_shape_diag_review_count between 1 and source_attempt_count/u,
);
assert.match(terminalReviewMigration, /source_opening_reviews < 1/u);
assert.match(terminalReviewMigration, /source_opening_reviews > source_attempts/u);
assert.match(terminalReviewMigration, /source_receipt_shape_diag_review_count is null/u);
assert.match(terminalReviewMigration, /routine\.proacl is not distinct from original_acl/u);
assert.match(terminalReviewMigration, /routine\.prosecdef = original_security_definer/u);
assert.equal((terminalReviewMigration.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(
  terminalReviewMigration,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);
assert.doesNotMatch(terminalReviewMigration, /update app\.feature_switches/iu);
assert.doesNotMatch(terminalReviewMigration, /grant execute/iu);

assert.match(historicalSourceMigration, /private_tbirr_cell_binding_retry_history_is_valid/u);
assert.match(
  historicalSourceMigration,
  /private_telebirr_shadow_receipt_cell_binding_retry_digest/u,
);
assert.match(historicalSourceMigration, /source_alias_retry_request_digest/u);
assert.match(
  historicalSourceMigration,
  /source_alias\.reason_code = 'reviewed_receipt_alias_retry_no_credit'/u,
);
assert.match(
  historicalSourceMigration,
  /source_outcome\.protocol_reason_code = 'receipt_requires_review'/u,
);
assert.match(historicalSourceMigration, /private_live_telebirr_shadow_pilot_contract_matches/u);
assert.match(historicalSourceMigration, /private_live_telebirr_shadow_profile_contract_matches/u);
assert.match(historicalSourceMigration, /target_pilot_count <> 1/u);
assert.match(historicalSourceMigration, /target_profile_count <> 1/u);
assert.match(
  historicalSourceMigration,
  /pilot\.expires_at > v_authorized_at \+ interval ''1 hour''/u,
);
assert.equal(
  (
    historicalSourceMigration.match(/expected_source_sha256 constant text := '[0-9a-f]{64}'/gmu) ??
    []
  ).length,
  2,
);
assert.equal(
  (historicalSourceMigration.match(/routine\.prosrc = rewritten_source/gmu) ?? []).length,
  2,
);
assert.equal((historicalSourceMigration.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(
  historicalSourceMigration,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);
assert.doesNotMatch(historicalSourceMigration, /update app\.feature_switches/iu);
assert.doesNotMatch(historicalSourceMigration, /grant execute/iu);

assert.match(verifierWorkflow, /private_telebirr_shadow_receipt_shape_diag_retries/u);
assert.match(verifierWorkflow, /private_telebirr_shadow_receipt_shape_diag_retry_is_valid/u);
assert.match(verifierWorkflow, /-4 as priority/u);
assert.match(verifierProvision, /private_telebirr_shadow_receipt_shape_diag_retries/u);
assert.match(verifierProvision, /private_telebirr_shadow_receipt_shape_diag_retry_is_valid/u);
assert.equal(
  (verifierProvision.match(/private_telebirr_shadow_receipt_shape_diag_retries/gmu) ?? []).length,
  3,
);
assert.equal(
  (verifierProvision.match(/private_telebirr_shadow_receipt_shape_diag_retry_is_valid/gmu) ?? [])
    .length,
  10,
);
assert.doesNotMatch(verifierProvision, /update app\.feature_switches/u);
assertOnlyScopedShadowAssignmentInsert(verifierProvision);

console.log('Production reviewed receipt-shape-diagnostic retry contract verified.');
