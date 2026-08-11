import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(workspace, '.github/workflows/staging-beta-runtime-credential-diagnostic.yml'),
  'utf8',
);
const attestationSql = readFileSync(
  resolve(workspace, 'infra/sql/staging-beta-runtime-credential-attest.sql'),
  'utf8',
);

assert.match(workflow, /Temporary staging-only diagnostic/);
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|push:|schedule:/);
assert.match(workflow, /permissions:\s+contents: read/g);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /GITHUB_REPOSITORY" != 'payrelayy\/payrelayy'/);
assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA" != "\$GITHUB_SHA"/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /STAGING_POOLER_HOST: aws-1-eu-west-1\.pooler\.supabase\.com/);
assert.match(workflow, /BETA_RUNTIME_ROLE: payreplayy_beta_admission_runtime/);
assert.match(workflow, /PGSSLMODE: verify-full/g);
assert.match(workflow, /PGSSLROOTCERT:/g);
assert.match(workflow, /PGSERVICEFILE: \/dev\/null/g);
assert.match(workflow, /PGPASSFILE: \/dev\/null/g);
assert.match(workflow, /Allow one bounded Supavisor credential propagation interval/);

const propagationStep = workflow.match(
  /- name: Allow one bounded Supavisor credential propagation interval([\s\S]*?)(?=\n\s+- name:)/,
);
assert.ok(propagationStep, 'Expected one bounded propagation step.');
assert.match(propagationStep[1], /run: sleep 600/);
assert.doesNotMatch(propagationStep[1], /\b(?:for|while|until)\b|psql|db:preflight/);

assert.ok(
  workflow.indexOf('Establish a disabled passwordless baseline') <
    workflow.indexOf('Provision and attest one temporary SCRAM credential') &&
    workflow.indexOf('Provision and attest one temporary SCRAM credential') <
      workflow.indexOf('Allow one bounded Supavisor credential propagation interval') &&
    workflow.indexOf('Allow one bounded Supavisor credential propagation interval') <
      workflow.indexOf('Attempt the beta runtime pooler login exactly once') &&
    workflow.indexOf('Attempt the beta runtime pooler login exactly once') <
      workflow.indexOf('Disable and password-clear the beta runtime after every attempt'),
  'The diagnostic must disable, provision, wait, attempt once, and disable in order.',
);

assert.match(workflow, /infra\/sql\/staging-beta-runtime-provision\.sql/);
assert.match(workflow, /infra\/sql\/staging-beta-runtime-credential-attest\.sql/);
assert.match(workflow, /infra\/sql\/staging-runtime-login-preflight\.sql/);
assert.match(workflow, /infra\/sql\/staging-runtime-session-diagnostics\.sql/);
assert.match(workflow, /if: always\(\) && steps\.provision\.outputs\.attempted == 'true'/);
assert.match(workflow, /for attempt in 1 2 3 4/);
assert.match(workflow, /sleep 15/);
assert.match(workflow, /infra\/sql\/staging-beta-runtime-disable\.sql/g);
assert.doesNotMatch(
  workflow,
  /docker|\bssh\b|compose|deploy|systemctl|TELEGRAM_BOT_TOKEN|FINANCIAL_ACTIONS_MODE|service_role|payreplayy_owner_control_runtime|payreplayy_player_actions_runtime/i,
);

assert.match(attestationSql, /begin;/);
assert.match(attestationSql, /statement_timeout = '5s'/);
assert.match(attestationSql, /lock_timeout = '1s'/);
assert.match(attestationSql, /idle_in_transaction_session_timeout = '5s'/);
assert.match(attestationSql, /payreplayy_beta_admission_runtime/g);
assert.match(attestationSql, /interval '20 minutes'/g);
assert.match(attestationSql, /role\.rolpassword like 'SCRAM-SHA-256\$%'/);
assert.match(attestationSql, /role\.rolcanlogin/);
assert.match(attestationSql, /not role\.rolsuper/);
assert.match(attestationSql, /role\.rolconnlimit = 1/);
assert.match(attestationSql, /commit;/);
assert.doesNotMatch(attestationSql, /raise notice|select\s+role\.rolpassword/i);

console.log('Temporary staging beta runtime credential diagnostic verified.');
