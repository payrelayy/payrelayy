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
const disableSql = readFileSync(
  resolve(workspace, 'infra/sql/staging-beta-runtime-disable.sql'),
  'utf8',
);
const diagnosticsSql = readFileSync(
  resolve(workspace, 'infra/sql/staging-runtime-session-diagnostics.sql'),
  'utf8',
);

function getRoleAlterOptions(sql) {
  const match = sql.match(/alter role payreplayy_beta_admission_runtime with([\s\S]*?);/i);
  assert.ok(match, 'Expected a beta-admission runtime ALTER ROLE statement.');
  return match[1];
}

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|push:|schedule:/);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA" != "\$GITHUB_SHA"/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /STAGING_POOLER_HOST: aws-1-eu-west-1\.pooler\.supabase\.com/);
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
assert.match(workflow, /Allow one bounded Supavisor credential propagation interval/);
const propagationStep = workflow.match(
  /- name: Allow one bounded Supavisor credential propagation interval([\s\S]*?)(?=\n\s+- name:)/,
);
assert.ok(propagationStep, 'Expected one bounded Supavisor propagation step.');
assert.match(propagationStep[1], /run: sleep 125/);
assert.doesNotMatch(propagationStep[1], /\b(?:for|while|until)\b|db:preflight|psql/);
assert.ok(
  workflow.indexOf('Provision a one-hour staging login') <
    workflow.indexOf('Allow one bounded Supavisor credential propagation interval') &&
    workflow.indexOf('Allow one bounded Supavisor credential propagation interval') <
      workflow.indexOf('Run the dedicated catalog-only preflight'),
  'Supavisor credential propagation must happen once after provisioning and before preflight.',
);
const buildAndPreflightCommands = [
  'pnpm --filter @payreplayy/domain run build',
  'pnpm --filter @payreplayy/config run build',
  'pnpm --filter @payreplayy/contracts run build',
  'pnpm --filter @payreplayy/beta-admission run build',
  'pnpm --filter @payreplayy/beta-admission run db:preflight',
];
const buildAndPreflightOffsets = buildAndPreflightCommands.map((command) =>
  workflow.indexOf(command),
);
assert.ok(buildAndPreflightOffsets.every((offset) => offset >= 0));
assert.deepEqual(
  buildAndPreflightOffsets,
  [...buildAndPreflightOffsets].sort((a, b) => a - b),
);
assert.match(workflow, /Disable and clear the login after every preflight attempt/);
assert.match(workflow, /Capture count-only runtime session diagnostics after a failed preflight/);
assert.match(workflow, /infra\/sql\/staging-runtime-session-diagnostics\.sql/);
assert.ok(
  workflow.indexOf('Capture count-only runtime session diagnostics after a failed preflight') <
    workflow.indexOf('Disable and clear the login after every preflight attempt'),
  'Failure diagnostics must run before session cleanup.',
);
assert.match(workflow, /if: always\(\) && steps\.provision\.outputs\.attempted == 'true'/);
assert.match(workflow, /run: psql -X --file=infra\/sql\/staging-beta-runtime-disable\.sql/);
assert.doesNotMatch(workflow, /steps\.finalize|staging-beta-runtime-finalize\.sql/);
assert.doesNotMatch(
  workflow,
  /TELEGRAM_BOT_TOKEN|docker compose|docker run|compose up|FINANCIAL_ACTIONS_MODE=live|xzztugbgtulptnbpoelr:\d/,
);

for (const sql of [inspectSql, provisionSql, disableSql]) {
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
assert.match(getRoleAlterOptions(provisionSql), /\blogin\b/i);
assert.doesNotMatch(getRoleAlterOptions(provisionSql), /\b(?:no)?superuser\b/i);

assert.match(disableSql, /nologin/);
assert.match(disableSql, /password null/);
assert.match(disableSql, /pg_catalog\.pg_terminate_backend\(activity_pid, 5000\)/);
assert.match(disableSql, /from pg_catalog\.pg_stat_activity as activity/g);
assert.ok(
  disableSql.indexOf('nologin') < disableSql.indexOf('pg_catalog.pg_terminate_backend'),
  'The login must be disabled before existing runtime sessions are terminated.',
);
assert.doesNotMatch(getRoleAlterOptions(disableSql), /\b(?:no)?superuser\b/i);
assert.match(disableSql, /from pg_catalog\.pg_authid as role/);
assert.match(disableSql, /not role\.rolcanlogin/);
assert.match(disableSql, /role\.rolpassword is null/);

assert.match(diagnosticsSql, /from pg_catalog\.pg_stat_activity as activity/);
assert.match(diagnosticsSql, /count\(\*\)::integer as session_count/);
assert.doesNotMatch(diagnosticsSql, /\bpid\b|client_addr|\bquery\b|password|secret/i);

console.log('Staging beta runtime preflight contract verified.');
