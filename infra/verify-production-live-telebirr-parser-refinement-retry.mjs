import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const workflow = read('../.github/workflows/production-live-telebirr-parser-refinement-retry.yml');
const operation = read('./sql/production-live-telebirr-parser-refinement-retry.sql');
const migration = read(
  '../supabase/migrations/20260922033000_retry_reviewed_receipt_parser_refinement.sql',
);
const verifierWorkflow = read('../.github/workflows/production-telebirr-shadow-once.yml');
const verifierProvision = read('./sql/production-telebirr-shadow-verifier-once-provision.sql');

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR PARSER REFINEMENT RETRY - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /parserRetryCount == 1/u);
assert.match(workflow, /sourceParserRefinementReviewCount == \.sourceShadowAttemptCount/u);
assert.match(workflow, /readyEnrollmentCount == 1/u);
assert.match(workflow, /disabledFinancialSwitches == 6/u);
assert.match(workflow, /executionLoginRoles == 0/u);
assert.match(workflow, /executionSessions == 0/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.match(workflow, /identifiersRedacted == true/u);

assert.match(operation, /begin isolation level read committed/u);
assert.match(operation, /retry_reviewed_private_telebirr_receipt_parser_refinement/u);
assert.match(operation, /configured_window_seconds = 43200/u);
assert.match(operation, /remaining_seconds between 42601 and 43205/u);
assert.match(operation, /source_parser_refinement_review_count/u);
assert.match(operation, /replacement_shadow_attempt_count = 0/u);
assert.match(operation, /replacement_shadow_outcome_count = 0/u);
assert.match(operation, /private_telebirr_shadow_parser_refinement_retry_is_valid/u);
assert.match(operation, /'identifiersRedacted', true/u);

assert.match(migration, /private_telebirr_shadow_parser_refinement_retries/u);
assert.match(migration, /reviewed_receipt_parser_refinement_retry_no_credit/u);
assert.match(migration, /unknown_layout_invoice_number/u);
assert.match(migration, /unknown_layout_transaction_status/u);
assert.match(migration, /unknown_layout_payment_channel/u);
assert.match(migration, /protocol_reason_code = 'receipt_requires_review'/u);
assert.match(migration, /disposition = 'review_required'/u);
assert.match(migration, /reason_code = 'parser_uncertain'/u);
assert.match(migration, /retry_expires_at = authorized_at \+ interval '12 hours'/u);
assert.match(migration, /heartbeat\.app_version = '0\.5\.6-evidence-only'/u);
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

assert.match(verifierWorkflow, /private_telebirr_shadow_parser_refinement_retries/u);
assert.match(verifierWorkflow, /private_telebirr_shadow_parser_refinement_retry_is_valid/u);
assert.match(verifierWorkflow, /-1 as priority/u);
assert.match(verifierProvision, /private_telebirr_shadow_parser_refinement_retries/u);
assert.match(verifierProvision, /private_telebirr_shadow_parser_refinement_retry_is_valid/u);
assert.doesNotMatch(verifierProvision, /update app\.feature_switches/u);
assert.doesNotMatch(verifierProvision, /insert into app\./u);

console.log('Production reviewed parser-refinement retry contract verified.');
