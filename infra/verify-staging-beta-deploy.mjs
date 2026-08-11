import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/staging-beta-deploy-smoke.yml'),
  'utf8',
);
const provision = readFileSync(
  resolve(root, 'infra/sql/staging-runtimes-provision-for-deploy.sql'),
  'utf8',
);
const disable = readFileSync(resolve(root, 'infra/sql/staging-runtimes-disable.sql'), 'utf8');
const diagnostics = readFileSync(
  resolve(root, 'infra/sql/staging-runtime-session-diagnostics.sql'),
  'utf8',
);
const helper = readFileSync(
  resolve(root, 'infra/operations/payreplayy-staging-deploy-helper.sh'),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /STAGING_DROPLET_ID: '590666364'/);
assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_COMMIT.*GITHUB_SHA/);
assert.match(workflow, /CONFIRMED_PROJECT.*STAGING_PROJECT_REF/);
assert.match(workflow, /CONFIRMED_DROPLET.*STAGING_DROPLET_ID/);
assert.match(workflow, /environment: staging/g);
assert.match(workflow, /payreplayy-admin@/g);
assert.doesNotMatch(
  workflow,
  /root@|ssh-keyscan|StrictHostKeyChecking=no|sudo -n (?:docker|bash)|docker\.sock/,
);
assert.match(workflow, /StrictHostKeyChecking=yes/g);
assert.match(workflow, /UserKnownHostsFile=/g);
assert.match(workflow, /payreplayy-staging-deploy-helper verify/g);
assert.match(workflow, /payreplayy-staging-deploy-helper install/g);
assert.match(workflow, /payreplayy-staging-deploy-helper start/g);
assert.match(workflow, /payreplayy-staging-deploy-helper diagnose-owner-startup/g);
assert.match(workflow, /payreplayy-staging-deploy-helper stop/g);
assert.match(workflow, /payreplayy-staging-deploy-helper discard/g);
assert.match(workflow, /sha256sum infra\/operations\/payreplayy-staging-deploy-helper\.sh/g);
assert.match(workflow, /persist-credentials: false/g);
assert.match(workflow, /docker build --pull=false --target admin/);
assert.match(workflow, /docker build --pull=false --target api/);
assert.match(workflow, /docker build --pull=false --target beta-admission/);
assert.match(workflow, /docker build --pull=false --target bot/);
assert.match(workflow, /org\.opencontainers\.image\.revision/);
assert.match(workflow, /http:\/\/127\.0\.0\.1:3002\/readyz/);
assert.match(workflow, /stop-and-disable/);
assert.match(workflow, /infra\/sql\/staging-runtimes-disable\.sql/g);
assert.match(workflow, /- name: Wait once for staging runtime credential propagation/);
assert.equal(
  (workflow.match(/run: sleep 125/g) ?? []).length,
  1,
  'Deployment must use exactly one bounded credential-propagation wait.',
);
assert.ok(
  workflow.indexOf('Provision three narrow 24-hour staging logins') <
    workflow.indexOf('Wait once for staging runtime credential propagation') &&
    workflow.indexOf('Wait once for staging runtime credential propagation') <
      workflow.indexOf('Transfer and install sealed release inputs') &&
    workflow.indexOf('Transfer and install sealed release inputs') <
      workflow.indexOf('Start the private staging profile and smoke readiness'),
  'Credential propagation must complete after provisioning and before transfer or activation.',
);
assert.match(workflow, /Capture count-only runtime session diagnostics after failed activation/);
assert.match(workflow, /Capture bounded Owner-control startup diagnostics/);
assert.match(workflow, /infra\/sql\/staging-runtime-session-diagnostics\.sql/);
assert.ok(
  workflow.indexOf('Capture bounded Owner-control startup diagnostics') <
    workflow.indexOf('Capture count-only runtime session diagnostics after failed activation') &&
    workflow.indexOf('Capture count-only runtime session diagnostics after failed activation') <
      workflow.indexOf('Roll back failed activation'),
  'Bounded startup and count-only database diagnostics must run before rollback removes the runtime state.',
);
assert.match(workflow, /BETA_ADMISSION_RUNTIME_PASSWORD/);
assert.match(workflow, /OWNER_CONTROL_RUNTIME_PASSWORD/);
assert.match(workflow, /PLAYER_ACTION_RUNTIME_PASSWORD/);
assert.match(workflow, /BOT_TO_API_ACTION_HMAC_SECRET/);
assert.match(workflow, /API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET/);
assert.match(workflow, /API_TELEGRAM_CAPABILITY_HMAC_SECRET/);
assert.match(workflow, /API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET/);
assert.match(workflow, /distinct_count/);
assert.match(workflow, /STAGING_TELEGRAM_BOT_TOKEN/);
assert.match(workflow, /STAGING_SUPABASE_PUBLISHABLE_KEY/);
assert.match(workflow, /SUPABASE_CA_CERTIFICATE_PEM/);
assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE|service_role|FINANCIAL_ACTIONS_MODE=live/);

