import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/staging-synthetic-receiver.yml'),
  'utf8',
);
const inspectSql = readFileSync(
  resolve(root, 'infra/sql/staging-synthetic-receiver-inspect.sql'),
  'utf8',
);
const configureSql = readFileSync(
  resolve(root, 'infra/sql/staging-synthetic-receiver-configure.sql'),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA.*GITHUB_SHA/s);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /configure-synthetic-do-not-pay-receiver/g);
assert.match(workflow, /SUPABASE_DB_PASSWORD/);
assert.match(workflow, /SUPABASE_CA_CERTIFICATE_PEM/);
assert.match(workflow, /postgres\.\$\{\{ env\.STAGING_PROJECT_REF \}\}/);
assert.match(workflow, /PGSSLMODE: verify-full/g);
assert.match(workflow, /PGSSLROOTCERT:/g);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /if: inputs\.mode == 'configure'/g);
assert.ok(
  workflow.indexOf('staging-synthetic-receiver-inspect.sql') <
    workflow.indexOf('staging-synthetic-receiver-configure.sql'),
  'The read-only safety inspection must run before configuration.',
);
assert.doesNotMatch(
  workflow,
  /SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE|service_role|account_reference|customer_message/i,
);

assert.match(inspectSql, /begin transaction isolation level serializable read only;/);
assert.match(inspectSql, /count\(\*\) = 7 as financial_features_disabled/);
assert.match(inspectSql, /FETANAGENT STAGING SIMULATION - DO NOT PAY/g);
assert.match(inspectSql, /SIMULATION ONLY — DO NOT SEND MONEY\./g);
assert.match(inspectSql, /procedure\.prosecdef/);
assert.match(inspectSql, /pg_catalog\.aclexplode/);
assert.equal(
  (inspectSql.match(/select 1 \/ 0 as rejected;/g) ?? []).length,
  6,
  'Every failed inspection branch must stop psql under ON_ERROR_STOP.',
);
assert.match(inspectSql, /rollback;/);
assert.doesNotMatch(inspectSql, /\\q(?:uit)?\b/);
assert.doesNotMatch(inspectSql, /\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b/i);

assert.match(configureSql, /begin transaction isolation level serializable;/);
assert.match(configureSql, /pg_catalog\.pg_advisory_xact_lock/);
assert.match(configureSql, /count\(\*\) = 7 as financial_features_disabled/);
assert.match(configureSql, /select app\.replace_receiver_account_by_admin_id_legacy\(/);
assert.match(configureSql, /FETANAGENT STAGING SIMULATION - DO NOT PAY/g);
assert.match(configureSql, /SIMULATION ONLY — DO NOT SEND MONEY\./g);
assert.match(configureSql, /synthetic-staging-v1:do-not-pay/g);
assert.match(configureSql, /configuration\.receiver_account_replaced/);
assert.match(configureSql, /commit;/);
assert.doesNotMatch(configureSql, /\\q(?:uit)?\b/);
assert.doesNotMatch(
  configureSql,
  /^\s*(?:insert|update|delete|truncate)\b/im,
  'Configuration must write only through the existing audited Owner procedure.',
);

console.log(
  'staging synthetic receiver verified: manual exact-target workflow, fixed DO NOT PAY values, disabled financial features, audited configuration',
);
