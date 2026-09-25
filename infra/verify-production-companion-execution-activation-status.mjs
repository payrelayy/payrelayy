import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('./sql/production-companion-execution-activation-status.sql', import.meta.url),
  'utf8',
);
const statements = source.replace(/^--.*$/gmu, '');

assert.match(
  statements,
  /^\\set ON_ERROR_STOP on\s+begin isolation level repeatable read read only;/u,
);
assert.match(statements, /set local search_path = pg_catalog;/u);
assert.match(statements, /set local statement_timeout = '10s';/u);
assert.match(statements, /set local lock_timeout = '1s';/u);
assert.match(statements, /\ncommit;\s*$/u);
assert.equal(statements.match(/^commit;$/gmu)?.length, 1);
assert.doesNotMatch(
  statements,
  /\b(?:insert|update|delete|merge|truncate|copy|call|create|alter|drop|grant|revoke|lock)\b/iu,
);
assert.doesNotMatch(statements, /\bfor\s+(?:update|share|key\s+share)\b/iu);
assert.doesNotMatch(
  statements,
  /pg_advisory|set_config|current_private_trusted_telebirr_activation_epoch\s*\(/iu,
);

for (const required of [
  'app.private_live_deposit_pilot_revisions',
  'app.private_live_deposit_pilot_reservations',
  'app.deposit_jobs',
  'app.feature_switches',
  'app.private_trusted_telebirr_activation_control',
  'app.private_trusted_telebirr_activation_epochs',
  'app.agent_platform_companion_execution_control',
  'app.agent_platform_companion_execution_http_requests',
  'app.agent_platform_companion_execution_assignments',
  'app.agent_platform_companion_execution_statuses',
  'fetanagent_companion_execution_bridge',
  "job.status = 'queued'",
  'job.attempt_count = 0',
  'job.lease_token is null',
  'job.leased_by is null',
  'job.lease_expires_at is null',
  "pilot.status = 'armed'",
  'least(queue_state.total_jobs, 2)',
  'least(queue_state.total_jobs - queue_state.untouched_jobs, 2)',
  'least(reservation_state.total_reservations, 2)',
  "'readOnly', true",
  "'identifiersRedacted', true",
]) {
  assert.ok(statements.includes(required), `Missing status boundary: ${required}`);
}

const output = statements.slice(statements.lastIndexOf('select pg_catalog.jsonb_build_object('));
assert.doesNotMatch(
  output,
  /(?:uuid|player|transaction|reference|signature|ciphertext|credential|digest|commitSha|projectRef|runId|signer)/iu,
);
assert.doesNotMatch(output, /'moneyMoved'/u);

console.log('Companion execution activation status remains read-only and identifier-free.');
