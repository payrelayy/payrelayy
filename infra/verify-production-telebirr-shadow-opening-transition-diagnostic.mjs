import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read(
  '../.github/workflows/production-telebirr-shadow-opening-transition-diagnostic.yml',
);
const operation = read('./sql/production-telebirr-shadow-opening-transition-diagnostic.sql');

for (const fragment of [
  `GITHUB_REF" == 'refs/heads/main'`,
  'CONFIRMED_COMMIT" == "$GITHUB_SHA"',
  'RUN ONE NO WRITE TELEBIRR SHADOW TRANSITION DIAGNOSTIC',
  'require-production-ci.mjs',
  'environment: production',
  'PGSSLMODE: verify-full',
  'fetanagent-production-telebirr-shadow-once',
  'Shadow transition diagnostic classification',
  'Shadow transition diagnostic blockers',
]) {
  assert.ok(workflow.includes(fragment), `Missing workflow guard: ${fragment}`);
}
assert.doesNotMatch(workflow, /pull_request_target|schedule:|repository_dispatch:/u);
assert.doesNotMatch(workflow, /tee -a/u);

assert.match(operation, /^begin isolation level read committed;$/mu);
assert.match(operation, /^rollback;$/mu);
assert.equal((operation.match(/^rollback;$/gmu) ?? []).length, 1);
assert.doesNotMatch(operation, /^commit;$/mu);
assert.doesNotMatch(
  operation,
  /\b(?:insert|update|delete|merge|truncate|copy|call|create|alter|drop|grant|revoke|comment|execute|perform)\b/iu,
);
assert.doesNotMatch(operation, /pg_(?:try_)?advisory|set_config|retry_reviewed_/iu);

for (const fragment of [
  'private_telebirr_shadow_receipt_cell_opening_retry_is_valid',
  'private_tbirr_cell_binding_retry_history_is_valid',
  'private_live_telebirr_shadow_pilot_contract_matches',
  'private_live_telebirr_shadow_profile_contract_matches',
  'private_telebirr_shadow_source_binding_window_enrollment_is_ready',
  'private_telebirr_shadow_source_binding_window_boundary_is_ready',
  'private_live_deposit_pilot_reservations',
  'private_live_telebirr_settlement_receipts',
  'app.deposit_jobs',
  'provider_payment_evidence',
  "'noWrite', true",
  "'rolledBack', true",
  "'shareLocksOnly', true",
  "'identifiersRedacted', true",
  "'moneyMoved', false",
]) {
  assert.ok(operation.includes(fragment), `Missing diagnostic predicate: ${fragment}`);
}

const output = operation.slice(operation.lastIndexOf('select pg_catalog.jsonb_build_object('));
assert.doesNotMatch(
  output,
  /(?:uuid|requestKey|player|transaction|reference|signature|ciphertext|credential|digest|commitSha|projectRef|runId|signer)/iu,
);

console.log('Production shadow opening transition no-write diagnostic contract verified.');
