import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const workflow = read(
  '../.github/workflows/production-live-telebirr-source-binding-receipt-layout-retry.yml',
);
const operation = read('./sql/production-live-telebirr-source-binding-receipt-layout-retry.sql');
const migration = read(
  '../supabase/migrations/20260920170407_retry_reviewed_source_binding_receipt_layout.sql',
);
const historyBindingRepair = read(
  '../supabase/migrations/20260921133000_fix_receipt_layout_history_binding.sql',
);
const verifierWorkflow = read('../.github/workflows/production-telebirr-shadow-once.yml');
const verifierProvision = read('./sql/production-telebirr-shadow-verifier-once-provision.sql');
const parser = read(
  '../android/telebirr-verifier/app/src/main/java/com/fetanagent/telebirrverifier/LivePrivatePilotReceiptParser.kt',
);
const androidProtocol = read(
  '../android/telebirr-verifier/app/src/main/java/com/fetanagent/telebirrverifier/LivePrivatePilotProtocol.kt',
);
const protocol = read(
  '../packages/telebirr-verification-foundation/src/live-private-pilot-protocol.ts',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR RECEIPT LAYOUT RETRY - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /REVIEWED_MAIN_COMMIT_SHA: \$\{\{ github\.sha \}\}/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /PGSERVICEFILE: \/dev\/null/u);
