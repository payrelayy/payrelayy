import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import assert from 'node:assert/strict';

const workspace = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(workspace, '.github/workflows/staging-beta-runtime-preflight.yml'),
  'utf8',
);
const inspectSql = readFileSync(
  resolve(workspace, 'infra/sql/staging-beta-runtime-inspect.sql'),
  'utf8',
);
const provisionSql = readFileSync(
  resolve(workspace, 'infra/sql/staging-beta-runtime-provision.sql'),
  'utf8',
);
const finalizeSql = readFileSync(
  resolve(workspace, 'infra/sql/staging-beta-runtime-finalize.sql'),
  'utf8',
);
const disableSql = readFileSync(
  resolve(workspace, 'infra/sql/staging-beta-runtime-disable.sql'),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|push:|schedule:/);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA" != "\$GITHUB_SHA"/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /STAGING_POOLER_HOST: aws-0-eu-west-1\.pooler\.supabase\.com/);
assert.match(workflow, /PGSSLMODE: verify-full/g);
assert.match(workflow, /PGSSLROOTCERT: \$\{\{ steps\.protected-inputs\.outputs\.ca_file \}\}/g);
assert.match(
  workflow,
  /SUPABASE_CA_CERTIFICATE_PEM: \$\{\{ secrets\.SUPABASE_CA_CERTIFICATE_PEM \}\}/,
);
assert.match(
  workflow,
  /BETA_ADMISSION_RUNTIME_PASSWORD: \$\{\{ secrets\.BETA_ADMISSION_RUNTIME_PASSWORD \}\}/,
);
assert.match(workflow, /pnpm --filter @payreplayy\/beta-admission run db:preflight/);
assert.match(workflow, /steps\.finalize\.outcome != 'success'/);
assert.doesNotMatch(
  workflow,
  /TELEGRAM_BOT_TOKEN|docker compose|docker run|compose up|FINANCIAL_ACTIONS_MODE=live|xzztugbgtulptnbpoelr:\d/,
);

for (const sql of [inspectSql, provisionSql, finalizeSql, disableSql]) {
  assert.match(sql, /payreplayy_beta_admission_runtime/);
  assert.doesNotMatch(sql, /service_role|payreplayy_api_runtime|payreplayy_worker|kemerbet/i);
}

assert.match(inspectSql, /not role\.rolsuper/);
assert.match(inspectSql, /role\.rolconnlimit <> 1/);
assert.match(inspectSql, /membership\.inherit_option/);
assert.match(inspectSql, /not membership\.set_option/);
assert.match(inspectSql, /not membership\.admin_option/);

assert.match(provisionSql, /\\getenv runtime_password BETA_ADMISSION_RUNTIME_PASSWORD/);
assert.match(provisionSql, /not role\.rolcanlogin/);
assert.match(provisionSql, /granted_role\.rolname = 'payreplayy_beta_admission'/);
assert.match(provisionSql, /granted_role\.rolname <> 'payreplayy_beta_admission'/);
assert.match(provisionSql, /password :'runtime_password'/);
assert.match(provisionSql, /clock_timestamp\(\) \+ interval '1 hour'/);
assert.doesNotMatch(provisionSql, /[0-9a-f]{64}/);

assert.match(finalizeSql, /valid until 'infinity'/);
assert.match(finalizeSql, /role\.rolcanlogin/);
assert.match(disableSql, /nologin/);
assert.match(disableSql, /password null/);

console.log('Staging beta runtime preflight contract verified.');
