import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read(
  '../.github/workflows/production-live-telebirr-receipt-cell-opening-child-preflight.yml',
);
const operation = read('./sql/production-live-telebirr-receipt-cell-opening-child-preflight.sql');

assert.match(workflow, /^name: Preflight production TeleBirr receipt cell opening child$/mu);
assert.match(workflow, /READ ONE EXISTING TELEBIRR RECEIPT CELL CHILD PREFLIGHT - NO MONEY/u);
assert.match(workflow, /permissions:\n  contents: read/u);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /node infra\/operations\/require-production-ci\.mjs/u);
assert.match(workflow, /production-live-telebirr-receipt-cell-opening-child-preflight\.sql/u);
assert.match(workflow, /Receipt-cell child preflight classification/u);
assert.doesNotMatch(workflow, /pull_request_target|schedule:|repository_dispatch:/u);

assert.equal(
  (operation.match(/^begin isolation level repeatable read read only;$/gmu) ?? []).length,
  1,
);
assert.equal((operation.match(/^commit;$/gmu) ?? []).length, 1);
assert.equal((operation.match(/;/gu) ?? []).length, 3);
assert.match(operation, /private_telebirr_shadow_receipt_cell_opening_retries/u);
assert.match(operation, /private_telebirr_shadow_receipt_cell_opening_retry_digest/u);
assert.match(operation, /private_tbirr_cell_binding_retry_history_is_valid/u);
assert.match(operation, /private_live_telebirr_shadow_pilot_contract_matches/u);
assert.match(operation, /private_live_telebirr_shadow_profile_contract_matches/u);
assert.match(operation, /staged\.staged_at >= retry\.authorized_at/u);
assert.match(operation, /heartbeat\.last_seen_at > retry\.authorized_at/u);
assert.match(operation, /heartbeat\.status_code = 'no_assignment'/u);
assert.match(operation, /pilot\.expires_at > clock\.assessed_at \+ interval '1 hour'/u);
assert.match(operation, /role\.rolcanlogin or role\.rolpassword is not null/u);
assert.match(operation, /'depositJobCount', predicates\.deposit_job_count/u);
assert.match(operation, /'lineageReady', predicates\.lineage_ready/u);
assert.match(
  operation,
  /'allReady', predicates\.all_non_evidence_predicates_ready and predicates\.evidence_ready/u,
);
assert.match(operation, /'moneyMoved', false/u);
assert.doesNotMatch(
  operation,
  /\b(?:insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|comment|execute|perform)\b|pg_(?:try_)?advisory|for\s+(?:no\s+key\s+)?update|for\s+(?:key\s+)?share/iu,
);
assert.doesNotMatch(
  operation,
  /current_private_trusted_telebirr_activation_epoch|private_telebirr_shadow_source_binding_window_boundary_is_ready|private_telebirr_shadow_receipt_cell_opening_retry_is_valid/u,
);
assert.doesNotMatch(operation, /retry\.retry_expires_at <= pilot\.expires_at/u);

console.log('Production receipt-cell-opening child read-only preflight contract verified.');
