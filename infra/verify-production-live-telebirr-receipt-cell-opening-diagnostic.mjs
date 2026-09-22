import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const workflow = read(
  '../.github/workflows/production-live-telebirr-receipt-cell-opening-diagnostic.yml',
);
const operation = read('./sql/production-live-telebirr-receipt-cell-opening-diagnostic.sql');

for (const fragment of [
  `GITHUB_REF" == 'refs/heads/main'`,
  'CONFIRMED_COMMIT" == "$GITHUB_SHA"',
  'RUN ONE READ ONLY RECEIPT CELL OPENING SAFETY DIAGNOSTIC',
  'require-production-ci.mjs',
  'environment: production',
  'PGSSLMODE: verify-full',
  'trap cleanup EXIT',
]) {
  assert.ok(workflow.includes(fragment), `Missing workflow guard: ${fragment}`);
}

assert.match(operation, /begin isolation level repeatable read read only;/u);
assert.match(operation, /^commit;$/mu);
assert.equal(operation.match(/^commit;$/gmu)?.length, 1);
assert.doesNotMatch(
  operation,
  /\b(?:insert|update|delete|merge|truncate|copy|call|create|alter|drop|grant|revoke|lock)\b/iu,
);
assert.doesNotMatch(operation, /\bfor\s+(?:update|share|key\s+share)\b/iu);
assert.doesNotMatch(operation, /pg_advisory|set_config|retry_reviewed_/iu);
assert.doesNotMatch(
  operation,
  /(?:current_private_trusted_telebirr_activation_epoch|private_telebirr_shadow_source_binding_window_boundary_is_ready)/u,
);

for (const fragment of [
  'private_tbirr_cell_binding_retry_history_is_valid',
  'private_live_telebirr_shadow_pilot_contract_matches',
  'private_live_telebirr_shadow_profile_contract_matches',
  "pilot.expires_at > clock.assessed_at + interval '1 hour'",
  "heartbeat.runtime_state = 'ready'",
  "heartbeat.status_code = 'no_assignment'",
  "heartbeat.app_version = '0.5.9-evidence-only'",
  "enrollment.last_seen_at > clock.assessed_at - interval '5 minutes'",
  'private_telebirr_shadow_source_binding_window_enrollment_is_ready',
  'private_trusted_telebirr_activation_control',
  'private_trusted_telebirr_activation_epochs',
  'private_trusted_telebirr_emergency_disable_intents',
  'agent_platform_companion_execution_control',
  'private_live_deposit_pilot_reservations',
  'private_live_telebirr_settlement_receipts',
  'app.deposit_jobs',
  'provider_payment_evidence',
]) {
  assert.ok(operation.includes(fragment), `Missing deployed predicate: ${fragment}`);
}

for (const fragment of [
  'structural_enrollments as materialized',
  'recent_enrollment_state as materialized',
  'all_non_heartbeat_predicates_ready',
  "'heartbeatRecencySoleFailure'",
  "'allReady'",
]) {
  assert.ok(operation.includes(fragment), `Missing heartbeat separation: ${fragment}`);
}
assert.match(workflow, /heartbeat_recency_only/u);
assert.match(workflow, /other_safety_predicate/u);

for (const fragment of [
  "'readOnly', true",
  "'identifiersRedacted', true",
  "'moneyMoved', false",
  'least(pg_catalog.count(*)::integer, 2)',
  '), 1) as reservation_count',
  '43205',
]) {
  assert.ok(operation.includes(fragment), `Missing redacted bound: ${fragment}`);
}

const output = operation.slice(operation.lastIndexOf('select pg_catalog.jsonb_build_object('));
assert.doesNotMatch(
  output,
  /(?:uuid|requestKey|player|transaction|reference|signature|ciphertext|credential|digest|commitSha|projectRef|runId|signer)/iu,
);
assert.doesNotMatch(workflow, /tee -a/u);

console.log('Production receipt-cell-opening read-only diagnostic contract verified.');
