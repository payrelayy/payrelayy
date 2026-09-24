import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertOnlyScopedShadowAssignmentInsert } from './verify-shadow-provision-insert-boundary.mjs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const migration = read(
  '../supabase/migrations/20260923164500_retry_one_reviewed_receipt_transport_diagnostic.sql',
);
const workflow = read(
  '../.github/workflows/production-telebirr-receipt-transport-diagnostic-retry.yml',
);
const operation = read('./sql/production-telebirr-receipt-transport-diagnostic-retry.sql');
const shadowWorkflow = read('../.github/workflows/production-telebirr-shadow-once.yml');
const shadowProvision = read('./sql/production-telebirr-shadow-verifier-once-provision.sql');

assert.match(migration, /private_telebirr_receipt_transport_diagnostic_source_is_valid/u);
assert.match(migration, /private_telebirr_receipt_shape_network_source_is_valid\(parent\.id\)/u);
assert.match(migration, /retry\.retry_request_digest =/u);
assert.match(migration, /private_telebirr_shadow_source_unavailable_retry_digest/u);
assert.match(migration, /proof\.source_unavailable_retry_source_id = parent\.id/u);
assert.match(migration, /proof\.source_binding_layout_retry_source_id is null/u);
assert.match(
  migration,
  /proof\.candidate_reference_fingerprint = parent\.candidate_reference_fingerprint/u,
);
assert.match(migration, /outcome\.reason_code = 'source_unavailable'/u);
assert.match(migration, /observation\.lookup_outcome is distinct from 'review_required'/u);
assert.match(migration, /observation\.review_reason is null/u);
assert.match(migration, /'network_unavailable', 'unknown_layout_invoice_number'/u);
assert.match(migration, /\) = 'network_unavailable'/u);
assert.match(migration, /observation\.observation_body_digest/u);
assert.match(migration, /private_telebirr_shadow_evidence_quarantine/u);
assert.match(migration, /retry\.retry_expires_at <= retry\.authorized_at \+ interval '12 hours'/u);
assert.match(migration, /retry\.retry_expires_at <= pilot\.expires_at/u);
assert.match(migration, /retry\.retry_expires_at <= profile\.valid_until/u);
assert.match(migration, /routine\.proacl is not distinct from original_acl/u);
assert.match(migration, /routine\.prosecdef = original_security_definer/u);
assert.match(migration, /routine\.proconfig is not distinct from original_config/u);
assert.equal((migration.match(/'[^']+', (?:0|1|2|3|4|20),\s*'[0-9a-f]{64}'/gmu) ?? []).length, 7);
assert.equal((migration.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(migration, /grant execute|update app\.feature_switches/iu);
assert.doesNotMatch(migration, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?app\./iu);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(
  workflow,
  /CREATE ONE REVIEWED TELEBIRR RECEIPT TRANSPORT DIAGNOSTIC RETRY - NO MONEY/u,
);
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
assert.match(operation, /private_telebirr_receipt_transport_diagnostic_source_is_valid/u);
assert.match(operation, /pilot\.id = proof\.pilot_revision_id/u);
assert.match(operation, /profile\.pilot_revision_id = pilot\.id/u);
assert.match(operation, /retry_private_telebirr_shadow_after_source_unavailable/u);
assert.match(operation, /not result\.already_retried/u);
assert.match(operation, /private_telebirr_shadow_source_unavailable_retry_is_valid/u);
assert.match(
  operation,
  /not app\.private_telebirr_receipt_transport_diagnostic_source_is_valid\(/u,
);
assert.match(operation, /current_private_trusted_telebirr_activation_epoch\(\) is not null/u);
assert.match(operation, /private_live_deposit_pilot_reservations/u);
assert.match(operation, /private_live_telebirr_settlement_receipts/u);
assert.match(operation, /agent_platform_companion_execution_control/u);
assert.match(operation, /'moneyMoved', false/u);
assert.match(operation, /'identifiersRedacted', true/u);
assert.equal((operation.match(/^commit;$/gmu) ?? []).length, 1);
assert.doesNotMatch(operation, /update app\.feature_switches/iu);
assert.doesNotMatch(
  operation,
  /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|provider_payment_evidence)/iu,
);

assert.match(shadowWorkflow, /private_telebirr_receipt_transport_diagnostic_source_is_valid/u);
assert.match(shadowWorkflow, /private_telebirr_shadow_source_unavailable_retry_is_valid/u);
assert.equal(
  (shadowProvision.match(/private_telebirr_receipt_transport_diagnostic_source_is_valid/gmu) ?? [])
    .length,
  3,
);
assert.doesNotMatch(shadowProvision, /update app\.feature_switches/iu);
assertOnlyScopedShadowAssignmentInsert(shadowProvision);

console.log('Production receipt transport diagnostic retry contract verified.');
