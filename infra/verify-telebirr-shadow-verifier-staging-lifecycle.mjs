import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(`${repositoryRoot}${path}`, 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const [
  compose,
  helper,
  archiveValidator,
  archiveValidatorTests,
  sudoers,
  workflow,
  provision,
  status,
  disable,
  runbook,
  qualityWorkflow,
  imageSmokeWorkflow,
  sqlIntegrationWorkflow,
  sqlRunnerDockerfile,
  sqlCatalog,
  sqlLifecycleSuite,
  sqlCompose,
  packageText,
] = await Promise.all([
  read('infra/compose.telebirr-shadow-verifier.yaml'),
  read('infra/operations/fetanagent-telebirr-shadow-verifier-helper.sh'),
  read('infra/operations/fetanagent-telebirr-shadow-verifier-image-archive-validator.py'),
  read('infra/operations/test_fetanagent_telebirr_shadow_verifier_image_archive_validator.py'),
  read('infra/operations/fetanagent-telebirr-shadow-verifier-helper.sudoers'),
  read('.github/workflows/staging-telebirr-shadow-verifier.yml'),
  read('infra/sql/staging-telebirr-shadow-verifier-provision.sql'),
  read('infra/sql/staging-telebirr-shadow-verifier-status.sql'),
  read('infra/sql/staging-telebirr-shadow-verifier-disable.sql'),
  read('infra/staging-telebirr-shadow-verifier.md'),
  read('.github/workflows/quality.yml'),
  read('.github/workflows/telebirr-shadow-verifier-image-smoke.yml'),
  read('.github/workflows/sql-integration.yml'),
  read('infra/Dockerfile.sql-integration'),
  read('packages/sql-integration-tests/src/catalog-baseline.test.ts'),
  read('packages/sql-integration-tests/src/staging-telebirr-shadow-verifier-lifecycle.suite.ts'),
  read('infra/compose.sql-integration.yaml'),
  read('package.json'),
]);

const packageJson = JSON.parse(packageText);
const composeDigest = sha256(compose);
const helperDigest = sha256(helper);
const archiveValidatorDigest = sha256(archiveValidator);
const lifecycleLockKeyPattern = String.raw`pg_catalog\.hashtextextended\(\s*'fetanagent:staging:telebirr-shadow-verifier-runtime'\s*,\s*0\s*\)`;
const jobBody = (name) => {
  const body = workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z][a-z0-9-]*:\n/u)[0];
  assert.ok(body, `workflow job ${name} is missing`);
  return body;
};

