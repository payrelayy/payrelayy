import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const migration = read(
  '../supabase/migrations/20260922224253_retry_reviewed_receipt_shape_network_unavailable.sql',
);
const workflow = read('../.github/workflows/production-telebirr-receipt-shape-network-retry.yml');
const operation = read('./sql/production-telebirr-receipt-shape-network-retry.sql');
const shadowWorkflow = read('../.github/workflows/production-telebirr-shadow-once.yml');
const shadowProvision = read('./sql/production-telebirr-shadow-verifier-once-provision.sql');

assert.match(migration, /private_telebirr_shadow_receipt_shape_diag_retry_is_valid/u);
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
assert.match(migration, /source_proof\.created_at \+ interval '12 hours'/u);
assert.match(migration, /new\.expires_at > \(case/u);
assert.match(migration, /authorized_at >= \(case/u);
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
assert.equal(
  (
    migration.match(
      /pg_catalog\.replace\(rewritten_source, old_fragment_[123], ''\)\)\)\s*\/ pg_catalog\.length\(old_fragment_[123]\)/gmu,
    ) ?? []
  ).length,
  6,
);
assert.equal((migration.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(
  migration,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);
assert.doesNotMatch(migration, /update app\.feature_switches/iu);
assert.doesNotMatch(migration, /grant execute/iu);

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
assert.match(operation, /retry_private_telebirr_shadow_after_source_unavailable/u);
assert.match(operation, /pg_catalog\.gen_random_uuid\(\)/u);
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
  2,
);
assert.doesNotMatch(shadowProvision, /update app\.feature_switches/iu);
assert.doesNotMatch(shadowProvision, /insert into app\./iu);

console.log('Production receipt-shape network retry contract verified.');
