import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(`${repositoryRoot}${path}`, 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const [compose, helper, sudoers, workflow, provision, status, disable, runbook, packageText] =
  await Promise.all([
    read('infra/compose.telebirr-shadow-verifier.yaml'),
    read('infra/operations/fetanagent-telebirr-shadow-verifier-helper.sh'),
    read('infra/operations/fetanagent-telebirr-shadow-verifier-helper.sudoers'),
    read('.github/workflows/staging-telebirr-shadow-verifier.yml'),
    read('infra/sql/staging-telebirr-shadow-verifier-provision.sql'),
    read('infra/sql/staging-telebirr-shadow-verifier-status.sql'),
    read('infra/sql/staging-telebirr-shadow-verifier-disable.sql'),
    read('infra/staging-telebirr-shadow-verifier.md'),
    read('package.json'),
  ]);

const packageJson = JSON.parse(packageText);
const composeDigest = sha256(compose);
const helperDigest = sha256(helper);
const jobBody = (name) => {
  const body = workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z][a-z0-9-]*:\n/u)[0];
  assert.ok(body, `workflow job ${name} is missing`);
  return body;
};

assert.match(helper, new RegExp(`EXPECTED_COMPOSE_SHA256='${composeDigest}'`, 'u'));
assert.equal((sudoers.match(new RegExp(`sha256:${helperDigest}`, 'gu')) ?? []).length, 8);
assert.doesNotMatch(sudoers, /NOPASSWD:\s*ALL|\/bin\/(?:ba)?sh|docker/u);

assert.match(workflow, /^on:\r?\n\s{2}workflow_dispatch:/mu);
assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule|workflow_run):/mu);
for (const mode of ['plan', 'deploy', 'status', 'stop']) {
  assert.match(workflow, new RegExp(`^\\s{10}- ${mode}$`, 'mu'));
}
assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/u);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT.*GITHUB_SHA/u);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /environment: staging/gu);
assert.match(workflow, /openssl rand -hex 32/u);
assert.match(workflow, /staging-telebirr-shadow-verifier-provision\.sql/u);
assert.match(workflow, /staging-runtime-login-preflight\.sql/u);
assert.match(workflow, /fetanagent-staging-direct-database-tunnel\.sh/u);
assert.match(workflow, /staging-telebirr-shadow-verifier-disable\.sql/gu);
assert.match(workflow, /always\(\)[\s\S]*needs\.deploy\.result != 'success'/u);
assert.match(workflow, /activeRuntimeSessions == 1/u);
assert.doesNotMatch(workflow, /workflow_call|repository_dispatch|curl\s+.*(?:kemerbet|telebirr)/iu);

