import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(`${repositoryRoot}${path}`, 'utf8');
const [
  dockerfile,
  compose,
  workflow,
  manifestText,
  applicationSource,
  healthSource,
  healthServerSource,
  workerSource,
  postgresSource,
  mainSource,
  environmentExample,
  productionCompose,
  productionWorkflow,
  productionHelper,
  productionSudoers,
  productionTunnel,
  productionRunbook,
  productionDisableSql,
  productionInspectSql,
  readinessCohortMigration,
  activationEpochMigration,
  executionEpochMigration,
] = await Promise.all([
  read('Dockerfile'),
  read('infra/compose.trusted-telebirr-verifier.yaml'),
  read('.github/workflows/trusted-telebirr-verifier-image-smoke.yml'),
  read('apps/trusted-telebirr-verifier/package.json'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-application.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-health.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-health-server.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-worker.ts'),
  read('apps/trusted-telebirr-verifier/src/postgres-trusted-telebirr-verifier.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-main.ts'),
  read('.env.example'),
  read('infra/compose.production-trusted-telebirr-verifier.yaml'),
  read('.github/workflows/production-trusted-telebirr-verifier.yml'),
  read('infra/operations/fetanagent-production-trusted-telebirr-verifier-helper.sh'),
  read('infra/operations/fetanagent-production-trusted-telebirr-verifier-helper.sudoers'),
  read('infra/operations/fetanagent-production-direct-database-tunnel.sh'),
  read('infra/production-trusted-telebirr-verifier.md'),
  read('infra/sql/production-trusted-telebirr-verifier-disable.sql'),
  read('infra/sql/production-trusted-telebirr-verifier-inspect.sql'),
  read('supabase/migrations/20260825103000_private_owner_kemerbet_readiness_cohort_claim.sql'),
  read('supabase/migrations/20260910154104_trusted_telebirr_activation_epoch_foundation.sql'),
  read('supabase/migrations/20260910170000_private_live_execution_activation_epoch.sql'),
]);
const manifest = JSON.parse(manifestText);

await assert.rejects(
  read('infra/sql/production-trusted-telebirr-verifier-provision.sql'),
  /ENOENT/,
  'the removed production verifier provisioning route must stay absent',
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function topLevelSection(value, name) {
  const header = new RegExp(`^${escapeRegExp(name)}:\\s*$`, 'm').exec(value);
  assert.ok(header, `missing top-level ${name} section`);
  const start = header.index + header[0].length;
  const remainder = value.slice(start);
  const next = /^\S[^\r\n]*:\s*$/m.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function continuedDockerRunCommands(value) {
  const lines = value.split(/\r?\n/u);
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*docker run\b/u.test(lines[index])) continue;
    const commandLines = [lines[index]];
    while (/\\\s*$/u.test(commandLines.at(-1))) {
      index += 1;
      assert.ok(index < lines.length, 'unterminated verifier image-smoke docker run');
      commandLines.push(lines[index]);
    }
    commands.push(commandLines.join('\n'));
  }
  return commands;
}

function migrationFunctionBody(name) {
  const match = new RegExp(
    `create(?: or replace)? function app\\.${escapeRegExp(name)}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
    'u',
  ).exec(activationEpochMigration);
  assert.ok(match, `missing activation-epoch function ${name}`);
  return match[1];
}

function executionEpochFunctionBody(name) {
  const match = new RegExp(
    `create function app\\.${escapeRegExp(name)}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
    'u',
  ).exec(executionEpochMigration);
  assert.ok(match, `missing execution-epoch function ${name}`);
  return match[1];
}

assert.equal(
  manifest.scripts.start,
  'node dist/trusted-telebirr-verifier-main.js',
  'the package must have exactly one production entrypoint',
);

assert.match(dockerfile, /FROM build-base AS trusted-telebirr-verifier-build/);
assert.match(dockerfile, /pnpm --filter @fetanagent\/trusted-telebirr-verifier\.\.\. run build/);
const verifierImage = dockerfile
  .split('FROM runtime-base AS trusted-telebirr-verifier')[1]
  ?.split('# The executor uses the distribution-provided Chromium')[0];
assert.ok(verifierImage, 'missing dedicated trusted TeleBirr verifier image body');
assert.match(
  verifierImage,
  /org\.opencontainers\.image\.title="fetanagent-trusted-telebirr-verifier"/,
);
assert.match(verifierImage, /org\.opencontainers\.image\.revision="\$\{VCS_REF\}"/);
assert.match(
  verifierImage,
  /COPY --from=trusted-telebirr-verifier-build --chown=10001:10001 \/workspace\/node_modules/,
);
assert.match(
  verifierImage,
  /COPY --from=trusted-telebirr-verifier-build --chown=10001:10001 \/workspace\/packages/,
);
assert.match(
  verifierImage,
  /COPY --from=trusted-telebirr-verifier-build --chown=10001:10001 \/workspace\/apps\/trusted-telebirr-verifier/,
);
assert.match(verifierImage, /127\.0\.0\.1:8091\/readyz/);
assert.match(
  verifierImage,
  /CMD \["node", "apps\/trusted-telebirr-verifier\/dist\/trusted-telebirr-verifier-main\.js"\]/,
);
assert.doesNotMatch(
  verifierImage,
  /\bEXPOSE\b|docker\.sock|COPY[^\r\n]*\/run\/(?:secrets|configs)/,
);
for (const proxyName of [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'FTP_PROXY',
  'ftp_proxy',
  'ALL_PROXY',
  'all_proxy',
]) {
  assert.match(verifierImage, new RegExp(`\\b${proxyName}=`));
}

assert.match(applicationSource, /loadTrustedTelebirrVerifierConfig/);
assert.match(applicationSource, /createTrustedTelebirrPostgresRuntime/);
assert.match(applicationSource, /createTrustedTelebirrVerifier/);
assert.match(applicationSource, /createTrustedTelebirrVerifierWorker/);
assert.match(applicationSource, /await exactRuntime\.ready\(\)/);
assert.match(applicationSource, /TRUSTED_TELEBIRR_VERIFIER_SHUTDOWN_TIMEOUT_MS = 15_000/);
assert.match(applicationSource, /signalSource\.once\('SIGINT', onSignal\)/);
assert.match(applicationSource, /signalSource\.once\('SIGTERM', onSignal\)/);
assert.match(
  applicationSource,
  /Promise\.allSettled\(\[healthServer\.close\(\), worker\.stop\(\)\]\)/,
);
assert.match(applicationSource, /Promise\.allSettled\(\[exactRuntime\.close\(\)\]\)/);
assert.match(applicationSource, /await worker\.run\(\)/);
assert.doesNotMatch(applicationSource, /\.verifyAndComplete\(/);
assert.doesNotMatch(applicationSource, /createServer|listen\(/);
assert.match(workerSource, /dependencies\.source\.loadNext\(\)/);
assert.match(workerSource, /dependencies\.verifier\.verifyAndComplete\(request\)/);
assert.match(workerSource, /dependencies\.source\.quarantineInvalid/);
assert.match(workerSource, /redactedTrustedTelebirrVerificationForLog/);
assert.doesNotMatch(workerSource, /createServer|listen\(|fetch\(|WebSocket|XMLHttpRequest/);
assert.match(postgresSource, /load_next_private_live_telebirr_staged_evidence/);
assert.match(postgresSource, /quarantine_private_live_telebirr_staged_evidence/);
assert.match(postgresSource, /select count\(\*\) = 4/);
assert.match(healthSource, /TRUSTED_TELEBIRR_VERIFIER_HEALTH_HOST = '127\.0\.0\.1'/);
assert.match(healthSource, /TRUSTED_TELEBIRR_VERIFIER_HEALTH_PORT = 8091/);
assert.match(healthSource, /database_unavailable/);
assert.doesNotMatch(
  healthSource,
  /verificationAttemptId|leaseToken|completionRequestKey|receiverIdentityDigest|keyId/,
);
assert.match(healthServerSource, /options\.host !== '127\.0\.0\.1'/);
assert.match(healthServerSource, /request\.url === '\/healthz'/);
assert.match(healthServerSource, /request\.url === '\/readyz'/);
assert.doesNotMatch(healthServerSource, /verifyAndComplete|\/verify|\/observation|\/complete/);
assert.match(mainSource, /FetanAgent trusted TeleBirr verifier failed closed\./);

assert.match(compose, /^\s{4}profiles: \[trusted-telebirr-verifier\]$/m);
assert.match(compose, /^\s{4}platform: linux\/amd64$/m);
assert.match(
  compose,
  /image: \$\{FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_IMAGE_REFERENCE:\?[^\r\n]*@sha256[^\r\n]*\}/,
);
assert.match(compose, /^\s{4}user: '10001:10001'$/m);
assert.match(compose, /^\s{4}read_only: true$/m);
assert.match(compose, /^\s{6}- ALL$/m);
assert.match(compose, /^\s{6}- no-new-privileges:true$/m);
assert.match(compose, /^\s{4}stop_grace_period: 20s$/m);
assert.match(compose, /^\s{6}replicas: 1$/m);
assert.match(compose, /127\.0\.0\.1:8091\/readyz/);
assert.match(compose, /TRUSTED_TELEBIRR_VERIFIER_DEPLOYMENT_TARGET: staging/);
assert.match(compose, /INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED: \$\{[^\r\n]+:\?[^\r\n]+\}/);
assert.match(compose, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: \$\{[^\r\n]+:\?[^\r\n]+\}/);
assert.match(compose, /FINANCIAL_ACTIONS_MODE: \$\{[^\r\n]+:\?[^\r\n]+\}/);
assert.match(compose, /mode: 0400/);
assert.equal((compose.match(/mode: 0444/gu) ?? []).length, 2);
assert.doesNotMatch(
  compose,
  /^\s+(?:ports|expose|build|privileged|network_mode|pid|ipc):|docker\.sock|\/var\/run\/docker/im,
  'the verifier Compose service must have no public/inherited ingress, build, privilege, or Docker control surface',
);
assert.doesNotMatch(
  compose,
  /password|private[_ -]?key|service[_ -]?role|TELEGRAM_BOT_TOKEN|KEMERBET/i,
  'the Compose artifact must contain no credential value or unrelated provider authority',
);

for (const gate of [
  'INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED',
  'TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED',
]) {
  assert.match(environmentExample, new RegExp(`^${gate}=false$`, 'm'));
}

const triggers = topLevelSection(workflow, 'on');
assert.deepEqual(
  [...triggers.matchAll(/^  ([a-z][a-z_]*)\s*:\s*$/gm)].map((match) => match[1]),
  ['push', 'pull_request'],
);
assert.match(workflow, /^permissions:\s*\r?\n  contents: read$/m);
assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /docker build --pull=false --target trusted-telebirr-verifier/);
assert.match(workflow, /'10001:10001'/);
assert.match(
  workflow,
  /'\["node","apps\/trusted-telebirr-verifier\/dist\/trusted-telebirr-verifier-main\.js"\]'/,
);
assert.match(workflow, /'FetanAgent trusted TeleBirr verifier failed closed\.'/);
assert.match(workflow, /readinessBody\.reason !== 'database_unavailable'/);
assert.match(workflow, /forbidden\.status !== 404/);
assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
assert.doesNotMatch(
  workflow,
  /FINANCIAL_ACTIONS_MODE=(?:live)|(?:INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED|TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED)=(?:true)/,
  'image smoke must keep all real verifier activation gates off',
);
assert.doesNotMatch(
  workflow,
  /TRUSTED_TELEBIRR_VERIFIER_(?:DATABASE_URL|PIN_MANIFEST)|NODE_EXTRA_CA_CERTS|SUPABASE_CA/,
  'image smoke must not receive a database URL, pins, or CA input',
);
assert.doesNotMatch(
  workflow,
  /\b(?:docker\s+(?:push|compose)|kubectl|helm|ssh|scp|rsync|doctl|supabase)\b/,
  'image smoke must not deploy or mutate a provider',
);
const dockerRuns = continuedDockerRunCommands(workflow);
assert.equal(dockerRuns.length, 2, 'unexpected verifier image-smoke container count');
for (const dockerRun of dockerRuns) {
  assert.match(dockerRun, /--network none/);
  assert.match(dockerRun, /--read-only/);
  assert.match(dockerRun, /--cap-drop ALL/);
  assert.match(dockerRun, /--security-opt no-new-privileges/);
  assert.doesNotMatch(dockerRun, /--mount\b|--volume\b|(?:^|\s)-v(?:\s|=)/m);
  assert.doesNotMatch(dockerRun, /--env-file\b/);
}

assert.match(productionCompose, /^name: fetanagent-production-trusted-telebirr-verifier$/m);
assert.match(productionCompose, /^\s{4}profiles: \[production-trusted-telebirr-verifier\]$/m);
assert.match(productionCompose, /^\s{4}platform: linux\/amd64$/m);
assert.match(
  productionCompose,
  /image: \$\{FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_IMAGE_ID:\?[^\r\n]*sha256 image ID[^\r\n]*\}/,
);
assert.match(productionCompose, /^\s{4}pull_policy: never$/m);
assert.match(productionCompose, /^\s{4}user: '10001:10001'$/m);
assert.match(productionCompose, /^\s{4}read_only: true$/m);
assert.match(productionCompose, /^\s{6}- ALL$/m);
assert.match(productionCompose, /^\s{6}- no-new-privileges:true$/m);
assert.match(productionCompose, /^\s{6}replicas: 1$/m);
assert.match(productionCompose, /TRUSTED_TELEBIRR_VERIFIER_DEPLOYMENT_TARGET: production/);
assert.match(productionCompose, /^\s{6}FINANCIAL_ACTIONS_MODE: dry_run$/m);
assert.match(productionCompose, /^\s{6}INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED: 'false'$/m);
assert.match(productionCompose, /^\s{6}TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: 'false'$/m);
assert.doesNotMatch(
  productionCompose,
  /FETANAGENT_(?:TRUSTED_TELEBIRR_FINANCIAL_ACTIONS_MODE|INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED|TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED)/,
);
assert.match(productionCompose, /127\.0\.0\.1:8091\/readyz/);
assert.match(productionCompose, /mode: 0400/);
assert.equal((productionCompose.match(/mode: 0444/gu) ?? []).length, 2);
assert.doesNotMatch(
  productionCompose,
  /^\s+(?:ports|expose|build|privileged|network_mode|pid|ipc):|docker\.sock|\/var\/run\/docker/im,
);
assert.doesNotMatch(productionCompose, /KEMERBET|EXECUTOR|FINAL_ACTION/);

const productionTriggers = topLevelSection(productionWorkflow, 'on');
assert.deepEqual(
  [...productionTriggers.matchAll(/^  ([a-z][a-z_]*)\s*:\s*$/gm)].map((match) => match[1]),
  ['workflow_dispatch'],
);
assert.match(productionWorkflow, /^permissions:\s*\r?\n  contents: read$/m);
assert.match(productionWorkflow, /GITHUB_REF.*refs\/heads\/main/);
assert.match(productionWorkflow, /CONFIRMED_COMMIT.*GITHUB_SHA/);
assert.match(productionWorkflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(productionWorkflow, /PRODUCTION_DROPLET_ID: '593344964'/);
assert.match(
  productionWorkflow,
  /PRODUCTION_DATABASE_DIRECT_HOST: db\.xzztugbgtulptnbpoelr\.supabase\.co/,
);
assert.match(productionWorkflow, /STAGE DISABLED PRODUCTION VERIFIER/);
assert.match(productionWorkflow, /EMERGENCY DISABLE PRODUCTION VERIFIER/);
assert.match(productionWorkflow, /confirm_pin_manifest_sha256/);
assert.match(productionWorkflow, /require-production-ci\.mjs/g);
assert.match(productionWorkflow, /docker build --pull=false --target trusted-telebirr-verifier/);
assert.match(productionWorkflow, /fetanagent-trusted-telebirr-verifier-image\.tar/);
assert.match(productionWorkflow, /TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_V1_BASE64/);
assert.match(productionWorkflow, /disabled_password="\$\(openssl rand -hex 32\)"/);
assert.match(productionWorkflow, /PGSSLMODE: verify-full/g);
assert.match(productionWorkflow, /fetanagent_open_production_direct_database_tunnel/g);
assert.match(
  productionWorkflow,
  /cancel-in-progress: \$\{\{ inputs\.mode == 'emergency-disable' \}\}/,
);
assert.match(productionWorkflow, /trap finish_stage EXIT/);
assert.match(productionWorkflow, /cleanup_incoming \|\| cleanup_status=\$\?/);
assert.match(
  productionWorkflow,
  /cleanup-incoming '\$GITHUB_SHA'.*prepare-incoming '\$GITHUB_SHA'/s,
);
assert.match(productionWorkflow, /timeout --signal=TERM --kill-after=30s 10m \\\s+scp/);
assert.doesNotMatch(productionWorkflow, /cleanup-incoming[^\r\n]*\|\| true/);
assert.match(
  productionWorkflow,
  /fetanagent-production-trusted-telebirr-verifier-helper status-inert/,
);
assert.match(
  productionWorkflow,
  /\.verifierLogin == "disabled"[\s\S]*?\.activeVerifierSessions == 0/,
);
const emergencyHostJob = productionWorkflow
  .split('\n  emergency-host-stop:')[1]
  ?.split('\n  emergency-database-revoke:')[0];
const emergencyDatabaseJob = productionWorkflow.split('\n  emergency-database-revoke:')[1];
assert.ok(emergencyHostJob, 'missing DAG-independent emergency host-stop job');
assert.ok(emergencyDatabaseJob, 'missing DAG-independent emergency database-revoke job');
assert.match(emergencyHostJob, /always\(\).*inputs\.mode == 'emergency-disable'/s);
assert.match(emergencyDatabaseJob, /always\(\).*inputs\.mode == 'emergency-disable'/s);
assert.match(emergencyHostJob, /needs: validate-target/);
assert.match(emergencyDatabaseJob, /needs: validate-target/);
assert.doesNotMatch(emergencyDatabaseJob, /needs:.*emergency-host-stop/);
assert.match(
  emergencyHostJob,
  /timeout --signal=TERM --kill-after=10s 110s[\s\S]*?ConnectTimeout=8[\s\S]*?helper emergency-stop/,
);
assert.doesNotMatch(emergencyHostJob, /SUPABASE_(?:DB_PASSWORD|CA_CERTIFICATE)|PGPASSWORD|PGHOST/);
assert.match(emergencyDatabaseJob, /Always attempt the database kill switch/);
assert.match(emergencyDatabaseJob, /if: always\(\)/g);
assert.match(productionWorkflow, /production-trusted-telebirr-verifier-disable\.sql/);
assert.match(productionWorkflow, /production-trusted-telebirr-verifier-inspect\.sql/);
assert.match(productionWorkflow, /\.financialSwitchesChanged == false/g);
assert.match(productionWorkflow, /\.executorLogin == "disabled"/g);
assert.doesNotMatch(
  productionWorkflow,
  /activate-verifier|ACTIVATE PRODUCTION|activation-preflight|bounded_verifier_login_provision|production-trusted-telebirr-verifier-provision|helper' (?:activate|finalize|rollback)|helper (?:activate|finalize|rollback)/i,
);
assert.doesNotMatch(productionWorkflow, /TRUSTED_TELEBIRR_VERIFIER_RUNTIME_PASSWORD/);
assert.doesNotMatch(productionWorkflow, /pull_request:|push:|schedule:|workflow_call:/);
assert.doesNotMatch(productionWorkflow, /KEMERBET_(?:EXECUTOR|FINAL_ACTION)|deposit-executor/iu);
assert.doesNotMatch(
  productionWorkflow,
  /docker\s+(?:push|login)|kubectl|helm|doctl|SUPABASE_ACCESS_TOKEN|service_role/iu,
);

assert.match(
  productionHelper,
  /readonly PROJECT_NAME='fetanagent-production-trusted-telebirr-verifier'/,
);
assert.match(productionHelper, /PRODUCTION_STATE_ROOT='\/var\/lib\/fetanagent\/production'/);
assert.match(productionHelper, /stat --format='%u:%g:%a'.*PRODUCTION_STATE_ROOT/);
assert.match(productionHelper, /a production operation lock is unsafe/g);
assert.match(productionHelper, /flock --nonblock 8/);
assert.match(productionHelper, /flock --nonblock 9/);
assert.match(productionHelper, /\.pin-manifest-sha256/);
assert.match(productionHelper, /sha256sum .*trusted-telebirr-verifier-pins\.v1\.json/);
const productionComposeDigest = createHash('sha256').update(productionCompose).digest('hex');
assert.match(productionHelper, new RegExp(`EXPECTED_COMPOSE_SHA256='${productionComposeDigest}'`));
assert.match(productionHelper, /sha256sum .*compose\.production-trusted-telebirr-verifier\.yaml/);
assert.match(productionHelper, /docker image inspect .*\.Id/);
assert.match(productionHelper, /assert_verifier_container_absent/);
assert.match(productionHelper, /^\s{2}status-inert\)$/m);
assert.match(productionHelper, /^\s{2}emergency-stop\)$/m);
assert.match(productionHelper, /docker container rm --force -- "\$\{ids\[@\]\}"/);
assert.doesNotMatch(productionHelper, /docker container rm[^\r\n]*--time\b/);
assert.match(productionHelper, /timeout --signal=TERM --kill-after=5s 25s/);
const verifierInventoryFunction = productionHelper
  .split('verifier_container_ids() {')[1]
  ?.split('\n}')[0];
assert.ok(verifierInventoryFunction, 'missing bounded verifier container inventory');
assert.match(
  verifierInventoryFunction,
  /timeout --signal=TERM --kill-after=5s 20s\s+\\?\s*docker container ls --all --quiet/u,
);
assert.match(productionHelper, /if ! timeout[\s\S]*?rescanning every exact labeled container/);
assert.match(
  productionHelper,
  /--filter "label=com\.docker\.compose\.project=\$PROJECT_NAME"[\s\S]*?--filter 'label=com\.docker\.compose\.service=trusted-telebirr-verifier'/,
);
assert.match(
  productionHelper,
  /case "\$\{1:-\}" in\s+preflight\|prepare-incoming\|cleanup-incoming\|install\)\s+acquire_operation_locks/s,
);
const verifierInstallCase = productionHelper
  .split('\n  install)')[1]
  ?.split('\n  status-inert)')[0];
assert.ok(verifierInstallCase, 'missing trusted verifier install case');
const verifierCleanupCase = productionHelper
  .split('\n  cleanup-incoming)')[1]
  ?.split('\n  install)')[0];
assert.ok(verifierCleanupCase, 'missing trusted verifier cleanup case');
assert.match(
  verifierCleanupCase,
  /fetanagent-admin:fetanagent-admin:700'[\s\S]*?root:root:700'[\s\S]*?sealed="\$RELEASE_ROOT\/\.incoming-\$sha"/,
);
assert.match(
  verifierCleanupCase,
  /find -P "\$sealed" -mindepth 1 -maxdepth 1 -type f -delete[\s\S]*?rmdir -- "\$sealed"/,
);
assert.match(
  verifierInstallCase,
  /incoming_identity="\$\(stat --format='%d:%i' "\$incoming"\)"[\s\S]*?chown --no-dereference root:root "\$incoming"[\s\S]*?\$incoming_identity:root:root:700/,
);
assert.match(
  verifierInstallCase,
  /install -d -m 0700 -o root -g root "\$sealed"[\s\S]*?cp --no-dereference --reflink=never -- "\$incoming\/\$name" "\$sealed\/\$name"/,
);
assert.match(
  verifierInstallCase,
  /sha256sum "\$sealed\/trusted-telebirr-verifier-pins\.v1\.json"[\s\S]*?sha256sum "\$sealed\/compose\.production-trusted-telebirr-verifier\.yaml"[\s\S]*?docker load --input "\$sealed\/fetanagent-trusted-telebirr-verifier-image\.tar"/,
);
assert.match(
  verifierInstallCase,
  /mv -- "\$sealed" "\$release"[\s\S]*?verify_release "\$sha" "\$release"/,
);
assert.doesNotMatch(verifierInstallCase, /docker load --input "\$incoming\//);
assert.doesNotMatch(verifierInstallCase, /chown -R[\s\S]*?"\$incoming"/);
const emergencyStopFunction = productionHelper
  .split('emergency_stop_verifier() {')[1]
  ?.split('\n}')[0];
assert.ok(emergencyStopFunction, 'missing metadata-independent emergency stop function');
const emergencyStopCommands = emergencyStopFunction.replace(/^\s*#.*$/gmu, '');
assert.match(emergencyStopCommands, /output="\$\(verifier_container_ids\)"/g);
assert.match(emergencyStopCommands, /mapfile -t ids <<<"\$output"/);
assert.match(emergencyStopCommands, /"\$\{ids\[@\]\}"/);
assert.doesNotMatch(emergencyStopCommands, /container_for_verifier|multiple .* containers/i);
assert.doesNotMatch(
  emergencyStopCommands,
  /CURRENT|RELEASE_ROOT|STATE_ROOT|flock|compose|database|secret/i,
);
assert.doesNotMatch(
  productionHelper,
  /^\s{2}(?:activation-preflight|activate|finalize|rollback|status)\)|CURRENT_LINK|pending-.*\.previous|compose_release|\bup --detach\b|docker container start/im,
);
assert.doesNotMatch(productionHelper, /docker\s+(?:push|login)|curl\s+http|KEMERBET/iu);

const helperDigest = createHash('sha256').update(productionHelper).digest('hex');
for (const command of [
  'verify *',
  'preflight *',
  'prepare-incoming *',
  'cleanup-incoming *',
  'install *',
  'status-inert',
  'emergency-stop',
]) {
  assert.match(
    productionSudoers,
    new RegExp(
      `sha256:${helperDigest} \\/usr\\/local\\/sbin\\/` +
        `fetanagent-production-trusted-telebirr-verifier-helper ${escapeRegExp(command)}`,
    ),
  );
}
assert.doesNotMatch(
  productionSudoers,
  /helper \*$|\b(?:activate|activation-preflight|finalize|rollback|status-current)\b/m,
);
assert.doesNotMatch(productionSudoers, /REPLACE_WITH/);

if (process.platform === 'linux') {
  const execute = promisify(execFile);
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'fetanagent-verifier-emergency-'));
  try {
    const fixtureBin = join(fixtureRoot, 'bin');
    const containerState = join(fixtureRoot, 'containers');
    const dockerLog = join(fixtureRoot, 'docker.log');
    const containerId = 'a'.repeat(64);
    await mkdir(fixtureBin, { mode: 0o700 });
    await writeFile(containerState, `${containerId}\n`, { mode: 0o600 });
    await writeFile(dockerLog, '', { mode: 0o600 });
    await writeFile(
      join(fixtureBin, 'id'),
      "#!/usr/bin/env bash\n[[ \"${1:-}\" == '-u' ]] || exit 64\nprintf '%s\\n' 0\n",
      { mode: 0o700 },
    );
    await writeFile(join(fixtureBin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
    await writeFile(
      join(fixtureBin, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG"
if [[ "$1" == 'container' && "$2" == 'ls' ]]; then
  [[ "$*" == "container ls --all --quiet --filter label=com.docker.compose.project=fetanagent-production-trusted-telebirr-verifier --filter label=com.docker.compose.service=trusted-telebirr-verifier" ]] || exit 64
  if [[ -s "$FAKE_DOCKER_STATE" ]]; then cat "$FAKE_DOCKER_STATE"; fi
elif [[ "$1" == 'container' && "$2" == 'rm' ]]; then
  [[ "$#" -eq 5 && "$3" == '--force' && "$4" == '--' && "$5" == '${containerId}' ]] || exit 65
  : >"$FAKE_DOCKER_STATE"
else
  exit 66
fi
`,
      { mode: 0o700 },
    );
    const fixtureHelper = join(fixtureRoot, 'helper.sh');
    await writeFile(
      fixtureHelper,
      productionHelper.replace(
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        `PATH=${fixtureBin}:/usr/bin:/bin`,
      ),
      { mode: 0o700 },
    );
    await chmod(fixtureHelper, 0o700);
    const result = await execute('bash', [fixtureHelper, 'emergency-stop'], {
      env: {
        ...process.env,
        FAKE_DOCKER_LOG: dockerLog,
        FAKE_DOCKER_STATE: containerState,
      },
      timeout: 10_000,
    });
    assert.equal(
      result.stdout,
      'Production trusted TeleBirr verifier: exact labeled service container absent.\n',
    );
    assert.equal(await readFile(containerState, 'utf8'), '');
    const dockerCalls = (await readFile(dockerLog, 'utf8')).trim().split('\n');
    assert.equal(dockerCalls.length, 5);
    assert.equal(dockerCalls[1], `container rm --force -- ${containerId}`);
    assert.equal(dockerCalls.filter((call) => call.startsWith('container ls ')).length, 4);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

assert.match(productionTunnel, /db\.xzztugbgtulptnbpoelr\.supabase\.co/);
assert.match(productionTunnel, /local_port" == '25432'/);
assert.match(productionTunnel, /StrictHostKeyChecking=yes/);
assert.match(productionTunnel, /ExitOnForwardFailure=yes/);
assert.match(productionTunnel, /ConnectTimeout=5/);
assert.match(productionTunnel, /ConnectionAttempts=1/);
assert.doesNotMatch(productionTunnel, /spzpiyxheappsfyswewl/);

assert.match(productionRunbook, /Production activation is deliberately unavailable/);
assert.match(productionRunbook, /shared\s+database state machine or epoch/);
assert.match(
  productionRunbook,
  /TeleBirr execution\s+lease records\s+an immutable attempt-to-epoch binding/,
);
assert.match(productionRunbook, /Cancellation and\s+reconciliation deliberately remain usable/);
assert.match(productionRunbook, /There is no same-release renewal path/);
assert.match(productionRunbook, /two DAG-independent protected jobs/);
assert.match(productionRunbook, /share a VM\/SSH failure domain/);
assert.match(productionRunbook, /database emergency-revocation route that does not depend/);
assert.match(
  productionRunbook,
  /lock activation control, epoch, the\s+readiness serialization gate, feature switches, then pilot/,
);
assert.doesNotMatch(productionRunbook, /ACTIVATE PRODUCTION PAYMENT VERIFIER ONLY/);
assert.doesNotMatch(productionRunbook, /Renewal is .*activate-verifier/);

assert.match(activationEpochMigration, /values \(0\)/);
assert.match(
  activationEpochMigration,
  /create table app\.private_trusted_telebirr_activation_epochs/,
);
assert.match(
  activationEpochMigration,
  /create table app\.private_trusted_telebirr_emergency_disable_intents/,
);
assert.match(
  activationEpochMigration,
  /create constraint trigger feature_switches_trusted_telebirr_complete_set/,
);
assert.match(activationEpochMigration, /deferrable initially deferred/);
assert.match(activationEpochMigration, /current_private_trusted_telebirr_activation_epoch\(\)/);
assert.match(activationEpochMigration, /request_private_trusted_telebirr_emergency_disable/);
assert.match(activationEpochMigration, /load_next_private_live_telebirr_staged_evidence_pre_epoch/);
assert.match(
  activationEpochMigration,
  /load_private_live_telebirr_verification_authority_pre_epoch/,
);
assert.match(activationEpochMigration, /complete_private_live_telebirr_verification_pre_epoch/);
assert.doesNotMatch(
  activationEpochMigration,
  /create(?: or replace)? function app\.activate_private_trusted_telebirr|grant execute on function app\.current_private_trusted/,
);
assert.match(
  executionEpochMigration,
  /create table app\.private_live_deposit_execution_epoch_bindings/,
);
assert.match(
  executionEpochMigration,
  /alter table app\.private_live_deposit_execution_epoch_bindings enable row level security/,
);
assert.match(
  executionEpochMigration,
  /alter table app\.private_live_deposit_execution_epoch_bindings force row level security/,
);
assert.match(executionEpochMigration, /rename to lease_private_live_deposit_pre_epoch/);
assert.match(executionEpochMigration, /rename to fence_private_live_deposit_pre_epoch/);
assert.doesNotMatch(
  executionEpochMigration,
  /create(?: or replace)? function app\.activate_private_trusted_telebirr|insert into app\.private_trusted_telebirr_activation_epochs|update app\.private_trusted_telebirr_activation_control/,
);
const executionMigrationControlIndex = executionEpochMigration.indexOf(
  'select activation_control.current_epoch',
);
const executionMigrationEpochIndex = executionEpochMigration.indexOf(
  'perform activation_epoch.epoch',
);
const executionMigrationSwitchIndex = executionEpochMigration.indexOf(
  'perform feature_switch.feature_key',
);
const executionMigrationAttemptLockIndex = executionEpochMigration.indexOf(
  'lock table app.deposit_execution_attempts in share row exclusive mode',
);
assert.ok(
  executionMigrationControlIndex >= 0 &&
    executionMigrationControlIndex < executionMigrationEpochIndex &&
    executionMigrationEpochIndex < executionMigrationSwitchIndex &&
    executionMigrationSwitchIndex < executionMigrationAttemptLockIndex,
  'execution-epoch migration must preflight in control, epoch, switch, execution order',
);

const renamedExecutionInternals = [
  ...executionEpochMigration.matchAll(/\brename to\s+([a-z][a-z0-9_]*)/gu),
].map((match) => match[1]);
assert.deepEqual(renamedExecutionInternals, [
  'lease_private_live_deposit_pre_epoch',
  'fence_private_live_deposit_pre_epoch',
]);
const executionInternals = [
  ...renamedExecutionInternals,
  'recover_expired_private_live_prepared',
  'lease_private_live_deposit_by_provider',
];
for (const identifier of executionInternals) {
  assert.ok(
    Buffer.byteLength(identifier, 'utf8') <= 63,
    `PostgreSQL would truncate execution internal ${identifier}`,
  );
}

const epochLeaseBody = executionEpochFunctionBody('lease_next_private_live_deposit_execution');
const leaseControlIndex = epochLeaseBody.indexOf('select activation_control.current_epoch');
const leaseEpochIndex = epochLeaseBody.indexOf('select activation_epoch.*');
const leaseSwitchIndex = epochLeaseBody.indexOf('perform feature_switch.feature_key');
const leaseRecoveryIndex = epochLeaseBody.indexOf('recover_expired_private_live_prepared');
const leaseInitialAuthorityIndex = epochLeaseBody.indexOf(
  'current_private_trusted_telebirr_activation_epoch()',
);
const leaseDispatchIndex = epochLeaseBody.indexOf('lease_private_live_deposit_by_provider');
const leaseRecheckIndex = epochLeaseBody.lastIndexOf(
  'current_private_trusted_telebirr_activation_epoch()',
);
const leaseTimeIndex = epochLeaseBody.indexOf('checked_at := pg_catalog.clock_timestamp()');
const leaseBindingIndex = epochLeaseBody.indexOf(
  'insert into app.private_live_deposit_execution_epoch_bindings',
);
assert.ok(
  leaseControlIndex >= 0 &&
    leaseControlIndex < leaseEpochIndex &&
    leaseEpochIndex < leaseSwitchIndex &&
    leaseSwitchIndex < leaseRecoveryIndex &&
    leaseRecoveryIndex < leaseInitialAuthorityIndex &&
    leaseInitialAuthorityIndex < leaseDispatchIndex &&
    leaseDispatchIndex < leaseRecheckIndex &&
    leaseRecheckIndex < leaseTimeIndex &&
    leaseTimeIndex < leaseBindingIndex,
  'execution lease must recover before provider authority and bind TeleBirr only after post-lock recheck',
);
assert.match(epochLeaseBody, /leased\.provider_code_snapshot = 'cbe_birr'/);
assert.match(epochLeaseBody, /A CBE Birr execution cannot carry TeleBirr activation authority/);
assert.match(
  epochLeaseBody,
  /leased\.lease_expires_at > authority\.expires_at/,
  'the complete legacy lease window must fit inside the activation epoch',
);

const epochFenceBody = executionEpochFunctionBody(
  'fence_private_live_deposit_execution_final_action',
);
const fenceControlIndex = epochFenceBody.indexOf('select activation_control.current_epoch');
const fenceEpochIndex = epochFenceBody.indexOf('select activation_epoch.*');
const fenceSwitchIndex = epochFenceBody.indexOf('perform feature_switch.feature_key');
const fenceProviderIndex = epochFenceBody.indexOf(
  'from app.private_live_deposit_pilot_reservations',
);
const fenceInitialAuthorityIndex = epochFenceBody.indexOf(
  'current_private_trusted_telebirr_activation_epoch()',
);
const fenceDelegateIndex = epochFenceBody.indexOf('fence_private_live_deposit_pre_epoch');
const fenceBindingIndex = epochFenceBody.indexOf(
  'from app.private_live_deposit_execution_epoch_bindings',
);
const fenceRecheckIndex = epochFenceBody.lastIndexOf(
  'current_private_trusted_telebirr_activation_epoch()',
);
const fenceTimeIndex = epochFenceBody.lastIndexOf('checked_at := pg_catalog.clock_timestamp()');
assert.ok(
  fenceControlIndex >= 0 &&
    fenceControlIndex < fenceEpochIndex &&
    fenceEpochIndex < fenceSwitchIndex &&
    fenceSwitchIndex < fenceProviderIndex &&
    fenceProviderIndex < fenceInitialAuthorityIndex &&
    fenceInitialAuthorityIndex < fenceDelegateIndex &&
    fenceEpochIndex < fenceDelegateIndex &&
    fenceDelegateIndex < fenceBindingIndex &&
    fenceBindingIndex < fenceRecheckIndex &&
    fenceRecheckIndex < fenceTimeIndex,
  'execution fence must resolve provider under global locks and validate TeleBirr binding afterward',
);
assert.match(epochFenceBody, /provider_code = 'cbe_birr'/);
assert.match(epochFenceBody, /provider_code = 'telebirr'/);
assert.match(
  epochFenceBody,
  /fenced\.final_action_fenced_at \+ interval '10 seconds' > authority\.expires_at/,
  'the complete browser final-action window must fit inside the activation epoch',
);
assert.match(
  executionEpochMigration,
  /revoke all on function[^]*recover_expired_private_live_prepared[^]*lease_private_live_deposit_by_provider[^]*lease_private_live_deposit_pre_epoch[^]*fence_private_live_deposit_pre_epoch[^]*from public, anon, authenticated, service_role/,
  'recovery, provider dispatch, and renamed pre-epoch OIDs must be owner-only',
);
assert.doesNotMatch(
  executionEpochMigration,
  /grant execute on function app\.(?:recover_expired_private_live_prepared|lease_private_live_deposit_by_provider|lease_private_live_deposit_pre_epoch|fence_private_live_deposit_pre_epoch)/,
  'no recovery, dispatch, or pre-epoch implementation may regain a runtime grant',
);
const recoveryBody = executionEpochFunctionBody('recover_expired_private_live_prepared');
assert.match(recoveryBody, /set status = 'cancelled_before_action'/);
assert.match(recoveryBody, /set status = 'execution_review'/);
assert.doesNotMatch(recoveryBody, /status = 'queued'|insert into app\.deposit_execution_attempts/);
const providerLeaseBody = executionEpochFunctionBody('lease_private_live_deposit_by_provider');
assert.match(providerLeaseBody, /provider_member\.provider_code_snapshot = 'cbe_birr'/);
assert.match(
  providerLeaseBody,
  /p_allow_telebirr[^]*provider_member\.provider_code_snapshot = 'telebirr'/,
);
assert.match(providerLeaseBody, /pilot_reservation\.deposit_intent_id = deposit_intent\.id/);
assert.match(providerLeaseBody, /payment_provider\.code = provider_member\.provider_code_snapshot/);
assert.match(
  executionEpochMigration,
  /grant execute on function app\.lease_next_private_live_deposit_execution\(uuid, integer\)[^]*to fetanagent_deposit_executor/,
);
assert.match(
  executionEpochMigration,
  /grant execute on function app\.fence_private_live_deposit_execution_final_action\([^]*\)[^]*to fetanagent_deposit_executor/,
);

const migrationLockIndex = activationEpochMigration.indexOf(
  'lock table app.feature_switches in share row exclusive mode',
);
const migrationPreflightIndex = activationEpochMigration.indexOf(
  'do $trusted_telebirr_activation_preflight$',
);
const switchGuardIndex = activationEpochMigration.indexOf(
  'create trigger feature_switches_00_trusted_telebirr_activation_lock',
);
const migrationRevalidationIndex = activationEpochMigration.indexOf(
  'do $trusted_telebirr_activation_revalidation$',
);
assert.ok(migrationLockIndex >= 0, 'activation preflight must hold the switch table');
assert.ok(
  migrationLockIndex < migrationPreflightIndex &&
    migrationPreflightIndex < switchGuardIndex &&
    switchGuardIndex < migrationRevalidationIndex,
  'migration must lock switches before preflight and revalidate after guard installation',
);
assert.equal(
  [...activationEpochMigration.matchAll(/safe_switch_count <> 5/gu)].length,
  2,
  'migration must evaluate the non-live switch prerequisite before and after guard installation',
);
const activationSwitchTrigger = /create trigger (feature_switches_\S+activation_lock)/u.exec(
  activationEpochMigration,
);
const readinessSwitchTrigger =
  /create trigger (feature_switches_serialize_kemerbet_readiness)/u.exec(readinessCohortMigration);
assert.ok(activationSwitchTrigger && readinessSwitchTrigger);
assert.ok(
  activationSwitchTrigger[1].localeCompare(readinessSwitchTrigger[1]) < 0,
  'activation authority trigger must run before the readiness serialization trigger',
);

const renamedActivationInternals = [
  ...activationEpochMigration.matchAll(/\brename to\s+([a-z][a-z0-9_]*)/gu),
].map((match) => match[1]);
assert.equal(renamedActivationInternals.length, 3);
for (const identifier of renamedActivationInternals) {
  assert.ok(
    Buffer.byteLength(identifier, 'utf8') <= 63,
    `PostgreSQL would truncate activation internal ${identifier}`,
  );
}

const currentEpochBody = migrationFunctionBody('current_private_trusted_telebirr_activation_epoch');
const currentControlLockIndex = currentEpochBody.indexOf('select activation_control.current_epoch');
const currentEpochLockIndex = currentEpochBody.indexOf('select activation_epoch.*');
const currentSwitchLockIndex = currentEpochBody.indexOf('perform feature_switch.feature_key');
const currentPilotLockIndex = currentEpochBody.indexOf('select pilot_revision.*');
const currentTimeIndex = currentEpochBody.indexOf('checked_at := pg_catalog.clock_timestamp()');
assert.ok(
  currentControlLockIndex >= 0 &&
    currentControlLockIndex < currentEpochLockIndex &&
    currentEpochLockIndex < currentSwitchLockIndex &&
    currentSwitchLockIndex < currentPilotLockIndex &&
    currentPilotLockIndex < currentTimeIndex,
  'operation-time authority must lock control, epoch, switches, and pilot before reading time',
);

for (const ownerFunction of ['arm_private_live_deposit_pilot', 'stop_private_live_deposit_pilot']) {
  const body = migrationFunctionBody(ownerFunction);
  const authorityLockIndex = body.indexOf('lock_private_trusted_telebirr_activation_authority()');
  const readinessLockIndex = body.indexOf('perform gate.singleton');
  const legacyDelegateIndex = body.indexOf(`${ownerFunction}_by_admin_id`);
  assert.ok(
    authorityLockIndex >= 0 &&
      authorityLockIndex < readinessLockIndex &&
      readinessLockIndex < legacyDelegateIndex,
    `${ownerFunction} must lock authority and readiness before its legacy switch/pilot sequence`,
  );
}

const companionArmBody = migrationFunctionBody(
  'arm_companion_verified_private_live_telebirr_pilot',
);
const companionAuthorityIndex = companionArmBody.indexOf(
  'lock_private_trusted_telebirr_activation_authority()',
);
const companionSwitchIndex = companionArmBody.indexOf('perform feature_switch.feature_key');
const companionPilotIndex = companionArmBody.indexOf('perform pilot_revision.id');
const companionReadinessIndex = companionArmBody.indexOf('perform gate.singleton');
const companionGateIndex = companionArmBody.indexOf(
  'update app.private_owner_kemerbet_readiness_cohort_gate',
);
assert.ok(
  companionAuthorityIndex >= 0 &&
    companionAuthorityIndex < companionReadinessIndex &&
    companionReadinessIndex < companionSwitchIndex &&
    companionSwitchIndex < companionPilotIndex &&
    companionPilotIndex < companionGateIndex,
  'companion arm must lock authority, readiness, switches, and pilot before opening its context',
);

const ownerStopBody = migrationFunctionBody('stop_private_live_deposit_pilot');
const ownerStopAuthorityIndex = ownerStopBody.indexOf(
  'lock_private_trusted_telebirr_activation_authority()',
);
const ownerStopSwitchIndex = ownerStopBody.indexOf('perform feature_switch.feature_key');
const ownerStopPilotIndex = ownerStopBody.indexOf('perform pilot_revision.id');
const ownerStopReadinessIndex = ownerStopBody.indexOf('perform gate.singleton');
const ownerStopGateIndex = ownerStopBody.indexOf(
  'update app.private_owner_kemerbet_readiness_cohort_gate',
);
assert.ok(
  ownerStopAuthorityIndex >= 0 &&
    ownerStopAuthorityIndex < ownerStopReadinessIndex &&
    ownerStopReadinessIndex < ownerStopSwitchIndex &&
    ownerStopSwitchIndex < ownerStopPilotIndex &&
    ownerStopPilotIndex < ownerStopGateIndex,
  'Owner stop must lock authority, readiness, switches, and pilot before opening its context',
);

const emergencyBody = migrationFunctionBody('request_private_trusted_telebirr_emergency_disable');
const emergencyIntentReads = [
  ...emergencyBody.matchAll(/from app\.private_trusted_telebirr_emergency_disable_intents/gu),
];
const emergencyControlLockIndex = emergencyBody.indexOf('perform activation_control.control_key');
const emergencyEpochLockIndex = emergencyBody.indexOf('select activation_epoch.*');
const emergencyReadinessIndex = emergencyBody.indexOf(
  'update app.private_owner_kemerbet_readiness_cohort_gate',
);
const emergencySwitchLockIndex = emergencyBody.indexOf('perform feature_switch.feature_key');
const emergencyPilotLockIndex = emergencyBody.indexOf('perform pilot_revision.id');
const emergencyTimeIndex = emergencyBody.indexOf('emergency_at := pg_catalog.clock_timestamp()');
assert.equal(
  emergencyIntentReads.length,
  2,
  'emergency replay must be checked around control lock',
);
assert.ok(
  emergencyIntentReads[0].index < emergencyControlLockIndex &&
    emergencyControlLockIndex < emergencyEpochLockIndex &&
    emergencyEpochLockIndex < emergencyIntentReads[1].index &&
    emergencyIntentReads[1].index < emergencyReadinessIndex &&
    emergencyReadinessIndex < emergencySwitchLockIndex &&
    emergencySwitchLockIndex < emergencyPilotLockIndex &&
    emergencyPilotLockIndex < emergencyTimeIndex,
  'emergency disable must preserve replay and global lock/time order',
);

assert.match(productionDisableSql, /fetanagent_trusted_telebirr_verifier_runtime with/);
assert.match(productionDisableSql, /nologin noinherit/);
assert.match(productionDisableSql, /password null valid until 'infinity'/g);
assert.match(productionDisableSql, /pg_catalog\.pg_terminate_backend/);
assert.match(productionDisableSql, /role\.rolpassword is null/);
assert.match(productionDisableSql, /financialSwitchesChanged', false/);
assert.doesNotMatch(
  productionDisableSql,
  /^\s*(?:insert|update|delete|truncate|create|drop|grant|revoke)\b/im,
);

assert.match(productionInspectSql, /serializable read only/);
assert.match(productionInspectSql, /'activeVerifierSessions'/);
assert.match(productionInspectSql, /'executorLogin'/);
assert.match(productionInspectSql, /'financialBoundary'/);
assert.match(productionInspectSql, /rollback;/);
assert.doesNotMatch(
  productionInspectSql,
  /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|commit)\b/im,
);

console.log(
  'trusted TeleBirr verifier deployment artifacts verified: immutable disabled staging, epoch-bound verifier and execution authority, fixed-off process gates, no activation/provision/renewal route, strict inert status, bounded DAG-independent emergency jobs, and the documented shared-route blocker',
);
