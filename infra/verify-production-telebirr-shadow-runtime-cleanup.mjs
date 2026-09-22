import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read('../.github/workflows/production-telebirr-shadow-runtime-cleanup.yml');
const disable = read('./sql/production-telebirr-shadow-verifier-once-disable.sql');

assert.match(workflow, /^name: Revoke stale production TeleBirr shadow runtime$/mu);
assert.match(workflow, /REVOKE STALE PRODUCTION TELEBIRR SHADOW RUNTIME - NO MONEY/u);
assert.match(workflow, /group: fetanagent-production-telebirr-shadow-once/u);
assert.match(workflow, /permissions:\n  contents: read/u);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /node infra\/operations\/require-production-ci\.mjs/u);
assert.match(workflow, /fetanagent-production-direct-database-tunnel\.sh/u);
assert.match(workflow, /production-telebirr-shadow-verifier-once-disable\.sql/u);
assert.match(workflow, /shadow_verifier_runtime_disable/u);
assert.match(workflow, /financialSwitchesChanged == false/u);
assert.match(workflow, /PGUSER: postgres/u);
assert.doesNotMatch(workflow, /pull_request_target|schedule:|repository_dispatch:/u);
assert.doesNotMatch(
  workflow,
  /confirm_(?:pilot|shadow_proof|source_live|recovery)|PIN_MANIFEST|docker (?:build|run)|shadow-verifier-once-provision/u,
);

assert.match(disable, /alter role fetanagent_telebirr_shadow_verifier with/u);
assert.match(disable, /alter role fetanagent_telebirr_shadow_verifier_runtime with/u);
assert.equal((disable.match(/password null/gu) ?? []).length, 2);
assert.match(disable, /pg_catalog\.pg_terminate_backend/u);
assert.match(disable, /'financialSwitchesChanged', false/u);
assert.doesNotMatch(
  disable,
  /\b(?:insert|update|delete|merge|truncate|create|drop|grant|comment)\b|app\.feature_switches/u,
);

console.log('Production shadow-runtime cleanup-only workflow contract verified.');
