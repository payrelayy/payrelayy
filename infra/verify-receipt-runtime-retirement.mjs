import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const sql = read('infra/sql/production-retire-receipt-runtimes.sql');
const workflow = read('.github/workflows/production-retire-receipt-runtimes.yml');
const runtime = read('.github/workflows/production-runtime.yml');
const androidRelease = read('.github/workflows/android-telebirr-evidence-release.yml');

const receiptRoles = [
  'fetanagent_routine_telebirr_no_money_runtime',
  'fetanagent_routine_telebirr_paid_poll_runtime',
  'fetanagent_routine_telebirr_paid_settlement_runtime',
];
for (const role of receiptRoles) {
  assert.match(sql, new RegExp(`alter role ${role}\\s+nologin password null valid until`, 'u'));
}
assert.equal((sql.match(/\balter role\b/gu) ?? []).length, receiptRoles.length);
assert.match(sql, /begin transaction isolation level read committed/u);
assert.match(sql, /order by feature_key for update/u);
assert.match(sql, /where control\.singleton for update/u);
assert.match(sql, /count\(\*\) = 7 and pg_catalog\.bool_and/u);
assert.match(sql, /not control\.enabled and control\.cutover_at is null/u);
assert.match(sql, /job\.status in \('queued','leased','retry_wait'\)/u);
assert.match(sql, /attempt\.status in \('prepared','final_action_fenced',/u);
assert.match(sql, /app\.routine_telebirr_paid_poll_claims/u);
assert.match(sql, /pg_catalog\.pg_stat_activity/u);
assert.match(sql, /insert into app\.audit_events/u);
assert.doesNotMatch(sql, /\b(?:delete|truncate|drop|update)\s+(?:from\s+|table\s+)?app\./iu);
assert.doesNotMatch(
  sql,
  /\b(?:alter|grant|revoke)\s+(?:role|execute)\s+fetanagent_receiver_sms_/iu,
);

assert.match(workflow, /workflow_dispatch:/u);
assert.doesNotMatch(workflow, /\b(?:push|pull_request|schedule|workflow_call):/u);
assert.match(workflow, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/u);
assert.match(workflow, /"\$CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /"\$CONFIRMED_PROJECT" == "\$PRODUCTION_PROJECT_REF"/u);
assert.match(workflow, /CONFIRMED_OPERATION" == 'RETIRE OLD RECEIPT RUNTIMES'/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /node infra\/operations\/require-production-ci\.mjs/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /--file=infra\/sql\/production-retire-receipt-runtimes\.sql/u);
assert.match(workflow, /rolesDisabled == 3/u);

const modes =
  /      mode:\s+description:[^\r\n]*\s+required: true\s+default: plan\s+type: choice\s+options:\s+((?:- [a-z-]+\s*)+)/u.exec(
    runtime,
  )?.[1];
assert.ok(modes, 'production runtime modes must remain explicit');
assert.deepEqual(
  [...modes.matchAll(/- ([a-z-]+)/gu)].map((match) => match[1]),
  ['plan', 'deploy-inert', 'status', 'stop'],
);
assert.match(runtime, /Only the receiver SMS production overlay may be deployed/u);
assert.match(androidRelease, /\[\[ "\$PHONE_MODE" == 'receiver_sms' \]\]/u);
assert.doesNotMatch(androidRelease, /default: no_money|default: paid_observation/u);

console.log(
  'Receipt runtime retirement is gated, limited to three old logins, and leaves SMS and money state intact.',
);