assert.match(helper, new RegExp(`EXPECTED_COMPOSE_SHA256='${composeDigest}'`, 'u'));
assert.match(
  helper,
  new RegExp(`EXPECTED_ARCHIVE_VALIDATOR_SHA256='${archiveValidatorDigest}'`, 'u'),
);
assert.equal((sudoers.match(new RegExp(`sha256:${helperDigest}`, 'gu')) ?? []).length, 8);
assert.doesNotMatch(sudoers, /NOPASSWD:\s*ALL|\/bin\/(?:ba)?sh|docker/u);
assert.doesNotMatch(sudoers, /fdexec=never/u);

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
assert.equal(
  (workflow.match(/fetanagent-telebirr-shadow-verifier-image-archive-validator\.py/gu) ?? [])
    .length,
  2,
);
assert.match(workflow, /test_fetanagent_telebirr_shadow_verifier_image_archive_validator\.py/u);
assert.match(workflow, /TELEBIRR_SHADOW_VERIFIER_RELEASE_SIGNING_PRIVATE_KEY_PEM/u);
assert.match(workflow, /fetanagent\.telebirr-shadow-verifier\.staging-release\.v1/u);
assert.match(workflow, /imageArchiveSha256/u);
assert.match(workflow, /imageConfigDigest/u);
assert.match(workflow, /imageManifestDigest/u);
assert.match(workflow, /dsaEncoding: 'der'/u);
assert.match(workflow, /trap cleanup_unpublished_protected EXIT/u);
assert.match(workflow, /protected_published=true/u);
assert.match(
  workflow,
  /image_archive_sha256: \$\{\{ steps\.bundle\.outputs\.image_archive_sha256 \}\}/u,
);
assert.match(
  workflow,
  /BUILT_IMAGE_ARCHIVE_SHA256: \$\{\{ needs\.build\.outputs\.image_archive_sha256 \}\}/u,
);
assert.match(workflow, /"\$archive_digest" == "\$BUILT_IMAGE_ARCHIVE_SHA256"/u);
assert.match(workflow, /staging-telebirr-shadow-verifier-disable\.sql/gu);
assert.match(workflow, /always\(\)[\s\S]*needs\.deploy\.result != 'success'/u);
assert.match(workflow, /activeRuntimeSessions == 1/u);
assert.doesNotMatch(workflow, /workflow_call|repository_dispatch|curl\s+.*(?:kemerbet|telebirr)/iu);
assert.equal((workflow.match(/printf '%s' "\$SUPABASE_CA_CERTIFICATE_PEM"/gu) ?? []).length, 4);
assert.doesNotMatch(workflow, /printf '%s\\n' "\$SUPABASE_CA_CERTIFICATE_PEM"/u);
assert.match(qualityWorkflow, /^\s{2}pull_request:\r?$/mu);
assert.match(
  qualityWorkflow,
  /python3 -I infra\/operations\/test_fetanagent_telebirr_shadow_verifier_image_archive_validator\.py/u,
);
assert.match(imageSmokeWorkflow, /^\s{2}pull_request:\r?$/mu);
assert.match(imageSmokeWorkflow, /docker save --output "\$archive" "\$release_image"/u);
assert.match(
  imageSmokeWorkflow,
  /fetanagent-telebirr-shadow-verifier-image-archive-validator\.py[\s\\]*\n\s+"\$archive" "\$release_tag" "\$GITHUB_SHA"/u,
);
assert.match(sqlIntegrationWorkflow, /^\s{2}pull_request:\r?$/mu);
assert.match(sqlIntegrationWorkflow, /pnpm test:sql/u);
assert.match(
  sqlRunnerDockerfile,
  /postgres:17\.4-bookworm@sha256:304ab813518754228f9f792f79d6da36359b82d8ecf418096c636725f8c930ad AS runner/u,
);
assert.match(sqlRunnerDockerfile, /psql --version.*17\\\.4/u);
assert.match(sqlRunnerDockerfile, /psql --help=commands/u);
assert.match(sqlRunnerDockerfile, /ENV HOME=\/home\/node/u);
assert.match(sqlRunnerDockerfile, /ENTRYPOINT \["\/usr\/bin\/env", "-u", "PGDATA"/u);
assert.doesNotMatch(sqlRunnerDockerfile, /apt-get|postgresql-client/u);
assert.match(sqlCompose, /POSTGRES_HOST_AUTH_METHOD: scram-sha-256/u);
assert.match(sqlCompose, /POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256/u);
assert.match(sqlCompose, /SQL_INTEGRATION_POSTGRES_PASSWORD: TEST-ONLY-NOT-A-SECRET/u);
assert.doesNotMatch(sqlCompose, /POSTGRES_HOST_AUTH_METHOD: trust/u);
for (const scriptName of [
  'staging-telebirr-shadow-verifier-provision.sql',
  'staging-telebirr-shadow-verifier-status.sql',
  'staging-telebirr-shadow-verifier-disable.sql',
]) {
  assert.match(
    sqlRunnerDockerfile,
    new RegExp(`COPY infra/sql/${scriptName.replaceAll('.', '\\.')}`, 'u'),
  );
  assert.match(sqlLifecycleSuite, new RegExp(scriptName.replaceAll('.', '\\.'), 'u'));
}
assert.match(
  sqlCatalog,
  /registerStagingTelebirrShadowVerifierLifecycleSqlTests\([\s\S]*fetanagent_telebirr_shadow_verifier_runtime/u,
);
assert.match(sqlLifecycleSuite, /projectRef: productionProjectRef/u);
assert.match(sqlLifecycleSuite, /setRole: ownerControlRole/u);
assert.match(sqlLifecycleSuite, /unsafe financial precondition/u);
assert.match(sqlLifecycleSuite, /too many connections/iu);
assert.match(sqlLifecycleSuite, /executePsql\(disableScript\)/u);
assert.match(sqlLifecycleSuite, /relation_access_count/u);
assert.match(sqlLifecycleSuite, /readNoMoneySnapshot/u);
assert.match(sqlLifecycleSuite, /PGPASSFILE: '\/dev\/null'/u);
assert.match(sqlLifecycleSuite, /PGSERVICEFILE: '\/dev\/null'/u);
assert.match(sqlLifecycleSuite, /password authentication failed/iu);
assert.match(sqlLifecycleSuite, /VALID UNTIL expires/u);
assert.match(sqlLifecycleSuite, /non_system_schema_usage_exact/u);
assert.match(sqlLifecycleSuite, /no_non_system_schema_create/u);
assert.match(sqlLifecycleSuite, /allowed_functions_execution_private/u);
assert.match(sqlLifecycleSuite, /default_function_execution_private/u);

const failedHostCleanup = jobBody('failed-deploy-host-cleanup');
const failedDatabaseCleanup = jobBody('failed-deploy-database-cleanup');
const deploy = jobBody('deploy');
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
const hostStartIndex = deploy.indexOf('Transfer, install, start, and attest the exact release');
const finalDatabaseIndex = deploy.indexOf(
  'Require the final database no-money and one-session attestation',
);
const evidenceIndex = deploy.indexOf('Record the no-money deployment evidence');
assert.ok(
  hostStartIndex >= 0 && finalDatabaseIndex > hostStartIndex && evidenceIndex > finalDatabaseIndex,
);
const finalDatabase = deploy.slice(finalDatabaseIndex, evidenceIndex);
assert.match(finalDatabase, /staging-telebirr-shadow-verifier-status\.sql/u);
assert.match(finalDatabase, /runtimeLogin == "bounded"/u);
assert.match(finalDatabase, /activeRuntimeSessions == 1/u);
assert.match(finalDatabase, /financialBoundary == "dry_run"/u);
assert.match(finalDatabase, /executorBoundary == "disabled"/u);
assert.equal((workflow.match(/"\$PGHOST" == "\$STAGING_POOLER_HOST"/gu) ?? []).length, 5);
assert.equal((workflow.match(/"\$PGUSER" == "postgres\.\$STAGING_PROJECT_REF"/gu) ?? []).length, 5);

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
assert.match(helper, /\.Config\.Entrypoint == \["docker-entrypoint\.sh"\]/u);
assert.match(helper, /\.Config\.WorkingDir == "\/workspace"/u);
assert.match(helper, /RELEASE_SIGNING_PUBLIC_KEY='\/etc\/fetanagent\//u);
assert.match(helper, /openssl dgst -sha256 -verify/u);
assert.match(helper, /image archive does not match the signed digest/u);
assert.match(helper, /loading the signed image changed an unrelated Docker tag/u);
assert.match(helper, /INSTALL_IMAGE_WAS_ABSENT='true'/u);
assert.match(helper, /INSTALL_RELEASE_PUBLISHED='true'/u);
assert.match(helper, /docker_local image rm -- "\$INSTALL_LOADED_IMAGE_TAG"/u);
assert.match(helper, /docker --host "\$DOCKER_SOCKET" network rm/u);
assert.match(helper, /HostConfig\.PortBindings/u);
assert.match(helper, /FINANCIAL_ACTIONS_MODE=dry_run/u);
assert.match(helper, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=false/u);
assert.match(helper, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false/u);
assert.match(helper, /bridge\|true\|false\|false/u);
assert.match(helper, /container rm --force/u);
assert.match(helper, /require_no_project_containers/u);
assert.match(helper, /an active shadow-verifier release must be explicitly stopped first/u);
assert.match(helper, /invoked_from_installed_file "\$0" "\$@"/u);
assert.match(helper, /^require_installed_helper "\$@"$/mu);
assert.match(helper, /"\$\{SUDO_COMMAND:-\}" == "\$expected_sudo_command"/u);
assert.match(helper, /"\$argument" != \*\[\[:space:\]\]\*/u);
assert.match(helper, /\^\/\(proc\/self\/fd\|dev\/fd\)\/\[0-9\]\+\$/u);
assert.match(helper, /stat -L --format='%u:%g:%a:%h:%d:%i' -- "\$invoked_path"/u);
assert.match(helper, /the helper invocation does not identify its installed file/u);
assert.doesNotMatch(helper, /"\$0" == "\$HELPER_PATH"/u);
assert.doesNotMatch(helper, /feature_switches|alter role|\bpsql\b/iu);

if (process.platform !== 'win32') {
  const invocationFunction = /invoked_from_installed_file\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
  assert.ok(invocationFunction);
  const digest = 'a'.repeat(64);
  for (const [name, helperPath, invokedPath, sudoUser, sudoCommand, invocation, pass] of [
    [
      'installed path',
      '/bin/bash',
      '$HELPER_PATH',
      'fetanagent-admin',
      '',
      `verify ${digest}`,
      true,
    ],
    [
      'sudo digest proc descriptor',
      '/bin/bash',
      '/proc/self/fd/7',
      'fetanagent-admin',
      `$HELPER_PATH verify ${digest}`,
      `verify ${digest}`,
      true,
    ],
    [
      'sudo digest dev descriptor',
      '/bin/bash',
      '/dev/fd/7',
      'fetanagent-admin',
      `$HELPER_PATH verify ${digest}`,
      `verify ${digest}`,
      true,
    ],
    [
      'unrelated descriptor',
      '/bin/bash',
      '/dev/fd/8',
      'fetanagent-admin',
      `$HELPER_PATH verify ${digest}`,
      `verify ${digest}`,
      false,
    ],
    [
      'stale helper descriptor',
      '/bin/sh',
      '/dev/fd/7',
      'fetanagent-admin',
      `$HELPER_PATH verify ${digest}`,
      `verify ${digest}`,
      false,
    ],
    [
      'different invoking identity',
      '/bin/bash',
      '/dev/fd/7',
      'unrelated-user',
      `$HELPER_PATH verify ${digest}`,
      `verify ${digest}`,
      false,
    ],
    [
      'missing original command',
      '/bin/bash',
      '/dev/fd/7',
      'fetanagent-admin',
      '',
      `verify ${digest}`,
      false,
    ],
    [
      'different original command',
      '/bin/bash',
      '/dev/fd/7',
      'fetanagent-admin',
      `$HELPER_PATH verify ${digest} extra`,
      `verify ${digest}`,
      false,
    ],
    [
      'non-descriptor alias',
      '/bin/bash',
      '/tmp/unreviewed-shadow-helper',
      'fetanagent-admin',
      `$HELPER_PATH verify ${digest}`,
      `verify ${digest}`,
      false,
    ],
    [
      'noncanonical proc descriptor',
      '/bin/bash',
      '/proc/$$/fd/7',
      'fetanagent-admin',
      `$HELPER_PATH verify ${digest}`,
      `verify ${digest}`,
      false,
    ],
    [
      'whitespace-bearing argument',
      '/bin/bash',
      '/dev/fd/7',
      'fetanagent-admin',
      '$HELPER_PATH verify value with spaces',
      "verify 'value with spaces'",
      false,
    ],
  ]) {
    const result = spawnSync('/bin/bash', ['-s'], {
      input: `set -euo pipefail
HELPER_PATH=${helperPath}
EXPECTED_SUDO_USER=fetanagent-admin
SUDO_USER=${sudoUser}
SUDO_COMMAND="${sudoCommand}"
exec 7</bin/bash
exec 8</etc/hosts
${invocationFunction}
invoked_from_installed_file "${invokedPath}" ${invocation}
`,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status === 0, pass, `${name}: ${result.stderr}`);
  }
}

assert.match(archiveValidator, /docker-save-legacy-v1/u);
assert.match(archiveValidator, /docker-save-oci-v1/u);
assert.match(archiveValidator, /len\(docker_manifest\) != 1/u);
assert.match(archiveValidator, /runtime\.get\("Entrypoint"\) != EXPECTED_ENTRYPOINT/u);
assert.match(archiveValidator, /def hash_exact/u);
assert.match(archiveValidator, /stream\.read\(1024 \* 1024\)/u);
assert.doesNotMatch(archiveValidator, /stream\.read\(MAX_(?:ARCHIVE|LAYER)_BYTES/u);
assert.match(archiveValidatorTests, /test_accepts_singular_legacy_docker_save/u);
assert.match(archiveValidatorTests, /test_accepts_singular_oci_backed_docker_save/u);
assert.match(archiveValidatorTests, /test_rejects_multiple_tags/u);
assert.match(archiveValidatorTests, /test_rejects_non_object_oci_descriptors/u);
assert.match(archiveValidatorTests, /test_rejects_non_object_config_descriptors/u);
assert.match(archiveValidatorTests, /test_rejects_non_object_image_configs/u);
assert.match(
  archiveValidatorTests,
  /test_rejects_unsafe_members_duplicate_names_and_extra_payloads/u,
);
assert.match(archiveValidatorTests, /test_rejects_blob_digest_and_descriptor_size_mismatches/u);
assert.match(archiveValidatorTests, /test_rejects_wrong_or_financial_runtime_config/u);
assert.match(archiveValidatorTests, /test_rejects_archive_identity_tag_and_release_mismatches/u);

assert.match(provision, /begin transaction isolation level serializable/u);
assert.match(provision, /fetanagent:staging:telebirr-shadow-verifier-runtime/u);
assert.equal(
  (
    provision.match(
      new RegExp(
        `pg_catalog\\.pg_advisory_xact_lock\\(\\s*${lifecycleLockKeyPattern}\\s*\\)`,
        'gu',
      ),
    ) ?? []
  ).length,
  1,
);
assert.match(provision, /for share/u);
assert.match(provision, /set local password_encryption = 'scram-sha-256'/u);
assert.match(provision, /mode = 'disabled'/u);
assert.match(provision, /mode = 'dry_run'/u);
assert.match(provision, /alter role fetanagent_telebirr_shadow_verifier_runtime with\s+login/iu);
assert.match(provision, /connection limit 1 password :'shadow_runtime_password'/u);
assert.match(provision, /clock_timestamp\(\) \+ interval '24 hours'/u);
assert.match(provision, /membership\.inherit_option/u);
assert.match(provision, /not membership\.set_option/u);
assert.match(provision, /not membership\.admin_option/u);
assert.doesNotMatch(provision, /(?:insert\s+into|update|delete\s+from)\s+app\./iu);

for (const operationalSql of [provision, status, disable]) {
  assert.match(operationalSql, /\\getenv confirmed_project_ref STAGING_PROJECT_REF/u);
  assert.match(operationalSql, /'spzpiyxheappsfyswewl'/u);
  assert.match(operationalSql, /does not identify the connected database/u);
  assert.match(operationalSql, /current_user = 'postgres' and session_user = 'postgres'/u);
}

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
assert.equal((disable.match(/pg_catalog\.pg_advisory_xact_lock\(/gu) ?? []).length, 0);
assert.equal(
  (
    disable.match(
      new RegExp(`pg_catalog\\.pg_advisory_lock\\(\\s*${lifecycleLockKeyPattern}\\s*\\)`, 'gu'),
    ) ?? []
  ).length,
  1,
);
assert.equal(
  (
    disable.match(
      new RegExp(`pg_catalog\\.pg_advisory_unlock\\(\\s*${lifecycleLockKeyPattern}\\s*\\)`, 'gu'),
    ) ?? []
  ).length,
  1,
);
assert.match(disable, /^\\set ON_ERROR_STOP on$/mu);
assert.match(
  disable,
  /as shadow_lifecycle_lock_released\s*\\gset\s*\\if :shadow_lifecycle_lock_released/iu,
);
assert.match(disable, /lifecycle advisory lock was not released exactly once/iu);
assert.match(disable, /pg_terminate_backend/u);
assert.match(disable, /activity\.pid = activity_pid/u);
assert.match(disable, /pg_stat_clear_snapshot\(\)[\s\S]*activity\.pid = activity_pid/u);
assert.match(disable, /financialSwitchesChanged', false/u);
assert.doesNotMatch(
  disable,
  /(?:insert\s+into|update|delete\s+from)\s+app\.|alter table|create /iu,
);

const disableSessionLock = disable.indexOf('select pg_catalog.pg_advisory_lock(');
const disableRoleMutation = disable.indexOf('alter role fetanagent_telebirr_shadow_verifier with');
const disableFirstCommit = disable.indexOf('commit;', disableRoleMutation);
const disableSecondBegin = disable.indexOf(
  'begin transaction isolation level serializable;',
  disableFirstCommit + 1,
);
const disableSessionTermination = disable.indexOf('pg_catalog.pg_terminate_backend');
const disableFinalPostcondition = disable.indexOf(
  "raise exception 'The shadow-verifier role disablement is incomplete.'",
);
const disableSecondCommit = disable.indexOf('commit;', disableFinalPostcondition);
const disableSessionUnlock = disable.indexOf('select pg_catalog.pg_advisory_unlock(');
const disableSuccessResult = disable.indexOf("'operation', 'shadow_verifier_runtime_disable'");
const disableLifecycleOrder = [
  disableSessionLock,
  disableRoleMutation,
  disableFirstCommit,
  disableSecondBegin,
  disableSessionTermination,
  disableFinalPostcondition,
  disableSecondCommit,
  disableSessionUnlock,
  disableSuccessResult,
];
assert.ok(disableLifecycleOrder.every((position) => position >= 0));
assert.deepEqual(
  disableLifecycleOrder.toSorted((left, right) => left - right),
  disableLifecycleOrder,
);

assert.match(
  sqlLifecycleSuite,
  /serializes provision behind the session-scoped disable lifecycle lock across transaction boundaries/u,
);
assert.match(sqlLifecycleSuite, /waitForProvisionAdvisoryWaiter/u);
assert.match(sqlLifecycleSuite, /activity\.wait_event = 'advisory'/u);
assert.match(sqlLifecycleSuite, /activity\.query like '%pg_advisory_xact_lock%'/u);
assert.match(sqlLifecycleSuite, /pg_catalog\.pg_blocking_pids/u);
assert.match(sqlLifecycleSuite, /pg_catalog\.pg_advisory_unlock/u);

assert.match(runbook, /PLAN STAGING SHADOW VERIFIER/u);
assert.match(runbook, /DEPLOY STAGING SHADOW VERIFIER NO MONEY/u);
assert.match(runbook, /STATUS STAGING SHADOW VERIFIER/u);
assert.match(runbook, /STOP STAGING SHADOW VERIFIER/u);
assert.match(runbook, /checksum-bound descriptor execution/iu);
assert.match(runbook, /\/proc\/self\/fd\/N.*\/dev\/fd\/N/su);
assert.match(runbook, /fdexec=never/u);
assert.match(runbook, /exact sudo-reported original command/iu);
assert.match(runbook, /device, and inode match the canonical\s+root-owned installed helper/iu);
assert.match(runbook, /intermediate mismatch denies every helper command/iu);
assert.match(runbook, /sudoers fdexec documentation/iu);
assert.match(runbook, /root-owned public key/iu);
assert.match(runbook, /every unrelated Docker tag/iu);
assert.match(runbook, /final, separate administrator database status query/iu);
assert.match(runbook, /does not apply a\s+migration/iu);
assert.match(runbook, /workflow-supplied assertion, not a database identity marker/iu);
assert.match(runbook, /Never\s+run it from a standalone shell/iu);
assert.match(runbook, /Every tested provision\s+refusal occurs\s+before role mutation/iu);
assert.match(runbook, /session-scoped shadow lifecycle advisory lock/iu);
assert.match(runbook, /transaction-scoped advisory lock on the same exact key/iu);
assert.match(runbook, /ON_ERROR_STOP[\s\S]*fail-safe/iu);
assert.match(
  packageJson.scripts['test:infra'],
  /node infra\/verify-telebirr-shadow-verifier-staging-lifecycle\.mjs/u,
);

console.log(
  'TeleBirr shadow verifier staging lifecycle verified: manual exact-commit plan/deploy/status/stop, root-trusted signed single-image archive, final database no-money proof, bounded one-connection runtime, serialized two-transaction disablement, live/KemerBet gates off, no public ingress, and fail-closed dual cleanup',
);
