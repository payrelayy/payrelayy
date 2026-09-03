import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/staging-telebirr-broker-readiness.yml'),
  'utf8',
);
const inspectSql = readFileSync(
  resolve(root, 'infra/sql/staging-telebirr-broker-readiness-inspect.sql'),
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
assert.match(workflow, /REQUESTED_MODE" != 'inspect'/);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.STAGING_PROJECT_REF \}\}/);
assert.match(workflow, /PGSSLMODE: verify-full/);
assert.match(workflow, /PGSSLROOTCERT:/);
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

assert.match(inspectSql, /begin transaction isolation level serializable read only;/);
assert.match(inspectSql, /set local search_path = pg_catalog;/);
assert.match(inspectSql, /current_user = 'postgres' and session_user = 'postgres'/);
assert.match(inspectSql, /count\(\*\) = 7 as financial_features_disabled/);
assert.match(inspectSql, /fetanagent_telebirr_assignment_broker_runtime/g);
assert.match(inspectSql, /not role_state\.rolcanlogin/);
assert.match(inspectSql, /membership_state\.inherit_option/);
assert.match(inspectSql, /not membership_state\.set_option/);
assert.match(inspectSql, /not membership_state\.admin_option/);
assert.match(inspectSql, /lease_private_live_telebirr_assignment_broker/);
assert.match(inspectSql, /persist_private_live_telebirr_assignment_broker_signature/);
assert.match(inspectSql, /pg_catalog\.aclexplode/);
assert.match(inspectSql, /receiver\.rotation_request_id is not null/);
assert.match(inspectSql, /receiver\.account_reference_fingerprint/);
assert.match(inspectSql, /receiver\.protection_profile_version = 1/);
assert.match(inspectSql, /receiver\.encryption_key_version = 1/);
assert.match(inspectSql, /receiver\.fingerprint_key_version = 1/);
assert.match(inspectSql, /receiver-v1\[\.\]telebirr/);
assert.match(inspectSql, /app\.private_live_telebirr_receiver_profiles/);
assert.match(inspectSql, /app\.private_live_telebirr_device_enrollments/);
assert.match(inspectSql, /app\.private_live_telebirr_verification_jobs/);
assert.match(inspectSql, /'brokerDatabaseScaffold', 'disabled_ready'/);
assert.match(inspectSql, /'telebirrReceiver', redacted_state\.receiver_state/);
assert.match(inspectSql, /'openPilot', redacted_state\.open_pilot_state/);
assert.match(inspectSql, /'deviceEnrollment'/);
assert.match(inspectSql, /'assignmentWork'/);
assert.equal(
  (inspectSql.match(/select 1 \/ 0 as rejected;/g) ?? []).length,
  5,
  'Every unsafe inspection boundary must stop psql under ON_ERROR_STOP.',
);
assert.match(inspectSql, /rollback;\s*$/);
assert.doesNotMatch(inspectSql, /\\q(?:uit)?\b|\\copy\b|\\o(?:ut)?\b/i);
assert.doesNotMatch(
  inspectSql,
  /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|commit)\b/im,
  'The staging readiness inspection must remain read-only.',
);

const projectionStart = inspectSql.indexOf('select pg_catalog.jsonb_build_object(');
assert.notEqual(projectionStart, -1, 'The redacted readiness projection is required.');
const projection = inspectSql.slice(projectionStart);
assert.doesNotMatch(
  projection,
  /account_holder_name|account_reference|receiver_profile_digest|receiver_configuration_digest|expected_receiver_name_digest|pilot_revision_id|receiver_profile_id|device_id|key_id/i,
  'The emitted readiness projection must not include receiver, pilot, device, or key material.',
);

console.log(
  'staging TeleBirr broker readiness verified: manual exact-target read-only workflow and fixed redacted projection',
);
