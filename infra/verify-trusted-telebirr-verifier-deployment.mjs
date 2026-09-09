import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  productionProvisionSql,
  productionDisableSql,
  productionInspectSql,
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
  read('infra/sql/production-trusted-telebirr-verifier-provision.sql'),
  read('infra/sql/production-trusted-telebirr-verifier-disable.sql'),
  read('infra/sql/production-trusted-telebirr-verifier-inspect.sql'),
]);
const manifest = JSON.parse(manifestText);

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
assert.match(productionWorkflow, /ACTIVATE PRODUCTION PAYMENT VERIFIER ONLY/);
assert.match(productionWorkflow, /EMERGENCY DISABLE PRODUCTION VERIFIER/);
assert.match(productionWorkflow, /confirm_pin_manifest_sha256/);
assert.match(productionWorkflow, /require-production-ci\.mjs/g);
assert.match(productionWorkflow, /docker build --pull=false --target trusted-telebirr-verifier/);
assert.match(productionWorkflow, /fetanagent-trusted-telebirr-verifier-image\.tar/);
assert.match(productionWorkflow, /TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_V1_BASE64/);
assert.match(productionWorkflow, /TRUSTED_TELEBIRR_VERIFIER_RUNTIME_PASSWORD/);
assert.match(productionWorkflow, /PGSSLMODE: verify-full/g);
assert.match(productionWorkflow, /fetanagent_open_production_direct_database_tunnel/g);
assert.match(productionWorkflow, /activation-preflight '\$GITHUB_SHA'/);
assert.match(productionWorkflow, /production-trusted-telebirr-verifier-provision\.sql/);
assert.match(productionWorkflow, /production-trusted-telebirr-verifier-disable\.sql/);
assert.match(productionWorkflow, /production-trusted-telebirr-verifier-inspect\.sql/);
assert.match(productionWorkflow, /\.financialSwitchesChanged == false/g);
assert.match(productionWorkflow, /\.executorLogin == "disabled"/g);
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
assert.match(productionHelper, /FETANAGENT_TRUSTED_TELEBIRR_VERIFIER_IMAGE_ID=/);
assert.match(productionHelper, /\.pin-manifest-sha256/);
assert.match(productionHelper, /sha256sum .*trusted-telebirr-verifier-pins\.v1\.json/);
const productionComposeDigest = createHash('sha256').update(productionCompose).digest('hex');
assert.match(productionHelper, new RegExp(`EXPECTED_COMPOSE_SHA256='${productionComposeDigest}'`));
assert.match(productionHelper, /sha256sum .*compose\.production-trusted-telebirr-verifier\.yaml/);
assert.match(productionHelper, /docker image inspect .*\.Id/);
assert.match(productionHelper, /assert_deposit_executor_absent/);
assert.match(productionHelper, /activation-preflight\)/);
assert.match(productionHelper, /pending-\*\.previous/);
assert.match(productionHelper, /fetanagent-deposit-executor/);
assert.match(productionHelper, /service" != 'executor'/);
assert.match(productionHelper, /--no-build --wait --wait-timeout 90/g);
assert.match(productionHelper, /rollback_transition/);
assert.match(productionHelper, /compose_release .* disabled down/);
assert.match(productionHelper, /rm -f -- "\$CURRENT_LINK"/);
assert.doesNotMatch(productionHelper, /docker\s+(?:push|login)|curl\s+http|KEMERBET/iu);

const helperDigest = createHash('sha256').update(productionHelper).digest('hex');
assert.match(
  productionSudoers,
  new RegExp(
    `^fetanagent-admin ALL=\\(root\\) NOPASSWD: sha256:${helperDigest} ` +
      '\\/usr\\/local\\/sbin\\/fetanagent-production-trusted-telebirr-verifier-helper \\*$',
    'm',
  ),
);
assert.doesNotMatch(productionSudoers, /REPLACE_WITH/);

assert.match(productionTunnel, /db\.xzztugbgtulptnbpoelr\.supabase\.co/);
assert.match(productionTunnel, /local_port" == '25432'/);
assert.match(productionTunnel, /StrictHostKeyChecking=yes/);
assert.match(productionTunnel, /ExitOnForwardFailure=yes/);
assert.doesNotMatch(productionTunnel, /spzpiyxheappsfyswewl/);

assert.match(productionProvisionSql, /begin transaction isolation level serializable;/);
assert.match(productionProvisionSql, /fetanagent:production:trusted-telebirr-verifier-runtime/);
assert.match(productionProvisionSql, /fetanagent_trusted_telebirr_verifier_runtime/);
assert.match(productionProvisionSql, /connection limit 1 password :'verifier_runtime_password'/);
assert.match(productionProvisionSql, /pg_catalog\.clock_timestamp\(\) \+ interval '24 hours'/);
assert.match(productionProvisionSql, /interval '23 hours 55 minutes'/);
assert.match(productionProvisionSql, /fetanagent_deposit_executor_runtime/);
assert.match(productionProvisionSql, /financialSwitchesChanged', false/);
assert.match(productionProvisionSql, /executorLogin', 'disabled'/);
assert.doesNotMatch(
  productionProvisionSql,
  /^\s*(?:insert|update|delete|truncate|create|drop|grant|revoke)\b/im,
);
assert.equal(
  (productionProvisionSql.match(/^alter role /gim) ?? []).length,
  1,
  'production provisioning may alter only the verifier runtime role',
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
  'trusted TeleBirr verifier deployment artifacts verified: inert CI smoke plus a separately confirmed production-only, immutable-image, digest-pinned, no-public-ingress lifecycle with bounded login, singleton runtime, rollback, and emergency disable',
);