const failedHostCleanup = jobBody('failed-deploy-host-cleanup');
const failedDatabaseCleanup = jobBody('failed-deploy-database-cleanup');
const stopHost = jobBody('stop-host');
const stopDatabase = jobBody('stop-database');
for (const hostOnlyJob of [failedHostCleanup, stopHost]) {
  assert.match(hostOnlyJob, /needs: \[?validate-target/u);
  assert.match(hostOnlyJob, /timeout --signal=TERM --kill-after=5s 60s ssh/u);
  assert.match(hostOnlyJob, /ConnectTimeout=5/u);
  assert.doesNotMatch(
    hostOnlyJob,
    /SUPABASE_DB_PASSWORD|\bpsql\b|staging-telebirr-shadow-verifier-disable\.sql/u,
  );
}
for (const databaseOnlyJob of [failedDatabaseCleanup, stopDatabase]) {
  assert.match(databaseOnlyJob, /needs: \[?validate-target/u);
  assert.match(databaseOnlyJob, /staging-telebirr-shadow-verifier-disable\.sql/u);
  assert.match(databaseOnlyJob, /staging-telebirr-shadow-verifier-status\.sql/u);
  assert.doesNotMatch(databaseOnlyJob, /\bssh\b|STAGING_VM_|deploy-key|known-hosts/u);
}
assert.doesNotMatch(failedHostCleanup, /needs\.deploy\.outputs|cleanup_required/u);
assert.doesNotMatch(failedDatabaseCleanup, /needs\.deploy\.outputs|cleanup_required/u);
assert.match(failedHostCleanup, /needs\.build\.result == 'success'/u);
assert.match(failedDatabaseCleanup, /needs\.build\.result == 'success'/u);

assert.match(compose, /FETANAGENT_TELEBIRR_SHADOW_VERIFIER_IMAGE_ID/u);
assert.match(compose, /^\s{4}pull_policy: never$/mu);
assert.match(compose, /^\s{6}FINANCIAL_ACTIONS_MODE: dry_run$/mu);
assert.match(compose, /^\s{6}INTERNAL_TELEBIRR_SHADOW_VERIFIER_ENABLED: 'true'$/mu);
assert.match(compose, /^\s{6}TELEBIRR_SHADOW_VERIFICATION_ENABLED: 'true'$/mu);
assert.match(compose, /^\s{6}TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: 'false'$/mu);
assert.match(compose, /^\s{6}KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false'$/mu);
assert.match(compose, /^\s{4}enable_ipv6: true$/mu);
assert.match(compose, /^\s{4}internal: false$/mu);
assert.match(compose, /^\s{4}attachable: false$/mu);
assert.doesNotMatch(compose, /^\s+(?:ports|expose|build|privileged|pid|ipc|network_mode):/imu);
assert.doesNotMatch(
  compose,
  /docker\.sock|TELEGRAM_BOT_TOKEN|service[_ -]?role|private[_ -]?key/iu,
);

for (const exact of [
  "readonly STAGING_DIRECT_DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'",
  "readonly PROJECT_NAME='fetanagent-telebirr-shadow-verifier'",
  "readonly SERVICE_NAME='telebirr-shadow-verifier'",
  "readonly IMAGE_NAME='fetanagent-telebirr-shadow-verifier'",
]) {
  assert.match(helper, new RegExp(exact.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
}
assert.match(helper, /org\.opencontainers\.image\.revision/u);
assert.match(helper, /\.Config\.ExposedPorts/u);
assert.match(helper, /HostConfig\.PortBindings/u);
assert.match(helper, /FINANCIAL_ACTIONS_MODE=dry_run/u);
assert.match(helper, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=false/u);
assert.match(helper, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false/u);
assert.match(helper, /bridge\|true\|false\|false/u);
assert.match(helper, /container rm --force/u);
assert.match(helper, /require_no_project_containers/u);
assert.match(helper, /an active shadow-verifier release must be explicitly stopped first/u);
assert.doesNotMatch(helper, /feature_switches|alter role|\bpsql\b/iu);

assert.match(provision, /begin transaction isolation level serializable/u);
assert.match(provision, /fetanagent:staging:telebirr-shadow-verifier-runtime/u);
assert.match(provision, /for share/u);
assert.match(provision, /mode = 'disabled'/u);
assert.match(provision, /mode = 'dry_run'/u);
assert.match(provision, /alter role fetanagent_telebirr_shadow_verifier_runtime with\s+login/iu);
assert.match(provision, /connection limit 1 password :'shadow_runtime_password'/u);
assert.match(provision, /clock_timestamp\(\) \+ interval '24 hours'/u);
assert.match(provision, /membership\.inherit_option/u);
assert.match(provision, /not membership\.set_option/u);
assert.match(provision, /not membership\.admin_option/u);
assert.doesNotMatch(provision, /(?:insert\s+into|update|delete\s+from)\s+app\./iu);

assert.match(status, /transaction isolation level serializable read only/u);
assert.match(status, /activeRuntimeSessions/u);
assert.match(status, /executorBoundary/u);
assert.match(status, /financialBoundary/u);
assert.doesNotMatch(
  status,
  /alter role|pg_terminate_backend|(?:insert\s+into|update|delete\s+from)\s+app\./iu,
);

assert.match(disable, /alter role fetanagent_telebirr_shadow_verifier_runtime with\s+nologin/iu);
assert.match(disable, /password null valid until 'infinity'/u);
assert.match(disable, /pg_terminate_backend/u);
assert.match(disable, /financialSwitchesChanged', false/u);
assert.doesNotMatch(
  disable,
  /(?:insert\s+into|update|delete\s+from)\s+app\.|alter table|create /iu,
);

assert.match(runbook, /PLAN STAGING SHADOW VERIFIER/u);
assert.match(runbook, /DEPLOY STAGING SHADOW VERIFIER NO MONEY/u);
assert.match(runbook, /STATUS STAGING SHADOW VERIFIER/u);
assert.match(runbook, /STOP STAGING SHADOW VERIFIER/u);
assert.match(runbook, /does not apply a\s+migration/iu);
assert.match(
  packageJson.scripts['test:infra'],
  /node infra\/verify-telebirr-shadow-verifier-staging-lifecycle\.mjs/u,
);

console.log(
  'TeleBirr shadow verifier staging lifecycle verified: manual exact-commit plan/deploy/status/stop, immutable image ID, bounded one-connection runtime, dry-run-only process, live/KemerBet gates off, no public ingress, and fail-closed dual cleanup',
);
