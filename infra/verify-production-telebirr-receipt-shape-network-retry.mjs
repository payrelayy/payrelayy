import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const migration = read(
  '../supabase/migrations/20260922224253_retry_reviewed_receipt_shape_network_unavailable.sql',
);
const historicalCountCorrection = read(
  '../supabase/migrations/20260923125057_receipt_shape_network_historical_review_count.sql',
);
const workflow = read('../.github/workflows/production-telebirr-receipt-shape-network-retry.yml');
const operation = read('./sql/production-telebirr-receipt-shape-network-retry.sql');
const shadowWorkflow = read('../.github/workflows/production-telebirr-shadow-once.yml');
const shadowProvision = read('./sql/production-telebirr-shadow-verifier-once-provision.sql');

assert.match(migration, /private_telebirr_shadow_receipt_shape_diag_retry_digest/u);
assert.match(migration, /retry\.source_attempt_history_digest/u);
assert.match(migration, /retry\.source_evidence_history_digest/u);
assert.match(
  migration,
  /opening\.retry_request_digest = retry\.source_opening_retry_request_digest/u,
);
assert.doesNotMatch(
  migration,
  /and app\.private_telebirr_shadow_receipt_shape_diag_retry_is_valid\(/u,
);
assert.match(migration, /private_telebirr_receipt_shape_network_source_is_valid/u);
assert.match(migration, /review_reason is distinct from 'network_unavailable'/u);
assert.match(migration, /lookup_outcome is distinct from 'review_required'/u);
assert.match(migration, /observation\.principal_amount_minor is not null/u);
assert.match(migration, /observation\.occurred_at is not null/u);
assert.match(migration, /observation\.receiver_identity_digest is not null/u);
assert.match(migration, /private_telebirr_shadow_evidence_quarantine/u);
assert.match(migration, /outcome\.reason_code = 'source_unavailable'/u);
assert.match(migration, /outcome\.observation_body_digest/u);
assert.match(migration, /observation\.staged_at desc/u);
assert.match(migration, /source_proof\.pilot_revision_id = p_pilot_revision_id/u);
assert.match(migration, /private_live_telebirr_shadow_pilot_contract_matches/u);
assert.match(migration, /private_live_telebirr_shadow_profile_contract_matches/u);
assert.match(migration, /then authorized_at \+ interval '12 hours'/u);
assert.match(migration, /then new\.created_at \+ interval '12 hours'/u);
assert.match(migration, /\$extend_network_retry_proof_window\$/u);
assert.match(migration, /source_unavailable_retry_source_id is not null/u);
assert.match(migration, /expires_at <= created_at \+ interval '12 hours'/u);
assert.match(migration, /new\.expires_at > \(case/u);
assert.match(migration, /source_proof\.submitted_at \+ interval '12 hours'/u);
assert.match(migration, /private_telebirr_receipt_shape_network_retry_deadline/u);
assert.match(migration, /private_telebirr_shadow_source_unavailable_retry_is_valid/u);
assert.equal(
  (
    migration.match(
      /then app\.private_telebirr_receipt_shape_network_retry_deadline\(proof\.id\)/gmu,
    ) ?? []
  ).length,
  3,
);
assert.match(migration, /routine\.proacl is not distinct from original_acl/u);
assert.match(migration, /routine\.prosecdef = original_security_definer/u);
assert.equal(
  (migration.match(/expected_source_sha256 constant text := '[0-9a-f]{64}'/gmu) ?? []).length,
  6,
);
assert.equal((migration.match(/^do \$network_retry_rewrite_/gmu) ?? []).length, 4);
assert.equal((migration.match(/^do \$network_retry_authority_rewrite_/gmu) ?? []).length, 2);
assert.match(migration, /old_fragment_pilot/u);
assert.match(migration, /old_fragment_profile_select/u);
assert.match(migration, /old_fragment_insert_pilot/u);
assert.equal((migration.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(
  migration,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);
assert.doesNotMatch(migration, /update app\.feature_switches/iu);
assert.doesNotMatch(migration, /grant execute/iu);

assert.match(
  historicalCountCorrection,
  /old_fragment constant text :=\s*'       and retry\.source_receipt_shape_diag_review_count = retry\.source_attempt_count'/u,
);
assert.match(
  historicalCountCorrection,
  /new_fragment constant text :=\s*'       and retry\.source_receipt_shape_diag_review_count between 1 and retry\.source_attempt_count'/u,
);
assert.match(historicalCountCorrection, /expected_source_sha256 constant text := '[0-9a-f]{64}'/u);
assert.match(historicalCountCorrection, /routine\.proacl is not distinct from original_acl/u);
assert.match(historicalCountCorrection, /routine\.prosecdef = original_security_definer/u);
assert.match(historicalCountCorrection, /valid_count <> 1/u);
assert.equal((historicalCountCorrection.match(/^do \$/gmu) ?? []).length, 1);
assert.equal((historicalCountCorrection.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(
  historicalCountCorrection,
  /(?:insert|update|delete)\s+(?:into\s+|from\s+)?app\./iu,
);
assert.doesNotMatch(historicalCountCorrection, /grant execute|update app\.feature_switches/iu);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR RECEIPT SHAPE NETWORK RETRY - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /\.sourceCount == 1/u);
assert.match(workflow, /\.replacementCount == 1/u);
assert.match(workflow, /\.remainingSeconds \| type == "number" and \. >= 3601/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.match(workflow, /\.identifiersRedacted == true/u);

assert.match(operation, /begin isolation level read committed/u);
assert.match(operation, /private_telebirr_receipt_shape_network_source_is_valid/u);
assert.match(operation, /target_pilot\.id <> proof\.pilot_revision_id/u);
assert.match(operation, /private_live_telebirr_shadow_pilot_contract_matches/u);
assert.match(operation, /private_live_telebirr_shadow_profile_contract_matches/u);
assert.match(operation, /retry_private_telebirr_shadow_after_source_unavailable/u);
assert.match(operation, /pg_catalog\.gen_random_uuid\(\)/u);
assert.match(operation, /extract\(epoch from result\.retry_expires_at/u);
assert.doesNotMatch(operation, /pg_catalog\.extract\s*\(/u);
assert.match(operation, /not result\.already_retried/u);
assert.match(operation, /private_telebirr_shadow_source_unavailable_retry_is_valid/u);
assert.match(operation, /private_live_deposit_pilot_reservations/u);
assert.match(operation, /where status = 'armed'\) <> 1/u);
assert.match(operation, /private_live_telebirr_settlement_receipts/u);
assert.match(operation, /deposit_jobs/u);
assert.match(operation, /agent_platform_companion_execution_control/u);
assert.match(operation, /'moneyMoved', false/u);
assert.match(operation, /'identifiersRedacted', true/u);
assert.equal((operation.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(operation, /update app\.feature_switches/iu);
assert.doesNotMatch(
  operation,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);

assert.match(shadowWorkflow, /-6 as priority/u);
assert.match(shadowWorkflow, /private_telebirr_receipt_shape_network_source_is_valid/u);
assert.match(shadowWorkflow, /private_telebirr_shadow_source_unavailable_retry_is_valid/u);
assert.equal(
  (shadowProvision.match(/private_telebirr_receipt_shape_network_source_is_valid/gmu) ?? []).length,
  3,
);
assert.doesNotMatch(shadowProvision, /update app\.feature_switches/iu);
assert.doesNotMatch(shadowProvision, /insert into app\./iu);

console.log('Production receipt-shape network retry contract verified.');