assert.match(workflow, /PGPASSFILE: \/dev\/null/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /layoutRetryCount == 1/u);
assert.match(workflow, /sourceStagedEvidenceCount == \.sourceShadowAttemptCount/u);
assert.match(workflow, /\(\.sourceLayoutEvidenceCount \| type == "number"\)/u);
assert.match(workflow, /\.sourceLayoutEvidenceCount >= 1/u);
assert.match(workflow, /\.sourceLayoutEvidenceCount <= \.sourceShadowAttemptCount/u);
assert.match(workflow, /configuredWindowSeconds == 43200/u);
assert.match(workflow, /readyEnrollmentCount == 1/u);
assert.match(workflow, /disabledFinancialSwitches == 6/u);
assert.match(workflow, /kemerBetLoginRoles == 0/u);
assert.match(workflow, /verifierLoginRoles == 0/u);
assert.match(workflow, /\.providerEvidence == 0/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.match(workflow, /identifiersRedacted == true/u);
assert.doesNotMatch(workflow, /::set-output/u);

assert.match(operation, /begin isolation level read committed/u);
assert.match(operation, /retry_reviewed_private_telebirr_source_binding_receipt_layout/u);
assert.match(operation, /configured_window_seconds = 43200/u);
assert.match(operation, /remaining_seconds between 42601 and 43205/u);
assert.match(operation, /source_staged_evidence_count = result\.source_shadow_attempt_count/u);
assert.match(operation, /source_layout_evidence_count between 1/u);
assert.match(operation, /source_shadow_outcome_count = 1/u);
assert.match(operation, /replacement_shadow_attempt_count = 0/u);
assert.match(operation, /replacement_shadow_outcome_count = 0/u);
assert.match(operation, /private_telebirr_shadow_source_binding_layout_retry_is_valid/u);
assert.match(operation, /private_live_deposit_pilot_reservations/u);
assert.match(operation, /private_live_telebirr_settlement_receipts/u);
assert.match(operation, /app\.deposit_jobs/u);
assert.match(operation, /app\.provider_payment_evidence/u);
assert.match(operation, /'identifiersRedacted', true/u);

assert.match(migration, /source_binding_layout_retry_source_id/u);
assert.match(migration, /private_telebirr_shadow_source_binding_layout_retries/u);
assert.match(migration, /retry_expires_at = authorized_at \+ interval '12 hours'/u);
assert.match(migration, /private_telebirr_shadow_binding_window_retry_history_is_valid/u);
assert.match(migration, /private_telebirr_shadow_retry_attempt_history_digest/u);
assert.match(migration, /private_telebirr_shadow_layout_evidence_history_digest/u);
assert.match(migration, /source_staged_evidence_count = source_attempt_count/u);
assert.match(migration, /source_layout_evidence_count between 1 and source_attempt_count/u);
assert.match(migration, /fetanagent:production:telebirr-shadow-verifier-runtime/u);
assert.match(migration, /fetanagent_telebirr_shadow_verifier_runtime/u);
assert.match(migration, /disposition = 'review_required'/u);
assert.match(migration, /reason_code = 'source_unavailable'/u);
assert.match(migration, /protocol_reason_code = 'receipt_requires_review'/u);
assert.match(migration, /principal_amount_minor is null/u);
assert.match(migration, /private_telebirr_shadow_evidence_quarantine/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_enrollment_is_ready/u);
assert.match(migration, /private_telebirr_shadow_source_binding_window_boundary_is_ready/u);
assert.match(migration, /f7bb81456ee5cd063bfadb57e95a7c747b68f8957edbfbe6217eaa1a3baa19f0/u);
assert.match(migration, /0aceafb1f07333f8dc983f4e3748f27049149e47b6cd7f0ee757c03d8e75a3fe/u);
assert.match(migration, /eb8a04ca3f23835a6c9e7ddfbfd293842e22a1e503c30fe7c488d2298ba03271/u);
assert.match(migration, /force row level security/u);
assert.equal((migration.match(/^commit;$/gmu) ?? []).length, 1);
assert.ok(
  migration.indexOf('create table app.private_telebirr_shadow_source_binding_layout_retries') <
    migration.indexOf(
      'create function app.private_telebirr_shadow_source_binding_layout_review_deadline',
    ),
);
assert.doesNotMatch(
  migration,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);
assert.doesNotMatch(migration, /update app\.feature_switches/iu);
assert.doesNotMatch(migration, /grant execute/iu);

assert.match(historyBindingRepair, /private_telebirr_shadow_layout_source_is_valid\(uuid,uuid\)/u);
assert.match(historyBindingRepair, /attempt\.shadow_proof_request_id = proof\.id/u);
assert.match(historyBindingRepair, /outcome\.source_document_digest/u);
assert.match(historyBindingRepair, /lookupOutcome/u);
assert.match(historyBindingRepair, /retrievedAt/u);
assert.match(historyBindingRepair, /routine\.proacl is not distinct from original_acl/u);
assert.match(historyBindingRepair, /routine\.prosecdef = original_security_definer/u);
assert.doesNotMatch(
  historyBindingRepair,
  /\b(?:insert\s+into|update|delete\s+from|truncate)\s+app\./iu,
);
assert.doesNotMatch(historyBindingRepair, /grant execute/iu);

for (const code of [
  'unknown_layout_provider_identity',
  'unknown_layout_invoice_number',
  'unknown_layout_transaction_status',
  'unknown_layout_settled_amount',
  'unknown_layout_payment_date',
  'unknown_layout_credited_party_name',
  'unknown_layout_payment_mode',
  'unknown_layout_payment_reason',
  'unknown_layout_payment_channel',
]) {
  assert.match(parser, new RegExp(code, 'u'));
  assert.match(androidProtocol, new RegExp(code, 'u'));
  assert.match(protocol, new RegExp(code, 'u'));
}
assert.match(parser, /replace\(commentPattern, " "\)/u);
assert.match(parser, /replace\(scriptPattern, " "\)/u);
assert.match(parser, /replace\(stylePattern, " "\)/u);
assert.match(parser, /\.split\(tagPattern\)/u);
assert.match(parser, /canonicalInlinePair/u);
assert.match(parser, /receipttabletd/u);
assert.match(parser, /receipttabletd2/u);
assert.match(parser, /classBoundReferences\.size > 1/u);
assert.match(parser, /receiptReferencePattern/u);
assert.match(parser, /Raw labels,/u);
assert.match(parser, /values, and HTML never leave the device/u);
assert.doesNotMatch(parser, /review\(document\.sourceDocumentDigest, "unknown_layout",/u);

assert.match(verifierWorkflow, /private_telebirr_shadow_source_binding_layout_retries/u);
assert.match(verifierWorkflow, /private_telebirr_shadow_source_binding_layout_retry_is_valid/u);
assert.match(verifierWorkflow, /'not-applicable'::text as source_live_verification_job_id/u);
assert.match(verifierProvision, /review_source_binding_layout_retry/u);
assert.match(verifierProvision, /private_telebirr_shadow_source_binding_layout_retry_is_valid/u);
assert.match(verifierProvision, /private_telebirr_shadow_source_binding_layout_retries/u);
assert.doesNotMatch(verifierProvision, /update app\.feature_switches/u);
assert.doesNotMatch(verifierProvision, /insert into app\./u);

console.log('Production reviewed source-binding receipt-layout retry contract verified.');