for (const sql of [provision, disable]) {
  assert.match(sql, /payreplayy_beta_admission_runtime/);
  assert.match(sql, /payreplayy_owner_control_runtime/);
  assert.match(sql, /payreplayy_player_actions_runtime/);
  assert.doesNotMatch(sql, /payreplayy_api_runtime|payreplayy_worker|service_role|kemerbet/i);
}
assert.match(provision, /interval '24 hours'/g);
assert.match(disable, /nologin/g);
assert.match(disable, /password null/g);
assert.match(disable, /pg_catalog\.pg_terminate_backend\(activity_pid, 5000\)/);
assert.match(disable, /from pg_catalog\.pg_stat_activity as activity/g);
assert.match(disable, /perform pg_catalog\.pg_stat_clear_snapshot\(\)/);
assert.ok(
  disable.indexOf('nologin') < disable.indexOf('pg_catalog.pg_terminate_backend'),
  'The logins must be disabled before existing runtime sessions are terminated.',
);
assert.ok(
  disable.indexOf('pg_catalog.pg_terminate_backend') <
    disable.indexOf('perform pg_catalog.pg_stat_clear_snapshot()') &&
    disable.indexOf('perform pg_catalog.pg_stat_clear_snapshot()') <
      disable.lastIndexOf('from pg_catalog.pg_stat_activity as activity'),
  'Cleanup must clear the statistics snapshot after termination and before verifying zero sessions.',
);

assert.match(diagnostics, /from pg_catalog\.pg_stat_activity as activity/);
assert.match(diagnostics, /count\(\*\)::integer as session_count/);
assert.match(diagnostics, /payreplayy_player_actions_runtime/);
assert.doesNotMatch(diagnostics, /\bpid\b|client_addr|\bquery\b|password|secret/i);

assert.match(helper, /^#!\/usr\/bin\/env bash/);
assert.match(helper, /EXPECTED_SUDO_USER='payreplayy-admin'/);
assert.match(helper, /HELPER_PATH='\/usr\/local\/sbin\/payreplayy-staging-deploy-helper'/);
assert.match(helper, /root:root:755/);
assert.match(helper, /DOCKER_HOST="\$LOCAL_DOCKER_SOCKET"/);
assert.match(helper, /--env-file \/dev\/null/);
assert.match(helper, /--project-name "\$PROJECT_NAME"/);
assert.match(helper, /up -d --no-build --wait --wait-timeout 90/);
assert.doesNotMatch(helper, /curl|wget|git |\.env|xzztugbgtulptnbpoelr/);

const ownerDiagnostic = /diagnose-owner-startup\)([\s\S]*?)\n\s*;;/u.exec(helper)?.[1];
assert.ok(ownerDiagnostic, 'The helper must define bounded Owner-control startup diagnostics.');
assert.match(ownerDiagnostic, /com\.docker\.compose\.project=\$PROJECT_NAME/);
assert.match(ownerDiagnostic, /com\.docker\.compose\.service=owner-control/);
assert.match(ownerDiagnostic, /org\.opencontainers\.image\.revision/);
assert.match(ownerDiagnostic, /container logs --tail 80/);
assert.doesNotMatch(ownerDiagnostic, /inspect .*\{\{json \.Config\}\}|container logs .*bot/);

console.log(
  'staging deploy workflow verified: manual exact-target guards, sealed images, checksummed root helper, bounded runtime credentials, and stop path',
);
