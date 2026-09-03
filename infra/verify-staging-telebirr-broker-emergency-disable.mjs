import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/staging-telebirr-broker-emergency-disable.yml'),
  'utf8',
);
const disableSql = readFileSync(
  resolve(root, 'infra/sql/staging-telebirr-broker-emergency-disable.sql'),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /STAGING_POOLER_HOST: aws-1-eu-west-1\.pooler\.supabase\.com/);
assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA" != "\$GITHUB_SHA"/);
assert.match(workflow, /REQUESTED_MODE" != 'emergency_disable'/);
assert.match(workflow, /CONFIRMED_ACTION" != 'disable-telebirr-broker-runtime'/);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.STAGING_PROJECT_REF \}\}/);
assert.match(workflow, /PGSSLMODE: verify-full/);
assert.match(workflow, /PGSSLROOTCERT:/);
assert.match(
  workflow,
  /run: psql -X --file=infra\/sql\/staging-telebirr-broker-emergency-disable\.sql/,
);
assert.match(
  workflow,
  /run: psql -X --file=infra\/sql\/staging-telebirr-broker-readiness-inspect\.sql/,
);
assert.deepEqual(
  [
    ...new Set(
      [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]).filter(Boolean),
    ),
  ].sort(),
  ['SUPABASE_CA_CERTIFICATE_PEM', 'SUPABASE_DB_PASSWORD'],
);
assert.doesNotMatch(
  workflow,
  /SUPABASE_ACCESS_TOKEN|SERVICE_ROLE|STAGING_VM|ssh |scp |docker |upload-artifact|artifact|repository_dispatch|workflow_call/i,
);

assert.match(disableSql, /begin transaction isolation level serializable;/);
assert.match(disableSql, /set local search_path = pg_catalog;/);
assert.match(disableSql, /current_user = 'postgres' and session_user = 'postgres'/);
assert.match(disableSql, /pg_advisory_xact_lock\(1178948673, 1413632594\)/);
assert.match(disableSql, /count\(\*\) = 7[\s\S]*?as financial_features_disabled[\s\S]*?for update/);
assert.match(disableSql, /membership\.inherit_option/);
assert.match(disableSql, /not membership_state\.set_option/);
assert.match(disableSql, /not membership_state\.admin_option/);
assert.match(disableSql, /count\(\*\) <= 1[\s\S]*?as membership_scope_safe/);
assert.match(disableSql, /and coalesce\(/);
assert.doesNotMatch(disableSql, /pg_catalog\.coalesce/);
assert.equal(
  (disableSql.match(/^revoke /gm) ?? []).length,
  1,
  'Only the expected broker membership may be revoked.',
);
assert.match(
  disableSql,
  /revoke fetanagent_telebirr_assignment_broker\s+from fetanagent_telebirr_assignment_broker_runtime;/,
);
assert.equal(
  (disableSql.match(/^grant /gm) ?? []).length,
  1,
  'Only the expected broker membership may be granted.',
);
assert.match(
  disableSql,
  /grant fetanagent_telebirr_assignment_broker\s+to fetanagent_telebirr_assignment_broker_runtime\s+with inherit true, set false, admin false;/,
);
assert.doesNotMatch(disableSql, /\bcascade\b/i);
assert.equal(
  (disableSql.match(/^alter role /gm) ?? []).length,
  2,
  'Only the two private broker roles may be altered.',
);
assert.match(
  disableSql,
  /alter role fetanagent_telebirr_assignment_broker with[\s\S]*?connection limit 2[\s\S]*?password null[\s\S]*?valid until 'infinity';/,
);
assert.match(
  disableSql,
  /alter role fetanagent_telebirr_assignment_broker_runtime with[\s\S]*?connection limit 1[\s\S]*?password null[\s\S]*?valid until 'infinity';/,
);
assert.equal((disableSql.match(/\bnologin\b/g) ?? []).length, 2, 'Both roles must become NOLOGIN.');
assert.match(disableSql, /pg_catalog\.pg_terminate_backend\(activity_pid, 5000\)/);
assert.match(disableSql, /role\.rolpassword is null/);
assert.match(disableSql, /'brokerDatabaseScaffold', 'disabled_ready'/);
assert.match(disableSql, /'activeBrokerSessions', 'absent'/);
assert.match(disableSql, /'financialFeatures', 'disabled'/);
assert.match(disableSql, /commit;/);
assert.doesNotMatch(
  disableSql,
  /^\s*(?:insert|update|delete|truncate|create|drop|alter\s+(?:table|function|procedure|schema|database))\b/im,
  'The action must not mutate application data, features, objects, or non-membership privileges.',
);
assert.doesNotMatch(disableSql, /\bexecute\b|\\(?:copy|o(?:ut)?)\b/i);
assert.doesNotMatch(
  disableSql,
  /account_holder_name|account_reference|receiver_profile|device_id|key_id|credential|private_key/i,
  'The emergency disablement must not read or emit receiver, device, or key material.',
);

console.log(
  'staging TeleBirr broker emergency disable verified: exact-target role and membership de-credentialing with redacted postcondition',
);
